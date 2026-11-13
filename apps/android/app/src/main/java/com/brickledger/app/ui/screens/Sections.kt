package com.brickledger.app.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.EditNote
import androidx.compose.material.icons.rounded.Engineering
import androidx.compose.material.icons.rounded.Error
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.Payments
import androidx.compose.material.icons.rounded.Phone
import androidx.compose.material.icons.rounded.PictureAsPdf
import androidx.compose.material.icons.rounded.Savings
import androidx.compose.material.icons.rounded.Store
import androidx.compose.material.icons.rounded.TaskAlt
import androidx.compose.material.icons.rounded.Timeline
import androidx.compose.material.icons.rounded.Upload
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import coil3.compose.AsyncImage
import com.brickledger.app.AppContainer
import com.brickledger.app.core.Dates
import com.brickledger.app.core.Money
import com.brickledger.app.core.Vocab
import com.brickledger.app.core.fmtQty
import com.brickledger.app.core.todayIso
import com.brickledger.app.data.Attachment
import com.brickledger.app.data.mergeAttachments
import com.brickledger.app.data.local.ProjectEntity
import com.brickledger.app.data.local.ProjectFile
import com.brickledger.app.data.remote.userMessage
import com.brickledger.app.ui.components.CardTitle
import com.brickledger.app.ui.components.EmptyView
import com.brickledger.app.ui.components.IconBadge
import com.brickledger.app.ui.components.LoadingBox
import com.brickledger.app.ui.components.Meter
import com.brickledger.app.ui.components.ScreenScaffold
import com.brickledger.app.ui.components.SectionCard
import com.brickledger.app.ui.components.StatusChip
import com.brickledger.app.ui.components.Tone
import com.brickledger.app.ui.components.rememberFlowState
import com.brickledger.app.ui.navigation.ProjectNav
import com.brickledger.app.ui.theme.LocalChartColors
import java.io.File
import kotlinx.coroutines.launch

private val titles = mapOf(
    "budget" to "Budget", "vendors" to "Vendors & contractors", "funds" to "Funds", "schedule" to "Schedule", "tasks" to "Tasks",
    "diary" to "Site diary", "issues" to "Issues & snags", "documents" to "Documents & photos", "wages" to "Wages", "workers" to "Workers",
    "reports" to "Reports", "team" to "Team", "activity" to "Activity",
)

/** form kind created by each section's + button */
private val addKind = mapOf(
    "budget" to "category", "vendors" to "vendor", "funds" to "fund", "schedule" to "phase", "tasks" to "task",
    "diary" to "log", "issues" to "issue", "workers" to "worker",
)

@Composable
fun SectionScreen(container: AppContainer, nav: ProjectNav, section: String) {
    val project by rememberFlowState(nav.projectId, initial = null) { container.repo.project(nav.projectId) }
    val p = project
    val snackbar = remember { SnackbarHostState() }
    val canAdd = p != null && addKind[section] != null && (if (section == "budget") p.isManager else p.canEdit)
    ScreenScaffold(
        title = titles[section] ?: section,
        subtitle = p?.name,
        onBack = { nav.back() },
        snackbar = snackbar,
        floatingActionButton = {
            if (canAdd) FloatingActionButton(onClick = { nav.form(addKind.getValue(section)) }) { Icon(Icons.Rounded.Add, "Add") }
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            if (p == null) LoadingBox()
            else when (section) {
                "budget" -> BudgetSection(container, nav, p)
                "vendors" -> VendorsSection(container, nav, p)
                "funds" -> FundsSection(container, nav, p)
                "schedule" -> ScheduleSection(container, nav, p)
                "tasks" -> TasksSection(container, nav, p)
                "diary" -> DiarySection(container, nav, p)
                "issues" -> IssuesSection(container, nav, p)
                "documents" -> DocumentsSection(container, p, snackbar)
                "wages" -> WagesSection(container, nav, p)
                "workers" -> WorkersSection(container, nav, p)
                "reports" -> ReportsSection(container, p, snackbar)
                "team" -> TeamSection(container, p, snackbar)
                "activity" -> ActivitySection(container, p)
            }
        }
    }
}

