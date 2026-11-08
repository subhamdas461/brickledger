package com.brickledger.app.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Logout
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.PictureAsPdf
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHostState
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.brickledger.app.AppContainer
import com.brickledger.app.BuildConfig
import com.brickledger.app.core.Dates
import com.brickledger.app.core.Vocab
import com.brickledger.app.data.SyncManager
import com.brickledger.app.data.local.ProjectEntity
import com.brickledger.app.data.remote.ActivityDto
import com.brickledger.app.data.remote.MembersResponse
import com.brickledger.app.data.remote.userMessage
import com.brickledger.app.ui.components.Avatar
import com.brickledger.app.ui.components.CardTitle
import com.brickledger.app.ui.components.ConfirmDialog
import com.brickledger.app.ui.components.LoadingBox
import com.brickledger.app.ui.components.ScreenScaffold
import com.brickledger.app.ui.components.SectionCard
import com.brickledger.app.ui.components.SectionLabel
import com.brickledger.app.ui.components.StatusChip
import com.brickledger.app.ui.components.Tone
import java.io.File
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.launch

fun shareFile(context: android.content.Context, file: File, mime: String) {
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
    val intent = Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    context.startActivity(Intent.createChooser(intent, file.name))
}

private val exports = listOf(
    "expenses" to "Expenses", "budget" to "Budget vs actual", "vendors" to "Vendor balances", "materials" to "Material stock",
    "stock" to "Stock movements", "labour" to "Wages", "attendance" to "Attendance", "funds" to "Funds", "tasks" to "Tasks", "issues" to "Issues", "logs" to "Site diary",
)

