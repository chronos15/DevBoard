package br.com.softwork.devboard.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import br.com.softwork.devboard.R
import br.com.softwork.devboard.webrtc.NativeScreenShareManager

class ScreenShareService : Service() {
    companion object {
        const val ACTION_START = "br.com.softwork.devboard.SCREEN_SHARE_START"
        const val ACTION_STOP = "br.com.softwork.devboard.SCREEN_SHARE_STOP"
        const val EXTRA_PERMISSION_DATA = "permission_data"
        private const val CHANNEL_ID = "devboard-screen-share"
        private const val NOTIFICATION_ID = 3201
    }

    override fun onCreate() {
        super.onCreate()
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                NativeScreenShareManager.stopProjection(false)
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_START -> {
                val notification = NotificationCompat.Builder(this, CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_screen_share)
                    .setContentTitle(getString(R.string.app_name))
                    .setContentText(getString(R.string.screen_share_notification))
                    .setOngoing(true)
                    .setCategory(NotificationCompat.CATEGORY_SERVICE)
                    .build()

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(
                        NOTIFICATION_ID,
                        notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION,
                    )
                } else {
                    startForeground(NOTIFICATION_ID, notification)
                }

                val permissionData = if (Build.VERSION.SDK_INT >= 33) {
                    intent.getParcelableExtra(EXTRA_PERMISSION_DATA, Intent::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra(EXTRA_PERMISSION_DATA)
                }

                if (permissionData == null) {
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    stopSelf()
                    return START_NOT_STICKY
                }

                NativeScreenShareManager.startProjection(permissionData)
                return START_STICKY
            }
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        NativeScreenShareManager.stopProjection(false)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.screen_share_channel),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Mantém a captura de tela ativa enquanto você compartilha no Devboard."
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }
}
