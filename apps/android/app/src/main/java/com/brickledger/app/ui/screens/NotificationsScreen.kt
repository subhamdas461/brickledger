package com.brickledger.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material.icons.rounded.DoneAll
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.NotificationsNone
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.brickledger.app.AppContainer
import com.brickledger.app.core.Dates
import com.brickledger.app.core.activityWords
import com.brickledger.app.data.OpenTarget
import com.brickledger.app.data.remote.NotificationDto
import com.brickledger.app.data.remote.userMessage
import com.brickledger.app.ui.components.Avatar
import com.brickledger.app.ui.components.EmptyView
import com.brickledger.app.ui.components.LoadingBox
import com.brickledger.app.ui.components.ScreenScaffold
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.launch

private const val PAGE = 40

/** The bell: opens the list of changes other members made; shows how many are unread. */
@Composable
fun NotificationBell(container: AppContainer, onClick: () -> Unit) {
    val unread by container.notifications.unread.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { container.notifications.refreshCount() }
    IconButton(onClick = onClick) {
        BadgedBox(badge = { if (unread > 0) Badge { Text(if (unread > 99) "99+" else "$unread") } }) {
            Icon(Icons.Rounded.Notifications, contentDescription = if (unread > 0) "Notifications, $unread unread" else "Notifications")
        }
    }
}

/** Changes other members made in your projects, newest first. Opening it marks them read. */
@Composable
fun NotificationsScreen(container: AppContainer, onBack: () -> Unit, onOpen: (OpenTarget) -> Unit) {
    var items by remember { mutableStateOf<List<NotificationDto>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var hasMore by remember { mutableStateOf(false) }
    var loadingMore by remember { mutableStateOf(false) }
    var attempt by remember { mutableStateOf(0) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(attempt) {
        error = null
        runCatching { container.notifications.list() }
            .onSuccess { res ->
                items = res.items
                hasMore = res.items.size >= PAGE
                // Seen now; the "new" dots stay until the screen is left.
                if (res.unread > 0) container.notifications.markRead(res.latestId)
                container.notifications.markShown(res.latestId)
            }
            .onFailure { error = it.userMessage() }
    }

    ScreenScaffold(
        title = "Notifications",
        subtitle = "Changes by your team",
        onBack = onBack,
        actions = {
            if (!items.isNullOrEmpty()) {
                IconButton(onClick = { scope.launch { items?.maxOfOrNull { it.id }?.let { container.notifications.markRead(it) }; items = items?.map { it.copy(unread = false) } } }) {
                    Icon(Icons.Rounded.DoneAll, contentDescription = "Mark all read")
                }
            }
        },
    ) { padding ->
        val list = items
        Box(Modifier.padding(padding).fillMaxSize()) {
            when {
                list == null && error == null -> LoadingBox()
                list == null -> EmptyView(Icons.Rounded.CloudOff, "Can’t load notifications", error.orEmpty()) {
                    Button(onClick = { attempt++ }) { Text("Try again") }
                }
                list.isEmpty() -> EmptyView(Icons.Rounded.NotificationsNone, "You’re all caught up", "When your team adds or changes anything in your projects, it shows up here.")
                else -> LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
                    val zone = ZoneId.systemDefault()
                    list.groupBy { runCatching { Instant.parse(it.createdAt).atZone(zone).toLocalDate().toString() }.getOrDefault(it.createdAt.take(10)) }
                        .forEach { (day, group) ->
                            item(key = "day-$day") {
                                Text(
                                    Dates.relativeDay(day).uppercase(),
                                    style = MaterialTheme.typography.labelMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(start = 16.dp, top = 16.dp, bottom = 4.dp),
                                )
                            }
                            items(group, key = { it.id }) { n -> NotificationRow(n) { onOpen(OpenTarget.of(n.projectId, n.entityType)) } }
                        }
                    if (hasMore) {
                        item {
                            TextButton(
                                enabled = !loadingMore,
                                onClick = {
                                    loadingMore = true
                                    scope.launch {
                                        runCatching { container.notifications.list(before = list.last().id) }
                                            .onSuccess { res ->
                                                items = list + res.items
                                                hasMore = res.items.size >= PAGE
                                            }
                                        loadingMore = false
                                    }
                                },
                                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                            ) { Text(if (loadingMore) "Loading…" else "Show older") }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun NotificationRow(n: NotificationDto, onClick: () -> Unit) {
    val name = n.user?.name ?: "Someone"
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .background(if (n.unread) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.35f) else MaterialTheme.colorScheme.surface)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Avatar(name, size = 36.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                buildAnnotatedString {
                    withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(name) }
                    append(activityWords(n.summary, n.user?.name))
                },
                style = MaterialTheme.typography.bodyMedium,
            )
            Text(
                "${n.projectName} · ${ago(n.createdAt)}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (n.unread) {
            Spacer(Modifier.width(8.dp))
            Box(Modifier.padding(top = 6.dp).size(8.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary))
        }
    }
}

private fun ago(iso: String): String {
    val then = runCatching { Instant.parse(iso) }.getOrNull() ?: return ""
    val minutes = Duration.between(then, Instant.now()).toMinutes().coerceAtLeast(0)
    return when {
        minutes < 1 -> "just now"
        minutes < 60 -> "$minutes min ago"
        minutes < 24 * 60 -> "${minutes / 60} h ago"
        minutes < 7 * 24 * 60 -> "${minutes / (24 * 60)} d ago"
        else -> Dates.short(iso)
    }
}
