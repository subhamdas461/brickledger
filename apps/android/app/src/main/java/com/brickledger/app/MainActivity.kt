package com.brickledger.app

import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.getValue
import androidx.core.content.IntentCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import com.brickledger.app.data.remote.userMessage
import com.brickledger.app.ui.navigation.AppNavHost
import com.brickledger.app.ui.theme.BrickLedgerTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val container get() = (application as BrickLedgerApp).container

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        splash.setKeepOnScreenCondition { !container.session.loaded.value }
        lifecycleScope.launch {
            if (!container.session.loaded.value) container.session.load()
            // After a rotation or process restore the launching intent was already handled.
            if (savedInstanceState == null) handleIntent(intent)
        }
        setContent {
            val theme by container.session.theme.collectAsStateWithLifecycle()
            val loaded by container.session.loaded.collectAsStateWithLifecycle()
            val dark = when (theme) {
                "dark" -> true
                "light" -> false
                else -> isSystemInDarkTheme()
            }
            BrickLedgerTheme(darkTheme = dark) {
                if (loaded) AppNavHost(container)
            }
        }
    }

    override fun onStart() {
        super.onStart()
        container.updates.checkIfDue()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        lifecycleScope.launch { handleIntent(intent) }
    }

    private suspend fun handleIntent(intent: Intent?) {
        intent ?: return
        // A project backup opened ("Open with") or shared ("Share") from WhatsApp, Gmail, Drive, Files...
        backupUri(intent)?.let { container.backupInbox.offer(it); return }
        handleInvite(intent)
    }

    private fun backupUri(intent: Intent): Uri? = when (intent.action) {
        Intent.ACTION_VIEW -> intent.data?.takeIf { it.scheme == ContentResolver.SCHEME_CONTENT }
        Intent.ACTION_SEND -> IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)
        else -> null
    }

    /** https://brickledger.app/invite/<token>: join now if signed in, otherwise after sign-in. */
    private suspend fun handleInvite(intent: Intent) {
        val uri = intent.data ?: return
        if (uri.pathSegments.firstOrNull() != "invite") return
        val token = uri.lastPathSegment ?: return
        intent.data = null
        if (container.session.isLoggedIn) {
            runCatching { container.repo.acceptInvite(token) }
                .onSuccess { Toast.makeText(this, "You joined the project", Toast.LENGTH_LONG).show() }
                .onFailure { Toast.makeText(this, it.userMessage(), Toast.LENGTH_LONG).show() }
        } else {
            container.session.setPendingInvite(token)
            Toast.makeText(this, "Sign in or create an account to join the project", Toast.LENGTH_LONG).show()
        }
    }
}
