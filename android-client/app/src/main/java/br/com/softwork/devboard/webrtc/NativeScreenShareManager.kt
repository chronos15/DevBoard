package br.com.softwork.devboard.webrtc

import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjection
import android.os.Handler
import android.os.Looper
import android.util.Log
import br.com.softwork.devboard.service.ScreenShareService
import org.json.JSONArray
import org.json.JSONObject
import org.webrtc.*
import java.util.concurrent.ConcurrentHashMap

/**
 * Camada WebRTC nativa usada somente para a track de compartilhamento de tela do Android.
 * Áudio/câmera permanecem no WebRTC da aplicação web, reduzindo o impacto sobre o sistema atual.
 */
object NativeScreenShareManager {
    private const val TAG = "DevboardScreenShare"

    data class Recipient(val sessionId: String, val userId: String)

    interface Listener {
        fun onNativeScreenSignal(payload: JSONObject)
        fun onNativeScreenState(active: Boolean, error: String? = null)
    }

    private lateinit var appContext: Context
    private val mainHandler = Handler(Looper.getMainLooper())
    private var listener: Listener? = null

    private var eglBase: EglBase? = null
    private var factory: PeerConnectionFactory? = null
    private var videoSource: VideoSource? = null
    private var screenTrack: VideoTrack? = null
    private var capturer: ScreenCapturerAndroid? = null
    private var surfaceTextureHelper: SurfaceTextureHelper? = null

    private var meetingId: String = ""
    private var localSessionId: String = ""
    private var localUserId: String = ""
    private var started = false

    private val recipients = ConcurrentHashMap<String, Recipient>()
    private val peers = ConcurrentHashMap<String, PeerConnection>()
    private val pendingIce = ConcurrentHashMap<String, MutableList<IceCandidate>>()
    private var iceServers: List<PeerConnection.IceServer> = emptyList()

    fun initialize(context: Context, callback: Listener) {
        appContext = context.applicationContext
        listener = callback
        if (factory != null) return

        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(appContext)
                .setEnableInternalTracer(false)
                .createInitializationOptions(),
        )

