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
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.brickledger.app.BrickLedgerApp
import com.brickledger.app.MainActivity
import com.brickledger.app.R
import com.brickledger.app.core.isoPlusDays
import com.brickledger.app.core.todayIso
import java.time.Duration
import java.time.LocalDateTime
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.flow.first

/** Daily morning digest: overdue/upcoming payments, low stock and overdue tasks - computed offline. */
class ReminderWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val container = (applicationContext as BrickLedgerApp).container
        if (!container.session.loaded.value) container.session.load()
        if (!container.session.isActive) return Result.success()
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(applicationContext, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return Result.success()
        }
        val db = container.db
        val today = todayIso()
        val soon = isoPlusDays(today, 3)
        db.projects().all().forEachIndexed { index, project ->
            val totals = db.expenses().totalsNow(project.id, today, soon)
            val tasks = db.tasks().observeCounts(project.id, today).first()
            val stock = db.movements().stockNow(project.id).associateBy { it.materialId }
            val low = db.materials().observe(project.id).first().count { m ->
                val s = stock[m.id]
                (m.minStock ?: 0.0) > 0 && ((s?.received ?: 0.0) - (s?.used ?: 0.0)) < (m.minStock ?: 0.0)
            }
            val parts = buildList {
                if (totals.overdueCount > 0) add("${totals.overdueCount} overdue payment${if (totals.overdueCount == 1) "" else "s"}")
                if (totals.dueSoonCount > 0) add("${totals.dueSoonCount} due in 3 days")
                if (low > 0) add("$low low-stock material${if (low == 1) "" else "s"}")
                if (tasks.flagged > 0) add("${tasks.flagged} overdue task${if (tasks.flagged == 1) "" else "s"}")
            }
            if (parts.isNotEmpty()) notify(applicationContext, 1000 + index, project.name, parts.joinToString(" · "))
        }
        return Result.success()
    }

    companion object {
        const val CHANNEL = "reminders"

        fun createChannel(context: Context) {
            val manager = context.getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL, context.getString(R.string.notification_channel_reminders), NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = context.getString(R.string.notification_channel_reminders_desc)
                },
            )
        }

        /** Every day at about 9:00. */
        fun schedule(context: Context) {
            val now = LocalDateTime.now()
            var next = now.withHour(9).withMinute(0).withSecond(0)
            if (!next.isAfter(now)) next = next.plusDays(1)
            val request = PeriodicWorkRequestBuilder<ReminderWorker>(24, TimeUnit.HOURS)
                .setInitialDelay(Duration.between(now, next).toMinutes(), TimeUnit.MINUTES)
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork("daily-reminders", ExistingPeriodicWorkPolicy.KEEP, request)
        }

        private fun notify(context: Context, id: Int, title: String, text: String) {
            val intent = PendingIntent.getActivity(
                context, 0, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val notification = NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(NotificationCompat.BigTextStyle().bigText(text))
                .setContentIntent(intent)
                .setAutoCancel(true)
                .build()
            runCatching { NotificationManagerCompat.from(context).notify(id, notification) }
        }
    }
}
