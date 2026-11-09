package com.brickledger.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.brickledger.app.BuildConfig
import com.brickledger.app.data.AndroidRelease
import com.brickledger.app.data.AppUpdates

private fun sizeText(release: AndroidRelease) =
    if (release.size > 0) "%.1f MB".format(release.size / 1024f / 1024f) else null

/** The update prompt, shown over any screen. Nothing is shown when up to date or after "Later". */
@Composable
fun UpdateDialog(state: AppUpdates.State, updates: AppUpdates) {
    val context = LocalContext.current
    when (state) {
        AppUpdates.State.None -> Unit
        is AppUpdates.State.Available -> if (state.prompt) {
            val r = state.release
            AlertDialog(
                onDismissRequest = updates::later,
                title = { Text("Update available") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("BrickLedger ${r.versionName}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Text(
                            listOfNotNull("You have ${BuildConfig.VERSION_NAME}", sizeText(r)?.let { "$it download" }).joinToString(" · "),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        r.notes?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
                        Text("Your projects stay as they are.", style = MaterialTheme.typography.bodyMedium)
                    }
                },
                confirmButton = { TextButton(onClick = updates::startDownload) { Text("Update now") } },
                dismissButton = { TextButton(onClick = updates::later) { Text("Later") } },
            )
        }
        is AppUpdates.State.Downloading -> AlertDialog(
            onDismissRequest = {},
            title = { Text("Downloading update") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    val progress = state.progress
                    if (progress != null) LinearProgressIndicator(progress = { progress }, modifier = Modifier.fillMaxWidth())
                    else LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                    Text(
                        listOfNotNull(progress?.let { "${(it * 100).toInt()}%" }, sizeText(state.release)?.let { "of $it" }).joinToString(" "),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            },
            confirmButton = {},
            dismissButton = { TextButton(onClick = updates::later) { Text("Cancel") } },
        )
        is AppUpdates.State.Ready -> AlertDialog(
            onDismissRequest = {},
            title = { Text("Ready to install") },
            text = {
                Text(
                    "Android will ask you to confirm. The first time, it also asks you to allow installs from BrickLedger: turn that on and go back. If you land here again, tap Install, then Update.",
                    style = MaterialTheme.typography.bodyMedium,
                )
            },
            confirmButton = { TextButton(onClick = updates::install) { Text("Install") } },
            dismissButton = { TextButton(onClick = updates::later) { Text("Later") } },
        )
        is AppUpdates.State.Failed -> AlertDialog(
            onDismissRequest = updates::later,
            title = { Text("Update didn’t finish") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(state.message, style = MaterialTheme.typography.bodyMedium)
                    TextButton(onClick = { openUrl(context, updates.downloadPageUrl) }) { Text("Download from the website instead") }
                }
            },
            confirmButton = { TextButton(onClick = updates::startDownload) { Text("Try again") } },
            dismissButton = { TextButton(onClick = updates::later) { Text("Later") } },
        )
    }
}