@Composable
fun ReportsSection(container: AppContainer, p: ProjectEntity, snackbar: SnackbarHostState) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf<String?>(null) }
    val slug = p.name.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-').take(40)

    /** Generated on the phone: phone-only projects, and cloud projects when there is no internet. */
    suspend fun onDevice(kind: String): java.io.File = if (kind == "pdf") container.reports.pdf(p) else container.reports.csv(p, kind)

    fun download(kind: String, fileName: String, mime: String, open: Boolean) {
        busy = kind
        scope.launch {
            runCatching {
                if (p.isLocal) {
                    onDevice(kind)
                } else {
                    try {
                        container.repo.download(p.id, kind, fileName)
                    } catch (e: java.io.IOException) {
                        if (kind == "pdf" && !p.features.pdfReports) throw e
                        if (kind !in localExports.map { it.first } && kind != "pdf") throw e
                        onDevice(kind)
                    }
                }
            }
                .onSuccess { if (open) openFile(context, it, mime) else shareFile(context, it, mime) }
                .onFailure { snackbar.showSnackbar(it.userMessage()) }
            busy = null
        }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SectionCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.PictureAsPdf, null, tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(10.dp))
                CardTitle("Project cost report", "Budget vs actual, spending, vendors, stock, labour and funding")
            }
            if (!p.isLocal && !p.features.pdfReports) {
                Text("PDF reports are part of Pro and Business plans. You can upgrade from the web app.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
            }
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { download("pdf", "$slug-report.pdf", "application/pdf", open = true) }, enabled = busy == null) {
                    Icon(Icons.Rounded.Download, null)
                    Spacer(Modifier.width(6.dp))
                    Text(if (busy == "pdf") "Preparing…" else "Open PDF")
                }
                OutlinedButton(onClick = { download("pdf", "$slug-report.pdf", "application/pdf", open = false) }, enabled = busy == null) {
                    Icon(Icons.Rounded.Share, null)
                    Spacer(Modifier.width(6.dp))
                    Text("Share")
                }
            }
        }
        SectionCard {
            CardTitle("Spreadsheet exports", "CSV files open in Excel or Google Sheets")
            Spacer(Modifier.height(8.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                (if (p.isLocal) localExports else exports).forEach { (key, label) ->
                    FilterChip(selected = busy == key, onClick = { if (busy == null) download(key, "$slug-$key.csv", "text/csv", open = false) }, label = { Text(label) })
                }
            }
        }
        Text(
            if (p.isLocal) "Reports are generated on this phone - no internet needed."
            else "Reports are generated on the server from your synced data (on this phone when you’re offline).",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** Exports the phone can build by itself. */
private val localExports = listOf("expenses" to "Expenses", "budget" to "Budget vs actual", "vendors" to "Vendor balances", "materials" to "Material stock", "labour" to "Wages")

@Composable
private fun CloudOnly(what: String) {
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        SectionCard {
            CardTitle("$what needs the cloud", "This project is saved only on this phone.")
            Text(
                "Open the project’s More tab and choose “Move to the cloud” (free account) to invite your contractor, engineer or family and keep a full history of every change.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 8.dp),
            )
        }
    }
}

@Composable
fun TeamSection(container: AppContainer, p: ProjectEntity, snackbar: SnackbarHostState) {
    if (p.isLocal) return CloudOnly("Team sharing")
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var data by remember { mutableStateOf<MembersResponse?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var email by remember { mutableStateOf("") }
    var role by remember { mutableStateOf("viewer") }
    var inviting by remember { mutableStateOf(false) }
    suspend fun load() {
        runCatching { container.repo.members(p.id) }.onSuccess { data = it; error = null }.onFailure { error = it.userMessage() }
    }
    LaunchedEffect(p.id) { load() }

    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (p.isManager) {
            item {
                SectionCard {
                    CardTitle("Invite someone", "Share the link on WhatsApp, SMS or email")
                    Spacer(Modifier.height(10.dp))
                    OutlinedTextField(email, { email = it }, label = { Text("Email") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), modifier = Modifier.fillMaxWidth())
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Vocab.projectRoles.forEach { (v, l) -> FilterChip(selected = role == v, onClick = { role = v }, label = { Text(l) }) }
                    }
                    Text(
                        when (role) {
                            "manager" -> "Full control: budget, team, edits and deletes."
                            "contributor" -> "Adds and edits entries - expenses, attendance, materials, diary."
                            else -> "Read-only. Ideal for family, clients or your bank."
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(vertical = 6.dp),
                    )
                    Button(
                        enabled = email.contains("@") && !inviting,
                        onClick = {
                            inviting = true
                            scope.launch {
                                runCatching { container.repo.invite(p.id, email, role) }
                                    .onSuccess { res ->
                                        val text = "Join \"${p.name}\" on BrickLedger to follow our house construction: ${res.inviteUrl}"
                                        context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text), "Share invite"))
                                        email = ""
                                        load()
                                    }
                                    .onFailure { snackbar.showSnackbar(it.userMessage()) }
                                inviting = false
                            }
                        },
                    ) { Text(if (inviting) "Inviting…" else "Invite & share link") }
                }
            }
        }
        when {
            error != null -> item { Text(error!!, color = MaterialTheme.colorScheme.error) }
            data == null -> item { LoadingBox(Modifier.height(120.dp)) }
            else -> {
                item { SectionLabel("Members (${data!!.members.size})") }
                items(data!!.members, key = { it.userId }) { m ->
                    SectionCard(padding = 12.dp) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Avatar(m.name)
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(m.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                                Text(m.email, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            StatusChip(if (m.viaWorkspace) "Admin" else Vocab.label(Vocab.projectRoles, m.role), if (m.role == "manager") Tone.Brand else Tone.Neutral)
                        }
                    }
                }
                if (data!!.invites.isNotEmpty()) {
                    item { SectionLabel("Pending invitations") }
                    items(data!!.invites, key = { it.id }) { i ->
                        SectionCard(padding = 12.dp) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(i.email, modifier = Modifier.weight(1f))
                                StatusChip(Vocab.label(Vocab.projectRoles, i.role))
                            }
                        }
                    }
                }
            }
        }
    }
}

private val timeFormat = DateTimeFormatter.ofPattern("h:mm a")