        eglBase = EglBase.create()
        val encoderFactory = DefaultVideoEncoderFactory(eglBase!!.eglBaseContext, true, true)
        val decoderFactory = DefaultVideoDecoderFactory(eglBase!!.eglBaseContext)
        factory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(encoderFactory)
            .setVideoDecoderFactory(decoderFactory)
            .createPeerConnectionFactory()
    }

    fun setSession(meetingId: String, sessionId: String, userId: String) {
        this.meetingId = meetingId
        this.localSessionId = sessionId
        this.localUserId = userId
    }

    fun configureIceServers(json: String) {
        try {
            val root = JSONArray(json)
            val parsed = mutableListOf<PeerConnection.IceServer>()
            for (index in 0 until root.length()) {
                val item = root.getJSONObject(index)
                val urlsValue = item.opt("urls")
                val urls = when (urlsValue) {
                    is JSONArray -> (0 until urlsValue.length()).map { urlsValue.getString(it) }
                    is String -> listOf(urlsValue)
                    else -> emptyList()
                }
                if (urls.isEmpty()) continue
                val builder = PeerConnection.IceServer.builder(urls)
                item.optString("username").takeIf { it.isNotBlank() }?.let(builder::setUsername)
                item.optString("credential").takeIf { it.isNotBlank() }?.let(builder::setPassword)
                parsed += builder.createIceServer()
            }
            iceServers = parsed
        } catch (error: Throwable) {
            Log.w(TAG, "ICE servers inválidos recebidos do WebView", error)
        }
    }

    fun syncRecipients(json: String) {
        try {
            val array = JSONArray(json)
            val next = mutableMapOf<String, Recipient>()
            for (index in 0 until array.length()) {
                val item = array.getJSONObject(index)
                val session = item.getString("sessionId")
                if (session == localSessionId) continue
                next[session] = Recipient(session, item.optString("userId"))
            }

            recipients.keys.filter { !next.containsKey(it) }.forEach { session ->
                recipients.remove(session)
                closePeer(session, notify = false)
            }
            next.forEach { (session, recipient) ->
                recipients[session] = recipient
                if (started && !peers.containsKey(session)) createSenderPeer(recipient)
            }
        } catch (error: Throwable) {
            emitState(started, "Não foi possível sincronizar os participantes do compartilhamento.")
            Log.e(TAG, "Falha ao sincronizar recipients", error)
        }
    }

    fun startProjection(permissionData: Intent) {
        if (started) return
        val peerFactory = factory ?: run {
            emitState(false, "WebRTC nativo ainda não foi inicializado.")
            return
        }
        if (meetingId.isBlank() || localSessionId.isBlank() || localUserId.isBlank()) {
            emitState(false, "A reunião não foi identificada pelo bridge Android.")
            return
        }

        try {
            val callback = object : MediaProjection.Callback() {
                override fun onStop() {
                    mainHandler.post { stopProjection(true) }
                }
            }
            val screenCapturer = ScreenCapturerAndroid(permissionData, callback)
            val helper = SurfaceTextureHelper.create("DevboardScreenCapture", eglBase!!.eglBaseContext)
            val source = peerFactory.createVideoSource(true)
            screenCapturer.initialize(helper, appContext, source.capturerObserver)

            val metrics = appContext.resources.displayMetrics
            val sourceWidth = metrics.widthPixels.coerceAtLeast(1)
            val sourceHeight = metrics.heightPixels.coerceAtLeast(1)
            val maxDimension = 1280f
            val scale = minOf(1f, maxDimension / maxOf(sourceWidth, sourceHeight).toFloat())
            var width = (sourceWidth * scale).toInt().coerceAtLeast(2)
            var height = (sourceHeight * scale).toInt().coerceAtLeast(2)
            if (width % 2 != 0) width -= 1
            if (height % 2 != 0) height -= 1

            screenCapturer.startCapture(width, height, 15)
            val track = peerFactory.createVideoTrack("devboard-screen-$localSessionId", source)
            track.setEnabled(true)

            capturer = screenCapturer
            surfaceTextureHelper = helper
            videoSource = source
            screenTrack = track
            started = true
            emitState(true)

            recipients.values.forEach(::createSenderPeer)
        } catch (error: Throwable) {
            Log.e(TAG, "Não foi possível iniciar MediaProjection/WebRTC", error)
            stopProjection(false)
            emitState(false, error.message ?: "Não foi possível iniciar o compartilhamento nativo.")
        }
    }

    fun stopProjection(fromSystem: Boolean = false) {
        if (!started && capturer == null) return
        started = false

        val stopSignal = JSONObject()
            .put("type", "native-screen-stop")
            .put("meetingId", meetingId)
            .put("fromSession", localSessionId)
            .put("fromUserId", localUserId)
        recipients.keys.forEach { session ->
            emitSignal(JSONObject(stopSignal.toString()).put("toSession", session))
        }

        peers.keys.toList().forEach { closePeer(it, notify = false) }
        try { capturer?.stopCapture() } catch (_: Throwable) {}
        try { capturer?.dispose() } catch (_: Throwable) {}
        try { screenTrack?.dispose() } catch (_: Throwable) {}
        try { videoSource?.dispose() } catch (_: Throwable) {}
        try { surfaceTextureHelper?.dispose() } catch (_: Throwable) {}
        capturer = null
        screenTrack = null
        videoSource = null
        surfaceTextureHelper = null
        pendingIce.clear()
        emitState(false)

        if (fromSystem) {
            // O serviço encerra a própria notificação ao receber o callback do MediaProjection.
            runCatching {
                appContext.stopService(Intent(appContext, ScreenShareService::class.java))
            }
        }
    }

    fun handleSignal(json: String) {
        try {
            val signal = JSONObject(json)
            if (signal.optString("meetingId") != meetingId) return
            if (signal.optString("toSession") != localSessionId) return
            val fromSession = signal.getString("fromSession")
            when (signal.getString("type")) {
                "native-screen-answer" -> {
                    val peer = peers[fromSession] ?: return
                    val sdp = signal.getJSONObject("sdp")
                    val description = SessionDescription(SessionDescription.Type.ANSWER, sdp.getString("sdp"))
                    peer.setRemoteDescription(object : SimpleSdpObserver() {
                        override fun onSetSuccess() {
                            flushPendingIce(fromSession, peer)
                        }
                    }, description)
                }
                "native-screen-ice" -> {
                    val peer = peers[fromSession] ?: return
                    val candidateJson = signal.getJSONObject("candidate")
                    val candidate = IceCandidate(
                        candidateJson.optString("sdpMid").takeIf { it.isNotBlank() },
                        candidateJson.getInt("sdpMLineIndex"),
                        candidateJson.getString("candidate"),
                    )
                    if (peer.remoteDescription == null) {
                        pendingIce.getOrPut(fromSession) { mutableListOf() }.add(candidate)
                    } else {
                        peer.addIceCandidate(candidate)
                    }
                }
            }
        } catch (error: Throwable) {
            Log.e(TAG, "Falha ao processar sinal nativo", error)
        }
    }

    private fun createSenderPeer(recipient: Recipient) {
        if (!started || peers.containsKey(recipient.sessionId)) return
        val peerFactory = factory ?: return
        val track = screenTrack ?: return

        val config = PeerConnection.RTCConfiguration(iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
            tcpCandidatePolicy = PeerConnection.TcpCandidatePolicy.ENABLED
        }

        val observer = object : PeerConnection.Observer {
            override fun onSignalingChange(newState: PeerConnection.SignalingState?) = Unit
            override fun onIceConnectionChange(newState: PeerConnection.IceConnectionState?) = Unit
            override fun onStandardizedIceConnectionChange(newState: PeerConnection.IceConnectionState?) = Unit
            override fun onConnectionChange(newState: PeerConnection.PeerConnectionState?) {
                if (newState == PeerConnection.PeerConnectionState.FAILED) {
                    mainHandler.postDelayed({
                        if (started && recipients.containsKey(recipient.sessionId)) {
                            closePeer(recipient.sessionId, notify = false)
                            createSenderPeer(recipient)
                        }
                    }, 1500)
                }
            }
            override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
            override fun onIceGatheringChange(newState: PeerConnection.IceGatheringState?) = Unit
            override fun onIceCandidate(candidate: IceCandidate?) {
                if (candidate == null) return
                emitSignal(
                    baseSignal("native-screen-ice", recipient.sessionId)
                        .put("candidate", JSONObject()
                            .put("candidate", candidate.sdp)
                            .put("sdpMid", candidate.sdpMid)
                            .put("sdpMLineIndex", candidate.sdpMLineIndex)),
                )
            }
            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) = Unit
            override fun onAddStream(stream: MediaStream?) = Unit
            override fun onRemoveStream(stream: MediaStream?) = Unit
            override fun onDataChannel(dataChannel: DataChannel?) = Unit
            override fun onRenegotiationNeeded() = Unit
            override fun onAddTrack(receiver: RtpReceiver?, mediaStreams: Array<out MediaStream>?) = Unit
            override fun onTrack(transceiver: RtpTransceiver?) = Unit
            override fun onRemoveTrack(receiver: RtpReceiver?) = Unit
            override fun onSelectedCandidatePairChanged(event: CandidatePairChangeEvent?) = Unit
        }

        val peer = peerFactory.createPeerConnection(config, observer) ?: run {
            emitState(true, "Não foi possível criar o canal nativo de compartilhamento para ${recipient.sessionId}.")
            return
        }
        peers[recipient.sessionId] = peer
        peer.addTrack(track, listOf("devboard-native-screen"))

        val constraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "false"))
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", "false"))
        }
        peer.createOffer(object : SimpleSdpObserver() {
            override fun onCreateSuccess(desc: SessionDescription?) {
                if (desc == null) return
                peer.setLocalDescription(object : SimpleSdpObserver() {
                    override fun onSetSuccess() {
                        emitSignal(
                            baseSignal("native-screen-offer", recipient.sessionId)
                                .put("sdp", JSONObject().put("type", "offer").put("sdp", desc.description)),
                        )
                    }
                    override fun onSetFailure(error: String?) {
                        Log.e(TAG, "setLocalDescription falhou: $error")
                    }
                }, desc)
            }
            override fun onCreateFailure(error: String?) {
                Log.e(TAG, "createOffer falhou: $error")
            }
        }, constraints)
    }

    private fun flushPendingIce(sessionId: String, peer: PeerConnection) {
        pendingIce.remove(sessionId)?.forEach { candidate ->
            runCatching { peer.addIceCandidate(candidate) }
        }
    }

    private fun closePeer(sessionId: String, notify: Boolean) {
        peers.remove(sessionId)?.close()
        pendingIce.remove(sessionId)
        if (notify) {
            emitSignal(baseSignal("native-screen-stop", sessionId))
        }
    }

    private fun baseSignal(type: String, toSession: String): JSONObject = JSONObject()
        .put("type", type)
        .put("meetingId", meetingId)
        .put("fromSession", localSessionId)
        .put("fromUserId", localUserId)
        .put("toSession", toSession)

    private fun emitSignal(payload: JSONObject) {
        mainHandler.post { listener?.onNativeScreenSignal(payload) }
    }

    private fun emitState(active: Boolean, error: String? = null) {
        mainHandler.post { listener?.onNativeScreenState(active, error) }
    }
}
