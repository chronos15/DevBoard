package br.com.softwork.devboard.bridge

import android.webkit.JavascriptInterface
import br.com.softwork.devboard.MainActivity
import br.com.softwork.devboard.webrtc.NativeScreenShareManager

class DevboardNativeBridge(
    private val activity: MainActivity,
) {
    @JavascriptInterface
    fun getCapabilities(): String = """{"android":true,"mediaProjection":true,"bridgeVersion":1}"""

    @JavascriptInterface
    fun configureIceServers(json: String) {
        NativeScreenShareManager.configureIceServers(json)
    }

    @JavascriptInterface
    fun requestScreenShare(meetingId: String, sessionId: String, userId: String) {
        activity.runOnUiThread {
            activity.requestNativeScreenShare(meetingId, sessionId, userId)
        }
    }

    @JavascriptInterface
    fun stopScreenShare() {
        activity.runOnUiThread {
            activity.stopNativeScreenShare()
        }
    }

    @JavascriptInterface
    fun syncScreenRecipients(json: String) {
        NativeScreenShareManager.syncRecipients(json)
    }

    @JavascriptInterface
    fun handleScreenSignal(json: String) {
        NativeScreenShareManager.handleSignal(json)
    }
}