@Composable
fun ActivitySection(container: AppContainer, p: ProjectEntity) {
    if (p.isLocal) return CloudOnly("Activity history")
    var items by remember { mutableStateOf<List<ActivityDto>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(p.id) {
        runCatching { container.repo.activity(p.id) }.onSuccess { items = it }.onFailure { error = it.userMessage() }
    }
    val list = items
    when {
        error != null -> Text(error!!, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(16.dp))
        list == null -> LoadingBox()
        else -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            val groups = list.groupBy { Instant.parse(it.createdAt).atZone(ZoneId.systemDefault()).toLocalDate().toString() }
            groups.forEach { (day, entries) ->
                item(key = "d-$day") { SectionLabel(Dates.relativeDay(day)) }
                items(entries, key = { it.id }) { a ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.Top) {
                        Avatar(a.user?.name ?: "?", size = 28.dp)
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text("${a.user?.name ?: "Someone"} ${a.summary.replaceFirstChar { it.lowercase() }}", style = MaterialTheme.typography.bodyMedium)
                            Text(Instant.parse(a.createdAt).atZone(ZoneId.systemDefault()).format(timeFormat), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
            }
        }
    }
}

@Composable
fun SettingsScreen(container: AppContainer, onBack: () -> Unit, onSignIn: () -> Unit) {
    val context = LocalContext.current
    val profile by container.session.profile.collectAsStateWithLifecycle()
    val offline by container.session.offlineMode.collectAsStateWithLifecycle()
    val theme by container.session.theme.collectAsStateWithLifecycle()
    val syncState by container.repo.syncState.collectAsStateWithLifecycle()
    var confirm by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val web = BuildConfig.WEB_URL
    val pickBackup = rememberBackupPicker(container)

    ScreenScaffold(title = "Settings", onBack = onBack, snackbar = snackbar) { padding ->
        Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (profile == null) {
                SectionCard {
                    CardTitle(
                        "Offline mode${container.session.localName.takeIf { it.isNotBlank() }?.let { " · $it" } ?: ""}",
                        "Your projects are saved only on this phone - no account or internet needed.",
                    )
                    Text(
                        "Sign in or create a free account to sync across phones, share with your team and keep an online backup. Your offline projects stay on this phone and can be moved to the cloud one by one.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(vertical = 8.dp),
                    )
                    Button(onClick = onSignIn) { Text("Sign in or create account") }
                }
            }
            profile?.let { pr ->
                SectionCard {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Avatar(pr.user.name, 48.dp)
                        Spacer(Modifier.width(12.dp))
                        Column {
                            Text(pr.user.name, style = MaterialTheme.typography.titleMedium)
                            Text(pr.user.email, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    pr.orgs.firstOrNull { it.role == "owner" }?.let { org ->
                        Spacer(Modifier.height(10.dp))
                        Text(
                            "${org.name} · ${org.plan.replaceFirstChar { it.uppercase() }}${if (org.planStatus == "trialing") " trial" else ""} plan",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                }
            }
            SectionCard {
                CardTitle("Appearance")
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("system" to "System", "light" to "Light", "dark" to "Dark").forEach { (v, l) ->
                        FilterChip(selected = theme == v, onClick = { scope.launch { container.session.setTheme(v) } }, label = { Text(l) })
                    }
                }
            }
            if (profile != null) {
                SectionCard {
                    CardTitle(
                        "Sync",
                        when (val s = syncState) {
                            is SyncManager.State.Running -> "Syncing now…"
                            is SyncManager.State.Done -> "Last synced ${Instant.ofEpochMilli(s.at).atZone(ZoneId.systemDefault()).format(timeFormat)}"
                            is SyncManager.State.Failed -> s.message
                            else -> "Changes are saved on this phone and synced automatically."
                        },
                    )
                    Text("Server: ${container.session.baseUrl}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
                }
            }
            SectionCard {
                CardTitle("Backups", "Back up a project from its More tab. To restore on another phone, open the backup file there with BrickLedger - or pick it here.")
                Spacer(Modifier.height(8.dp))
                OutlinedButton(onClick = pickBackup) { Text("Restore from a backup file") }
            }
            if (profile != null) SectionCard {
                CardTitle("Plan & account", "Billing and account deletion are managed on the web.")
                Spacer(Modifier.height(8.dp))
                TextButton(onClick = { openUrl(context, "$web/app/settings?tab=billing") }) {
                    Icon(Icons.AutoMirrored.Rounded.OpenInNew, null)
                    Spacer(Modifier.width(8.dp))
                    Text("Manage plan & billing")
                }
                TextButton(onClick = { openUrl(context, "$web/app/settings") }) {
                    Icon(Icons.AutoMirrored.Rounded.OpenInNew, null)
                    Spacer(Modifier.width(8.dp))
                    Text("Profile, password & delete account")
                }
            }
            if (profile != null) {
                OutlinedButton(onClick = { confirm = true }, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.AutoMirrored.Rounded.Logout, null)
                    Spacer(Modifier.width(8.dp))
                    Text("Sign out")
                }
            }
            Text("BrickLedger ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.align(Alignment.CenterHorizontally))
        }
    }
    if (confirm) {
        ConfirmDialog(
            title = "Sign out?",
            message = if (offline) "Cloud projects are removed from this phone (changes not yet synced are lost). Projects saved only on this phone stay."
            else "Cloud projects are removed from this phone. Changes not yet synced will be lost.",
            confirmLabel = "Sign out",
            onConfirm = { container.appScope.launch { container.repo.signOut() } },
            onDismiss = { confirm = false },
        )
    }
}
