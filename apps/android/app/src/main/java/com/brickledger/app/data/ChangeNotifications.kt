package com.brickledger.app.data

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.brickledger.app.BrickLedgerApp
import com.brickledger.app.MainActivity
import com.brickledger.app.R
import com.brickledger.app.core.activityWords
import com.brickledger.app.data.remote.ApiService
import com.brickledger.app.data.remote.DeviceRequest
import com.brickledger.app.data.remote.MarkReadRequest
import com.brickledger.app.data.remote.NotificationDto
import com.brickledger.app.data.remote.NotificationsResponse
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.suspendCancellableCoroutine

/** Where a notification leads inside the app: a tab of the project screen, or one of its sections. */
data class OpenTarget(val projectId: String, val tab: Int = 0, val section: String? = null) {
    companion object {
        fun of(projectId: String, entityType: String?): OpenTarget = when (entityType) {
            "expenses" -> OpenTarget(projectId, tab = 1)
            "workers", "attendance" -> OpenTarget(projectId, tab = 2)
            "materials", "movements" -> OpenTarget(projectId, tab = 3)
            "categories" -> OpenTarget(projectId, section = "budget")
            "phases" -> OpenTarget(projectId, section = "schedule")
            "vendors" -> OpenTarget(projectId, section = "vendors")
            "funds" -> OpenTarget(projectId, section = "funds")
            "tasks" -> OpenTarget(projectId, section = "tasks")
            "logs" -> OpenTarget(projectId, section = "diary")
            "issues" -> OpenTarget(projectId, section = "issues")
            "files" -> OpenTarget(projectId, section = "documents")
            "members" -> OpenTarget(projectId, section = "team")
            else -> OpenTarget(projectId)
        }
    }
}

/**
 * Changes other members make in your projects: the unread count behind the in-app bell, the list,
 * and phone notifications. With Firebase set up, the server pushes each change the moment it is saved;
 * a check every 15 minutes is the fallback (no Firebase, or a push that didn't arrive).
 */
class ChangeNotifications(private val context: Context, private val api: ApiService, private val session: SessionStore) {
    private val _unread = MutableStateFlow(0)
    val unread: StateFlow<Int> = _unread.asStateFlow()

    /** Set by a tapped notification; the navigation host opens it. */
    val openRequest = MutableStateFlow<OpenTarget?>(null)

    suspend fun refreshCount() {
        if (!session.isLoggedIn) {
            _unread.value = 0
            return
        }
        runCatching { api.notificationCount() }.onSuccess { _unread.value = it.unread }
    }

    suspend fun list(before: Long? = null): NotificationsResponse = api.notifications(limit = 40, before = before).also { _unread.value = it.unread }

    /** Seen in the app's list: the background check needn't announce these on the phone as well. */
    suspend fun markShown(upTo: Long) {
        val current = session.notifiedUpTo ?: return
        if (upTo > current) session.setNotifiedUpTo(upTo)
    }

    suspend fun markRead(upTo: Long) {
        runCatching { api.markNotificationsRead(MarkReadRequest(upTo)) }.onSuccess {
            _unread.value = it.unread
            // Read in the app: clear them from the notification shade too.
            if (it.unread == 0) cancelPosted()
        }
    }

    // ------------------------------------------------------------ instant (Firebase)

    /** Firebase is set up in this build (app/google-services.json was present). */
    private val pushAvailable: Boolean get() = runCatching { FirebaseApp.getApps(context).isNotEmpty() }.getOrDefault(false)

