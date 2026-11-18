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
import com.brickledger.app.data.remote.MarkReadRequest
import com.brickledger.app.data.remote.NotificationDto
import com.brickledger.app.data.remote.NotificationsResponse
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

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
 * and phone notifications (checked every 15 minutes in the background).
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
        runCatching { api.markNotificationsRead(MarkReadRequest(upTo)) }.onSuccess { _unread.value = it.unread }
    }

    /** Posts phone notifications for changes not shown yet. The first check only notes where things stand. */
    suspend fun notifyNew() {
        if (!session.isLoggedIn) return
        val since = session.notifiedUpTo
        if (since == null) {
            val now = api.notificationCount()
            _unread.value = now.unread
            session.setNotifiedUpTo(now.latestId)
            return
        }
        val res = api.notifications(limit = 50, after = since)
        _unread.value = res.unread
        if (res.items.isEmpty()) return
        session.setNotifiedUpTo(maxOf(since, res.items.maxOf { it.id }))
        if (!session.notifyChanges.value || !permitted()) return
        res.items.groupBy { it.projectId }.forEach { (projectId, items) -> post(projectId, items) }
    }

    private fun permitted() = Build.VERSION.SDK_INT < 33 ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    /** One notification per project, newest change first; a later one replaces it. */
    private fun post(projectId: String, items: List<NotificationDto>) {
        val newest = items.maxBy { it.id }
        val lines = items.sortedByDescending { it.id }.map { "${it.user?.name ?: "Someone"}${activityWords(it.summary, it.user?.name)}" }
        val title = newest.projectName.ifBlank { "BrickLedger" }
        val text = if (lines.size == 1) lines.first() else "${lines.size} new changes"
        val open = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_PROJECT, projectId)
            .putExtra(EXTRA_ENTITY, if (items.distinctBy { it.entityType }.size == 1) newest.entityType else null)
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
            .setWhen(runCatching { java.time.Instant.parse(newest.createdAt).toEpochMilli() }.getOrDefault(System.currentTimeMillis()))
            .setShowWhen(true)
            .setContentIntent(intent)
            .setAutoCancel(true)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify("changes:$projectId", NOTIFICATION_ID, notification) }
    }

    companion object {
        const val CHANNEL = "changes"
        const val EXTRA_PROJECT = "com.brickledger.app.OPEN_PROJECT"
        const val EXTRA_ENTITY = "com.brickledger.app.OPEN_ENTITY"
        private const val NOTIFICATION_ID = 7

        fun createChannel(context: Context) {
            context.getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(CHANNEL, context.getString(R.string.notification_channel_changes), NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = context.getString(R.string.notification_channel_changes_desc)
                },
            )
        }

        /** One check as soon as there is a connection (after signing in: notes where things stand). */
        fun checkSoon(context: Context) {
            val request = OneTimeWorkRequestBuilder<ChangesWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork("team-updates-now", ExistingWorkPolicy.REPLACE, request)
        }

        /** Every 15 minutes (Android's shortest background interval), when there is a connection. */
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
