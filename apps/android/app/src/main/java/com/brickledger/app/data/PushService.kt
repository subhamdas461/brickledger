package com.brickledger.app.data

import com.brickledger.app.BrickLedgerApp
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Receives the server's instant "team update" pushes (Firebase Cloud Messaging). High-priority pushes
 * wake the app even when the phone is idle; it then has a few seconds to show the notification.
 */
class PushService : FirebaseMessagingService() {
    private val container get() = (application as BrickLedgerApp).container

    override fun onMessageReceived(message: RemoteMessage) {
        if (message.data["type"] != "activity") return
        // Runs on Firebase's background thread; finish before it returns so Android keeps us awake.
        runBlocking { withTimeoutOrNull(9_000) { container.notifications.onPush(message.data) } }
    }

    /** Google issued this install a new token: tell the server, or pushes would go to the old one. */
    override fun onNewToken(token: String) {
        container.appScope.launch {
            if (!container.session.loaded.value) container.session.load()
            container.notifications.registerDevice(token)
        }
    }
}
