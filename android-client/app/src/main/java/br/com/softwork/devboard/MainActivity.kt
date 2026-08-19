package br.com.softwork.devboard

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Bundle
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.view.View
import android.widget.FrameLayout
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import br.com.softwork.devboard.bridge.DevboardNativeBridge
import br.com.softwork.devboard.databinding.ActivityMainBinding
import br.com.softwork.devboard.service.ScreenShareService
import br.com.softwork.devboard.webrtc.NativeScreenShareManager
import org.json.JSONObject

class MainActivity : AppCompatActivity(), NativeScreenShareManager.Listener {
    private lateinit var binding: ActivityMainBinding
    private lateinit var projectionManager: MediaProjectionManager
    private var pendingPermissionRequest: PermissionRequest? = null
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var fullscreenView: View? = null
    private var fullscreenCallback: WebChromeClient.CustomViewCallback? = null

    private val mediaProjectionLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        if (result.resultCode != RESULT_OK || result.data == null) {
            emitNativeScreenState(false, "Compartilhamento cancelado pelo usuário.")
            return@registerForActivityResult
        }

        // Android 14+: o usuário precisa consentir a cada sessão. Após o consentimento,
        // iniciamos o foreground service e só então o ScreenCapturerAndroid obtém a projeção.
        val serviceIntent = Intent(this, ScreenShareService::class.java).apply {
            action = ScreenShareService.ACTION_START
            putExtra(ScreenShareService.EXTRA_PERMISSION_DATA, result.data)
        }
        ContextCompat.startForegroundService(this, serviceIntent)
    }

    private val mediaPermissionsLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { grants ->
        val request = pendingPermissionRequest ?: return@registerForActivityResult
        pendingPermissionRequest = null

        val allowed = request.resources.filter { resource ->
            when (resource) {
                PermissionRequest.RESOURCE_VIDEO_CAPTURE -> grants[Manifest.permission.CAMERA] == true
                PermissionRequest.RESOURCE_AUDIO_CAPTURE -> grants[Manifest.permission.RECORD_AUDIO] == true
                else -> false
            }
        }.toTypedArray()

        if (allowed.isNotEmpty()) request.grant(allowed) else request.deny()
    }

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val callback = fileChooserCallback ?: return@registerForActivityResult
        fileChooserCallback = null
        val data = result.data
        val uris = when {
            result.resultCode != RESULT_OK || data == null -> null
            data.clipData != null -> Array(data.clipData!!.itemCount) { index -> data.clipData!!.getItemAt(index).uri }
            data.data != null -> arrayOf(data.data!!)
            else -> null
        }
        callback.onReceiveValue(uris)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        projectionManager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        NativeScreenShareManager.initialize(applicationContext, this)
        configureWebView(binding.webView)

        onBackPressedDispatcher.addCallback(this, object : androidx.activity.OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (fullscreenView != null) {
                    hideFullscreenView()
                } else if (binding.webView.canGoBack()) {
                    binding.webView.goBack()
                } else {
                    finish()
                }
            }
        })

        if (savedInstanceState == null) {
            val url = BuildConfig.DEVBOARD_URL.trim()
            if (!url.startsWith("https://")) {
                binding.webView.loadDataWithBaseURL(
                    null,
                    "<html><body style='font-family:sans-serif;padding:24px'><h2>Configure o Devboard</h2><p>Defina <code>DEVBOARD_URL=https://...</code> em <code>gradle.properties</code> ou na linha de build.</p></body></html>",
                    "text/html",
                    "UTF-8",
                    null,
                )
            } else {
                binding.webView.loadUrl(url)
            }
        } else {
            binding.webView.restoreState(savedInstanceState)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        binding.webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        hideFullscreenView()
        pendingPermissionRequest?.deny()
        pendingPermissionRequest = null
        fileChooserCallback?.onReceiveValue(null)
        fileChooserCallback = null
        binding.webView.removeJavascriptInterface("DevboardNativeBridge")
        binding.webView.destroy()
        super.onDestroy()
    }

    fun requestNativeScreenShare(meetingId: String, sessionId: String, userId: String) {
        NativeScreenShareManager.setSession(meetingId, sessionId, userId)
        mediaProjectionLauncher.launch(projectionManager.createScreenCaptureIntent())
    }

    fun stopNativeScreenShare() {
        val intent = Intent(this, ScreenShareService::class.java).apply { action = ScreenShareService.ACTION_STOP }
        startService(intent)
    }

    override fun onNativeScreenSignal(payload: JSONObject) {
        emitEvent("devboard-native-screen-signal", payload)
    }

    override fun onNativeScreenState(active: Boolean, error: String?) {
        emitNativeScreenState(active, error)
    }

    private fun emitNativeScreenState(active: Boolean, error: String?) {
        val payload = JSONObject().put("active", active)
        if (!error.isNullOrBlank()) payload.put("error", error)
        emitEvent("devboard-native-screen-state", payload)
    }

    private fun emitEvent(name: String, detail: JSONObject) {
        runOnUiThread {
            val javascript = "window.dispatchEvent(new CustomEvent(${JSONObject.quote(name)}, { detail: ${detail} }));"
            binding.webView.evaluateJavascript(javascript, null)
        }
    }

    @Suppress("SetJavaScriptEnabled")
    private fun configureWebView(webView: WebView) {
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.mediaPlaybackRequiresUserGesture = false
        webView.settings.allowFileAccess = false
        webView.settings.allowContentAccess = true
        webView.settings.setSupportMultipleWindows(false)

        webView.addJavascriptInterface(DevboardNativeBridge(this), "DevboardNativeBridge")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val uri = request?.url ?: return false
                if (isTrustedDevboardUri(uri)) return false
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
                return true
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
                if (view == null) {
                    callback?.onCustomViewHidden()
                    return
                }
                if (fullscreenView != null) {
                    callback?.onCustomViewHidden()
                    return
                }

                fullscreenView = view
                fullscreenCallback = callback
                binding.webView.visibility = View.GONE
                binding.root.addView(
                    view,
                    FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.MATCH_PARENT,
                    ),
                )
            }

            override fun onHideCustomView() {
                hideFullscreenView()
            }

            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread { requestWebMediaPermissions(request) }
            }

            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?,
            ): Boolean {
                fileChooserCallback?.onReceiveValue(null)
                fileChooserCallback = filePathCallback
                val intent = (fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT)).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = fileChooserParams?.acceptTypes?.firstOrNull()?.takeIf { it.isNotBlank() } ?: "*/*"
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, fileChooserParams?.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
                }
                return runCatching {
                    fileChooserLauncher.launch(intent)
                    true
                }.getOrElse {
                    fileChooserCallback = null
                    false
                }
            }
        }
    }

    private fun hideFullscreenView() {
        val view = fullscreenView ?: return
        binding.root.removeView(view)
        fullscreenView = null
        binding.webView.visibility = View.VISIBLE
        fullscreenCallback?.onCustomViewHidden()
        fullscreenCallback = null
    }

    private fun requestWebMediaPermissions(request: PermissionRequest) {
        if (!isTrustedDevboardUri(request.origin)) {
            request.deny()
            return
        }

        val needed = mutableListOf<String>()
        if (request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE) &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED
        ) needed += Manifest.permission.CAMERA
        if (request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE) &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED
        ) needed += Manifest.permission.RECORD_AUDIO

        if (needed.isEmpty()) {
            request.grant(request.resources.filter {
                it == PermissionRequest.RESOURCE_VIDEO_CAPTURE || it == PermissionRequest.RESOURCE_AUDIO_CAPTURE
            }.toTypedArray())
            return
        }

        pendingPermissionRequest?.deny()
        pendingPermissionRequest = request
        mediaPermissionsLauncher.launch(needed.toTypedArray())
    }

    private fun isTrustedDevboardUri(uri: Uri): Boolean {
        val configured = runCatching { Uri.parse(BuildConfig.DEVBOARD_URL) }.getOrNull() ?: return false
        return uri.scheme == configured.scheme && uri.host == configured.host
    }
}