    private suspend fun pushToken(): String? = if (!pushAvailable) null else suspendCancellableCoroutine { cont ->
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task -> cont.resume(if (task.isSuccessful) task.result else null) }
    }

    /** Tells the server where to push. Called after sign-in, on start, and when Google issues a new token. */
    suspend fun registerDevice(token: String? = null) {
        if (!session.isLoggedIn || !session.notifyChanges.value) return
        val t = token ?: pushToken() ?: return
        runCatching { api.registerDevice(DeviceRequest(t)) }
    }

    /** Before signing out, or when team updates are turned off: no more pushes to this phone. */
    suspend fun unregisterDevice() {
        val t = pushToken() ?: return
        runCatching { api.removeDevice(DeviceRequest(t)) }
    }

    /** A push about a change: show it right away, grouped with the project's other unread changes. */
    suspend fun onPush(data: Map<String, String>) {
        if (!session.loaded.value) session.load()
        if (!session.isLoggedIn || data["to"] != session.profile.value?.user?.id) return // someone else signed in here now
        val id = data["id"]?.toLongOrNull() ?: return
        try {
            notifyNew(pushedId = id)
        } catch (e: Exception) {
            // Couldn't fetch the details (no signal for long enough): show what the push itself says.
            if ((session.notifiedUpTo ?: 0) >= id) return
            session.setNotifiedUpTo(id)
            val projectId = data["projectId"] ?: return
            if (session.notifyChanges.value && permitted()) {
                post(projectId, data["projectName"].orEmpty(), listOf(data["text"].orEmpty()), data["entityType"]?.ifBlank { null }, System.currentTimeMillis())
            }
        }
    }

    // ------------------------------------------------------------ shared by pushes and the 15-minute check

    /**
     * Shows phone notifications for changes not announced yet, one per project, listing that project's
     * unread changes. The first check after signing in only notes where things stand.
     */
    suspend fun notifyNew(pushedId: Long? = null) {
        if (!session.isLoggedIn) return
        val since = session.notifiedUpTo ?: pushedId?.minus(1)
        if (since == null) {
            val now = api.notificationCount()
            _unread.value = now.unread
            session.setNotifiedUpTo(now.latestId)
            return
        }
        val res = api.notifications(limit = 50)
        _unread.value = res.unread
        val fresh = res.items.filter { it.id > since }
        if (fresh.isEmpty()) return
        session.setNotifiedUpTo(maxOf(since, fresh.maxOf { it.id }))
        if (!session.notifyChanges.value || !permitted()) return
        val shown = res.items.filter { it.unread || it.id > since }.groupBy { it.projectId }
        for (projectId in fresh.map { it.projectId }.distinct()) {
            val items = shown[projectId].orEmpty().sortedByDescending { it.id }
            val newest = items.first()
            post(
                projectId,
                newest.projectName,
                items.map(::line),
                newest.entityType.takeIf { items.distinctBy { it.entityType }.size == 1 },
                runCatching { java.time.Instant.parse(newest.createdAt).toEpochMilli() }.getOrDefault(System.currentTimeMillis()),
            )
        }
    }

    private fun line(n: NotificationDto) = "${n.user?.name ?: "Someone"}${activityWords(n.summary, n.user?.name)}"

    private fun permitted() = Build.VERSION.SDK_INT < 33 ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    /** One notification per project; a newer one replaces it. */
    private fun post(projectId: String, projectName: String, lines: List<String>, entityType: String?, whenMillis: Long) {
        if (lines.isEmpty()) return
        val title = projectName.ifBlank { "BrickLedger" }
        val text = if (lines.size == 1) lines.first() else "${lines.size} new changes"
        val open = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_PROJECT, projectId)
            .putExtra(EXTRA_ENTITY, entityType)
        val intent = PendingIntent.getActivity(context, projectId.hashCode(), open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val style = NotificationCompat.InboxStyle().setBigContentTitle(title)
        lines.take(6).forEach { style.addLine(it) }
        if (lines.size > 6) style.setSummaryText("+${lines.size - 6} more")
        val notification = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(if (lines.size == 1) NotificationCompat.BigTextStyle().bigText(text) else style)
            .setNumber(lines.size)
            .setWhen(whenMillis)
            .setShowWhen(true)
            .setCategory(NotificationCompat.CATEGORY_SOCIAL)
            .setContentIntent(intent)
            .setAutoCancel(true)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(TAG_PREFIX + projectId, NOTIFICATION_ID, notification) }
    }

    private fun cancelPosted() {
        val manager = context.getSystemService(NotificationManager::class.java)
        runCatching { manager.activeNotifications.filter { it.tag?.startsWith(TAG_PREFIX) == true }.forEach { manager.cancel(it.tag, it.id) } }
    }

    companion object {
        /** High importance, so a change pops up on screen. (A channel's importance can't change once made, hence a new id.) */
        const val CHANNEL = "team_updates"
        private const val OLD_CHANNEL = "changes"
        const val EXTRA_PROJECT = "com.brickledger.app.OPEN_PROJECT"
        const val EXTRA_ENTITY = "com.brickledger.app.OPEN_ENTITY"
        private const val TAG_PREFIX = "changes:"
        private const val NOTIFICATION_ID = 7

        fun createChannel(context: Context) {
            val manager = context.getSystemService(NotificationManager::class.java)
            manager.deleteNotificationChannel(OLD_CHANNEL)
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL, context.getString(R.string.notification_channel_changes), NotificationManager.IMPORTANCE_HIGH).apply {
                    description = context.getString(R.string.notification_channel_changes_desc)
                },
            )
        }

        /** One check as soon as there is a connection (after signing in: registers for pushes, notes where things stand). */
        fun checkSoon(context: Context) {
            val request = OneTimeWorkRequestBuilder<ChangesWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork("team-updates-now", ExistingWorkPolicy.REPLACE, request)
        }

        /** The fallback: every 15 minutes (Android's shortest background interval), when there is a connection. */
        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<ChangesWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork("team-updates", ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }
}

class ChangesWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val container = (applicationContext as BrickLedgerApp).container
        if (!container.session.loaded.value) container.session.load()
        return try {
            container.notifications.registerDevice()
            container.notifications.notifyNew()
            Result.success()
        } catch (e: java.io.IOException) {
            // No connection (or Android cut this app's network): try again soon. Nothing is lost; the server keeps the list.
            Result.retry()
        } catch (e: Exception) {
            Result.success()
        }
    }
}
