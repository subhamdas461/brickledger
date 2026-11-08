package com.brickledger.app.ui.screens

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.brickledger.app.AppContainer
import com.brickledger.app.core.Dates
import com.brickledger.app.data.BackupInbox
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.launch

/** Opens the system file picker for a backup; the chosen file goes to [RestoreBackupDialog] for confirmation. */
@Composable
fun rememberBackupPicker(container: AppContainer): () -> Unit {
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) container.appScope.launch { container.backupInbox.offer(uri) }
    }
    // "*/*" too: chat and cloud apps often label a .zip with a generic type.
    return { launcher.launch(arrayOf("application/zip", "application/x-zip-compressed", "*/*")) }
}

/** Confirmation for a backup that was opened, shared or picked: shows what it holds, then restores it. */
@Composable
fun RestoreBackupDialog(state: BackupInbox.State, onRestore: () -> Unit, onDismiss: () -> Unit) {
    when (state) {
        BackupInbox.State.Reading -> AlertDialog(
            onDismissRequest = {},
            title = { Text("Reading backup…") },
            text = {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 3.dp)
                    Text("Checking the file", style = MaterialTheme.typography.bodyMedium)
                }
            },
            confirmButton = {},
        )
        is BackupInbox.State.Failed -> AlertDialog(
            onDismissRequest = onDismiss,
            title = { Text("Couldn’t restore the backup") },
            text = { Text(state.message, style = MaterialTheme.typography.bodyMedium) },
            confirmButton = { TextButton(onClick = onDismiss) { Text("OK") } },
        )
        is BackupInbox.State.Ready -> {
            val b = state.incoming.backup
            val backedUp = runCatching { Instant.parse(b.exportedAt).atZone(ZoneId.systemDefault()).toLocalDate().toString() }.getOrNull()
            AlertDialog(
                onDismissRequest = { if (!state.restoring) onDismiss() },
                title = { Text("Restore this backup?") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(b.project.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        backedUp?.let { Text("Backed up ${Dates.format(it)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        Text(state.incoming.summary, style = MaterialTheme.typography.bodyMedium)
                        Text(
                            "It’s added to this phone as a new project - nothing already here is changed. No account or internet needed.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                confirmButton = {
                    TextButton(onClick = onRestore, enabled = !state.restoring) { Text(if (state.restoring) "Restoring…" else "Restore") }
                },
                dismissButton = { TextButton(onClick = onDismiss, enabled = !state.restoring) { Text("Cancel") } },
            )
        }
    }
}