private val listPadding = PaddingValues(16.dp, 4.dp, 16.dp, 96.dp)

@Composable
private fun BudgetSection(container: AppContainer, nav: ProjectNav, p: ProjectEntity) {
    val lines by rememberFlowState(p.id, initial = null) { container.repo.categoryLines(p.id) }
    val list = lines ?: return LoadingBox()
    val planned = list.sumOf { it.planned }
    val committed = list.sumOf { it.committed }
    LazyColumn(contentPadding = listPadding, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            SectionCard {
                CardTitle("Total budget", Money.format(p.totalBudget, p.currency))
                Spacer(Modifier.height(10.dp))
                Meter(committed, p.totalBudget)
                Spacer(Modifier.height(6.dp))
                Text(
                    "${Money.compact(committed, p.currency)} committed · ${Money.compact(p.totalBudget - planned, p.currency)} unallocated",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        items(list, key = { it.category?.id ?: "none" }) { l ->
            SectionCard(onClick = if (p.isManager && l.category != null) ({ nav.form("category", l.category.id) }) else null, padding = 14.dp) {
                Row {
                    Text(l.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
                    Text(if (l.planned > 0) "${(l.committed / l.planned * 100).toInt()}%" else "—", style = MaterialTheme.typography.labelLarge)
                }
                Spacer(Modifier.height(8.dp))
                Meter(l.committed, l.planned)
                Spacer(Modifier.height(6.dp))
                Row {
                    Text("Paid ${Money.compact(l.paid, p.currency)}${if (l.due > 0) " · due ${Money.compact(l.due, p.currency)}" else ""}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                    Text("Plan ${Money.compact(l.planned, p.currency)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

@Composable
private fun VendorsSection(container: AppContainer, nav: ProjectNav, p: ProjectEntity) {
    val lines by rememberFlowState(p.id, initial = null) { container.repo.vendorLines(p.id) }
    val context = LocalContext.current
    val list = lines ?: return LoadingBox()
    LazyColumn(contentPadding = listPadding, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (list.isEmpty()) item { EmptyView(Icons.Rounded.Store, "No vendors yet", "Add suppliers and contractors to track what you owe each of them.") }
        items(list, key = { it.vendor.id }) { v ->
            SectionCard(onClick = { nav.form("vendor", v.vendor.id) }, padding = 14.dp) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(v.vendor.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                        Text(Vocab.label(Vocab.vendorTypes, v.vendor.type), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    v.vendor.phone?.let { phone ->
                        IconButton(onClick = { context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$phone"))) }) { Icon(Icons.Rounded.Phone, "Call ${v.vendor.name}") }
                    }
                }
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Amount("Paid", Money.compact(v.paid, p.currency))
                    if (v.due > 0) Amount("Due", Money.compact(v.due, p.currency), LocalChartColors.current.critical)
                    v.balance?.let { Amount("Balance", Money.compact(it, p.currency)) }
                }
                if (p.canEdit) {
                    TextButton(onClick = { nav.form("expense", prefill = "vendorId=${v.vendor.id};title=${Uri.encode("Payment to ${v.vendor.name}")};paymentMode=bank_transfer") }) {
                        Icon(Icons.Rounded.Payments, null)
                        Spacer(Modifier.width(6.dp))
                        Text("Record payment")
                    }
                }
            }
        }
    }
}

@Composable
private fun Amount(label: String, value: String, color: androidx.compose.ui.graphics.Color = androidx.compose.ui.graphics.Color.Unspecified) {
    Column {
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.titleSmall, color = if (color == androidx.compose.ui.graphics.Color.Unspecified) MaterialTheme.colorScheme.onSurface else color)
    }
}

@Composable
private fun FundsSection(container: AppContainer, nav: ProjectNav, p: ProjectEntity) {
    val funds by rememberFlowState(p.id, initial = null) { container.db.funds().observe(p.id) }
    val list = funds ?: return LoadingBox()
    LazyColumn(contentPadding = listPadding, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            SectionCard { CardTitle("Funds received", Money.format(list.sumOf { it.amount }, p.currency)) }
        }
        if (list.isEmpty()) item { EmptyView(Icons.Rounded.Savings, "No funds recorded", "Add savings, loan disbursements or family contributions to see your cash position.") }
        items(list, key = { it.id }) { f ->
            SectionCard(onClick = { nav.form("fund", f.id) }, padding = 14.dp) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(f.description ?: Vocab.label(Vocab.fundSources, f.source), style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                        Text("${Dates.format(f.date)} · ${Vocab.label(Vocab.fundSources, f.source)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Text(Money.format(f.amount, p.currency), style = MaterialTheme.typography.titleSmall)
                }
            }
        }
    }
}

@Composable
private fun ScheduleSection(container: AppContainer, nav: ProjectNav, p: ProjectEntity) {
    val phases by rememberFlowState(p.id, initial = null) { container.db.phases().observe(p.id) }
    val list = phases ?: return LoadingBox()
    val today = todayIso()
    LazyColumn(contentPadding = listPadding, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (list.isEmpty()) item { EmptyView(Icons.Rounded.Timeline, "No phases yet", "Break the build into phases to plan dates and track progress.") }
        items(list, key = { it.id }) { ph ->
            val late = ph.status != "completed" && ph.plannedEnd != null && ph.plannedEnd < today
            SectionCard(onClick = if (p.canEdit) ({ nav.form("phase", ph.id) }) else null, padding = 14.dp) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(ph.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
                    StatusChip(
                        if (late) "Late" else Vocab.label(Vocab.phaseStatus, ph.status),
                        when {
                            late -> Tone.Red
                            ph.status == "completed" -> Tone.Green
                            ph.status == "in_progress" -> Tone.Blue
                            ph.status == "on_hold" -> Tone.Amber
                            else -> Tone.Neutral
                        },
                    )
                }
                Spacer(Modifier.height(8.dp))
                Meter(ph.progress.toDouble(), 100.0, progress = true, height = 6.dp)
                Spacer(Modifier.height(6.dp))
                Text(
                    listOfNotNull(
                        "${ph.progress}%",
                        if (ph.plannedStart != null && ph.plannedEnd != null) "${Dates.short(ph.plannedStart)} – ${Dates.format(ph.plannedEnd)}" else null,
                    ).joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun TasksSection(container: AppContainer, nav: ProjectNav, p: ProjectEntity) {
    val tasks by rememberFlowState(p.id, initial = null) { container.db.tasks().observe(p.id) }
    val scope = rememberCoroutineScope()
    val list = tasks ?: return LoadingBox()
    val today = todayIso()
    val c = LocalChartColors.current
    LazyColumn(contentPadding = listPadding, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (list.isEmpty()) item { EmptyView(Icons.Rounded.TaskAlt, "No tasks", "Keep track of what needs doing on site.") }
        Vocab.taskStatus.forEach { (status, label) ->
            val group = list.filter { it.status == status }
            if (group.isNotEmpty()) {
                item(key = "h-$status") { Text("$label · ${group.size}", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp)) }
                items(group, key = { it.id }) { t ->
                    val overdue = t.status != "done" && t.dueDate != null && t.dueDate < today
                    SectionCard(onClick = { nav.form("task", t.id) }, padding = 8.dp) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(
                                checked = t.status == "done",
                                enabled = p.canEdit,
                                onCheckedChange = { done ->
                                    scope.launch { container.repo.save(t.copy(status = if (done) "done" else "todo", completedAt = if (done) com.brickledger.app.core.nowIso() else null)) }
                                },
                            )
                            Column(Modifier.weight(1f)) {
                                Text(t.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                Text(
                                    listOfNotNull(
                                        Vocab.label(Vocab.priorities, t.priority),
                                        t.assignee,
                                        t.dueDate?.let { (if (overdue) "Overdue · " else "Due ") + Dates.short(it) },
                                    ).joinToString(" · "),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = if (overdue) c.critical else MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DiarySection(container: AppContainer, nav: ProjectNav, p: ProjectEntity) {
    val logs by rememberFlowState(p.id, initial = null) { container.db.logs().observe(p.id) }
    val files by rememberFlowState(p.id, initial = emptyList()) { container.db.files().observe(p.id) }
    val list = logs ?: return LoadingBox()
    val photos = remember(files) { files.filter { it.entityType == "log" && it.isImage }.groupBy { it.entityId } }
    LazyColumn(contentPadding = listPadding, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (list.isEmpty()) item { EmptyView(Icons.Rounded.EditNote, "No diary entries", "Write a few lines at the end of each day - with photos.") }
        items(list, key = { it.id }) { log ->
            SectionCard(onClick = { nav.form("log", log.id) }) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(Dates.relativeDay(log.date), style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                    log.weather?.let { StatusChip(Vocab.label(Vocab.weather, it)) }
                    log.labourCount?.let { Spacer(Modifier.width(6.dp)); StatusChip("$it on site", Tone.Blue) }
                }
                Spacer(Modifier.height(6.dp))
                Text(log.workDone, style = MaterialTheme.typography.bodyMedium, maxLines = 4, overflow = TextOverflow.Ellipsis)
                log.issues?.let {
                    Spacer(Modifier.height(6.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Rounded.Warning, "Problem", tint = LocalChartColors.current.warning, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(it, style = MaterialTheme.typography.bodySmall)
                    }
                }
                photos[log.id]?.takeIf { it.isNotEmpty() }?.let { pics ->
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        pics.take(4).forEach { f ->
                            AsyncImage(
                                model = container.repo.fileUrl(f),
                                contentDescription = f.name,
                                contentScale = ContentScale.Crop,
                                modifier = Modifier.size(64.dp).clip(RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.surfaceVariant),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun IssuesSection(container: AppContainer, nav: ProjectNav, p: ProjectEntity) {
    val issues by rememberFlowState(p.id, initial = null) { container.db.issues().observe(p.id) }
    val list = issues ?: return LoadingBox()
    val c = LocalChartColors.current
    LazyColumn(contentPadding = listPadding, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (list.isEmpty()) item { EmptyView(Icons.Rounded.Error, "No issues", "Report cracks, leaks or wrong deliveries with photos.") }
        items(list, key = { it.id }) { i ->
            val (icon, color) = when (i.severity) {
                "critical" -> Icons.Rounded.Error to c.critical
                "high" -> Icons.Rounded.Warning to c.serious
                "medium" -> Icons.Rounded.Warning to c.warning
                else -> Icons.Rounded.Warning to c.muted
            }
            SectionCard(onClick = { nav.form("issue", i.id) }, padding = 14.dp) {
                Row(verticalAlignment = Alignment.Top) {
                    Icon(icon, contentDescription = Vocab.label(Vocab.severities, i.severity), tint = color, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(i.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                        Text(
                            listOfNotNull(Vocab.label(Vocab.severities, i.severity), i.assignee, i.dueDate?.let { "Fix by ${Dates.short(it)}" }).joinToString(" · "),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    StatusChip(Vocab.label(Vocab.issueStatus, i.status), if (i.status == "resolved") Tone.Green else if (i.status == "in_progress") Tone.Blue else Tone.Neutral)
                }
            }
        }
    }
}

@Composable
private fun DocumentsSection(container: AppContainer, p: ProjectEntity, snackbar: SnackbarHostState) {
    val files by rememberFlowState(p.id, initial = null) { container.db.files().observe(p.id) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val upload = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch {
            container.repo.addAttachment(p.id, "document", null, uri, if (context.contentResolver.getType(uri)?.startsWith("image/") == true) "photo" else "other")
            snackbar.showSnackbar(if (p.isLocal) "Added" else "Added - uploads when online")
        }
    }
    val onPhone by rememberFlowState(p.id, initial = emptyList()) { container.db.uploads().observeForProject(p.id) }
    var viewing by rememberSaveable { mutableStateOf<String?>(null) }
    val list = files ?: return LoadingBox()
    // Files kept on the phone (phone-only projects, uploads waiting for a connection) come first.
    val items = remember(list, onPhone) { mergeAttachments(list, onPhone, queuedFirst = true) }
    Column {
        if (p.canEdit) {
            OutlinedButton(onClick = { upload.launch(arrayOf("image/*", "application/pdf", "*/*")) }, modifier = Modifier.padding(16.dp, 4.dp)) {
                Icon(Icons.Rounded.Upload, null)
                Spacer(Modifier.width(8.dp))
                Text(if (p.isLocal) "Add a document or photo" else "Upload a document or photo")
            }
        }
        if (items.isEmpty()) {
            EmptyView(Icons.Rounded.Folder, "Nothing here yet", "Plans, permits, bills and site photos appear here.")
        } else {
            LazyVerticalGrid(columns = GridCells.Adaptive(150.dp), contentPadding = PaddingValues(16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(items, key = { it.key }) { a -> DocumentCard(container, a, p.isLocal) { viewing = a.key } }
            }
        }
    }
    viewing?.let { key -> FileViewer(container, p, items, startKey = key, noun = "file", onDismiss = { viewing = null }) }
}

@Composable
private fun DocumentCard(container: AppContainer, a: Attachment, phoneOnly: Boolean, onClick: () -> Unit) {
    SectionCard(padding = 0.dp, onClick = onClick) {
        if (a.isImage) {
            AsyncImage(
                model = attachmentModel(container, a),
                contentDescription = a.name,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxWidth().aspectRatio(4f / 3f).background(MaterialTheme.colorScheme.surfaceVariant),
            )
        } else {
            Box(Modifier.fillMaxWidth().aspectRatio(4f / 3f).background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
                Icon(if (a.mimeType == "application/pdf") Icons.Rounded.PictureAsPdf else Icons.Rounded.Description, null, modifier = Modifier.size(36.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Column(Modifier.padding(10.dp)) {
            Text(a.name, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            when {
                a.waiting -> StatusChip(if (phoneOnly) "On this phone" else "Waiting to upload", Tone.Amber, Modifier.padding(top = 4.dp))
                else -> Text(Vocab.label(Vocab.fileCategories, a.category), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            a.file?.expiresOn?.let { StatusChip("Expires ${Dates.short(it)}", if (it < todayIso()) Tone.Red else Tone.Amber, Modifier.padding(top = 4.dp)) }
        }
    }
}

fun openFile(context: android.content.Context, file: File, mime: String) {
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
    val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    // No chooser: the phone's default viewer opens directly, and a phone without one gets a hint instead of an empty sheet.
    startOrExplain(context, intent, "No app on this phone can open this file - use Share to send it to one.")
}

fun openUrl(context: android.content.Context, url: String) =
    startOrExplain(context, Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url)), "No browser found - open $url on any device.")

private fun startOrExplain(context: android.content.Context, intent: Intent, hint: String) {
    try {
        context.startActivity(intent)
    } catch (_: android.content.ActivityNotFoundException) {
        android.widget.Toast.makeText(context, hint, android.widget.Toast.LENGTH_LONG).show()
    }
}

@Composable
private fun WagesSection(container: AppContainer, nav: ProjectNav, p: ProjectEntity) {
    val lines by rememberFlowState(p.id, initial = null) { container.repo.labourLines(p.id) }
    val list = lines ?: return LoadingBox()
    LazyColumn(contentPadding = listPadding, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            SectionCard {
                CardTitle("Wages", "Earned ${Money.compact(list.sumOf { it.earned }, p.currency)} · paid ${Money.compact(list.sumOf { it.paid }, p.currency)}")
                Text(
                    "Earned = present days × wage + half days × ½ + overtime at 1/8 of a day per hour. Payments are expenses linked to the worker.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
        }
        if (list.isEmpty()) item { EmptyView(Icons.Rounded.Engineering, "No workers yet", "Add workers and mark attendance to calculate wages.") }
        items(list, key = { it.worker.id }) { l ->
            SectionCard(padding = 14.dp) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(l.worker.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                        Text("${Vocab.label(Vocab.trades, l.worker.trade)} · ${l.days.fmtQty()} days${if (l.overtime > 0) " · ${l.overtime.fmtQty()}h OT" else ""}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Text(if (l.balance < 0) "${Money.format(-l.balance, p.currency)} advance" else Money.format(l.balance, p.currency), style = MaterialTheme.typography.titleSmall)
                        Text("of ${Money.compact(l.earned, p.currency)} earned", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (p.canEdit) {
                    HorizontalDivider(Modifier.padding(vertical = 8.dp), color = MaterialTheme.colorScheme.outlineVariant)
                    TextButton(onClick = {
                        val amount = if (l.balance > 0) String.format(java.util.Locale.US, "%.2f", l.balance) else ""
                        nav.form("expense", prefill = "workerId=${l.worker.id};title=${Uri.encode("Wages - ${l.worker.name}")};amount=$amount;paymentMode=cash")
                    }) {
                        Icon(Icons.Rounded.Payments, null)
                        Spacer(Modifier.width(6.dp))
                        Text("Pay wages")
                    }
                }
            }
        }
    }
}

@Composable
private fun WorkersSection(container: AppContainer, nav: ProjectNav, p: ProjectEntity) {
    val workers by rememberFlowState(p.id, initial = null) { container.db.workers().observe(p.id) }
    val list = workers ?: return LoadingBox()
    LazyColumn(contentPadding = listPadding, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (list.isEmpty()) item { EmptyView(Icons.Rounded.Engineering, "No workers yet", "Tap + to add the people working on site.") }
        items(list, key = { it.id }) { w ->
            SectionCard(onClick = if (p.canEdit) ({ nav.form("worker", w.id) }) else null, padding = 14.dp) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(w.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                        Text("${Vocab.label(Vocab.trades, w.trade)} · ${Money.format(w.dailyWage, p.currency)}/day", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    StatusChip(if (w.active) "Active" else "Inactive", if (w.active) Tone.Green else Tone.Neutral)
                }
            }
        }
    }
}

@Composable
fun MaterialScreen(container: AppContainer, nav: ProjectNav, materialId: String) {
    val project by rememberFlowState(nav.projectId, initial = null) { container.repo.project(nav.projectId) }
    val material by rememberFlowState(materialId, initial = null) { container.db.materials().observeOne(materialId) }
    val moves by rememberFlowState(materialId, initial = emptyList()) { container.db.movements().observeForMaterial(materialId) }
    val p = project
    val m = material
    ScreenScaffold(
        title = m?.name ?: "Material",
        subtitle = p?.name,
        onBack = { nav.back() },
        actions = { if (p?.canEdit == true && m != null) IconButton(onClick = { nav.form("material", m.id) }) { Icon(Icons.Rounded.Edit, "Edit material") } },
    ) { padding ->
        if (p == null || m == null) return@ScreenScaffold LoadingBox(Modifier.padding(padding))
        val received = moves.filter { it.type == "in" }.sumOf { it.quantity }
        val used = moves.filter { it.type == "out" }.sumOf { it.quantity }
        LazyColumn(Modifier.padding(padding), contentPadding = listPadding, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item {
                SectionCard {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconBadge(Icons.Rounded.CalendarMonth)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text("${(received - used).fmtQty()} ${m.unit}", style = MaterialTheme.typography.headlineSmall)
                            Text("in stock · ${received.fmtQty()} received · ${used.fmtQty()} used", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    if (p.canEdit) {
                        Spacer(Modifier.height(10.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = { nav.form("movement", parent = m.id, prefill = "type=in") }) { Text("Receive") }
                            OutlinedButton(onClick = { nav.form("movement", parent = m.id, prefill = "type=out") }) { Text("Use") }
                        }
                    }
                }
            }
            item { Text("History", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp)) }
            if (moves.isEmpty()) item { Text("No deliveries or usage yet.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            items(moves, key = { it.id }) { mv ->
                SectionCard(padding = 12.dp) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        StatusChip(if (mv.type == "in") "Received" else "Used", if (mv.type == "in") Tone.Green else Tone.Neutral)
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text("${mv.quantity.fmtQty()} ${m.unit}", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                            Text(listOfNotNull(Dates.format(mv.date), mv.notes).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        mv.rate?.let { Text("@ ${Money.format(it, p.currency)}", style = MaterialTheme.typography.bodySmall) }
                    }
                }
            }
        }
    }
}
