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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ReceiptLong
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.ChevronLeft
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.Dashboard
import androidx.compose.material.icons.rounded.Engineering
import androidx.compose.material.icons.rounded.Inventory2
import androidx.compose.material.icons.rounded.MoreHoriz
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import android.widget.Toast
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import com.brickledger.app.data.remote.userMessage
import com.brickledger.app.ui.components.ConfirmDialog
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.brickledger.app.AppContainer
import com.brickledger.app.core.Dates
import com.brickledger.app.core.Money
import com.brickledger.app.core.Vocab
import com.brickledger.app.core.fmtQty
import com.brickledger.app.core.isoPlusDays
import com.brickledger.app.core.todayIso
import com.brickledger.app.core.wageFor
import com.brickledger.app.data.local.Expense
import com.brickledger.app.data.local.ProjectEntity
import com.brickledger.app.ui.components.Avatar
import com.brickledger.app.ui.components.EmptyView
import com.brickledger.app.ui.components.LoadingBox
import com.brickledger.app.ui.components.Meter
import com.brickledger.app.ui.components.ScreenScaffold
import com.brickledger.app.ui.components.SectionCard
import com.brickledger.app.ui.components.StatusChip
import com.brickledger.app.ui.components.SyncBadge
import com.brickledger.app.ui.components.Tone
import com.brickledger.app.ui.components.rememberFlowState
import com.brickledger.app.ui.navigation.ProjectNav
import com.brickledger.app.ui.theme.LocalChartColors
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private data class Tab(val label: String, val icon: ImageVector)

private val tabs = listOf(
    Tab("Overview", Icons.Rounded.Dashboard),
    Tab("Expenses", Icons.AutoMirrored.Rounded.ReceiptLong),
    Tab("Labour", Icons.Rounded.Engineering),
    Tab("Materials", Icons.Rounded.Inventory2),
    Tab("More", Icons.Rounded.MoreHoriz),
)

@Composable
fun ProjectHomeScreen(container: AppContainer, nav: ProjectNav) {
    val pid = nav.projectId
    val repo = container.repo
    val project by rememberFlowState(pid, initial = null) { repo.project(pid) }
    val syncState by repo.syncState.collectAsStateWithLifecycle()
    val pending by rememberFlowState(pid, initial = 0) { repo.pendingCount(pid) }
    var tab by rememberSaveable { mutableIntStateOf(0) }

    LaunchedEffect(pid) {
        container.session.setLastProject(pid)
        repo.syncNow(pid)
    }

    val p = project
    // Leave if the project is gone (moved to the cloud, deleted, or access removed). `null` also
    // means "still loading", so ask the database before deciding.
    LaunchedEffect(p == null) {
        if (p == null && container.db.projects().get(pid) == null) nav.leave()
    }
    ScreenScaffold(
        title = p?.name ?: "",
        subtitle = p?.let { listOfNotNull(it.city, Vocab.label(Vocab.projectRoles, it.role)).joinToString(" · ") },
        onBack = { nav.back() },
        actions = {
            if (p?.isLocal == true) StatusChip("On this phone", Tone.Amber) else SyncBadge(syncState, pending) { repo.syncNow(pid) }
            Spacer(Modifier.width(8.dp))
        },
        bottomBar = {
            NavigationBar(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest) {
                tabs.forEachIndexed { i, t ->
                    NavigationBarItem(selected = tab == i, onClick = { tab = i }, icon = { Icon(t.icon, null) }, label = { Text(t.label) })
                }
            }
        },
        floatingActionButton = {
            if (p?.canEdit == true) {
                when (tab) {
                    0, 1 -> FloatingActionButton(onClick = { nav.form("expense") }) { Icon(Icons.Rounded.Add, "Add expense") }
                    2 -> FloatingActionButton(onClick = { nav.form("worker") }) { Icon(Icons.Rounded.Add, "Add worker") }
                    3 -> FloatingActionButton(onClick = { nav.form("material") }) { Icon(Icons.Rounded.Add, "Add material") }
                }
            }
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            if (p == null) LoadingBox()
            else when (tab) {
                0 -> DashboardTab(container, nav, p)
                1 -> ExpensesTab(container, nav, p)
                2 -> LabourTab(container, nav, p)
                3 -> MaterialsTab(container, nav, p)
                else -> MoreTab(container, nav, p)
            }
        }
    }
}

// ------------------------------------------------------------------ expenses

@Composable
private fun ExpensesTab(container: AppContainer, nav: ProjectNav, project: ProjectEntity) {
    val expenses by rememberFlowState(project.id, initial = null) { container.db.expenses().observe(project.id) }
    val categories by rememberFlowState(project.id, initial = emptyList()) { container.db.categories().observe(project.id) }
    val vendors by rememberFlowState(project.id, initial = emptyList()) { container.db.vendors().observe(project.id) }
    var query by rememberSaveable { mutableStateOf("") }
    var status by rememberSaveable { mutableStateOf("all") }
    val catNames = remember(categories) { categories.associate { it.id to it.name } }
    val vendorNames = remember(vendors) { vendors.associate { it.id to it.name } }
    val list = expenses ?: return LoadingBox()
    val filtered = remember(list, query, status) {
        list.filter { e ->
            (status == "all" || e.status == status) &&
                (query.isBlank() || e.title.contains(query, true) || (e.reference ?: "").contains(query, true) || (vendorNames[e.vendorId] ?: "").contains(query, true))
        }
    }
    LazyColumn(contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 96.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            OutlinedTextField(
                query, { query = it },
                placeholder = { Text("Search expenses") },
                leadingIcon = { Icon(Icons.Rounded.Search, null) },
                singleLine = true,
                shape = RoundedCornerShape(16.dp),
                modifier = Modifier.fillMaxWidth(),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                listOf("all" to "All", "paid" to "Paid", "due" to "Bills due").forEach { (v, l) ->
                    FilterChip(selected = status == v, onClick = { status = v }, label = { Text(l) })
                }
            }
            Text(
                "${filtered.size} expenses · ${Money.format(filtered.sumOf { it.amount }, project.currency)}",
                style = MaterialTheme.typography.labelLarge,
                modifier = Modifier.padding(top = 8.dp),
            )
        }
        if (filtered.isEmpty()) {
            item { EmptyView(Icons.AutoMirrored.Rounded.ReceiptLong, "No expenses", if (list.isEmpty()) "Tap + to record your first bill or payment." else "Nothing matches this filter.") }
        }
        val groups = filtered.groupBy { it.date }
        groups.forEach { (date, dayItems) ->
            item(key = "h-$date") {
                Row(Modifier.fillMaxWidth().padding(top = 10.dp, bottom = 2.dp)) {
                    Text(Dates.relativeDay(date), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                    Text(Money.format(dayItems.sumOf { it.amount }, project.currency), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            items(dayItems, key = { it.id }) { e -> ExpenseRow(e, project.currency, vendorNames[e.vendorId] ?: catNames[e.categoryId]) { nav.form("expense", e.id) } }
        }
    }
}

@Composable
fun ExpenseRow(e: Expense, currency: String, subtitle: String?, onClick: () -> Unit) {
    val c = LocalChartColors.current
    val overdue = e.status == "due" && e.dueDate != null && e.dueDate < todayIso()
    SectionCard(onClick = onClick, padding = 14.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(e.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (e.dirty) {
                        Box(Modifier.size(6.dp).clip(CircleShape).background(c.warning))
                        Spacer(Modifier.width(6.dp))
                    }
                    Text(
                        listOfNotNull(subtitle, Vocab.label(Vocab.paymentModes, e.paymentMode)).joinToString(" · "),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            Spacer(Modifier.width(8.dp))
            Column(horizontalAlignment = Alignment.End) {
                Text(Money.format(e.amount, currency), style = MaterialTheme.typography.titleSmall)
                if (e.status == "due") StatusChip(if (overdue) "Overdue" else "Due ${Dates.short(e.dueDate)}".trim(), if (overdue) Tone.Red else Tone.Amber)
            }
        }
    }
}

// ------------------------------------------------------------------ labour / attendance

@Composable
private fun LabourTab(container: AppContainer, nav: ProjectNav, project: ProjectEntity) {
    var date by rememberSaveable { mutableStateOf(todayIso()) }
    val workers by rememberFlowState(project.id, initial = null) { container.db.workers().observe(project.id) }
    val records by rememberFlowState(project.id, date, initial = emptyList()) { container.db.attendance().observeDay(project.id, date) }
    val scope = rememberCoroutineScope()
    val active = workers?.filter { it.active } ?: return LoadingBox()
    val byWorker = records.associateBy { it.workerId }
    val wages = active.sumOf { w -> byWorker[w.id]?.let { wageFor(it.status, it.overtimeHours, w.dailyWage) } ?: 0.0 }

    LazyColumn(contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 96.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            SectionCard(padding = 12.dp) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { date = isoPlusDays(date, -1) }) { Icon(Icons.Rounded.ChevronLeft, "Previous day") }
                    Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(if (date == todayIso()) "Today" else Dates.weekday(date), style = MaterialTheme.typography.titleMedium)
                        Text(Dates.format(date), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    IconButton(onClick = { date = isoPlusDays(date, 1) }, enabled = date < todayIso()) { Icon(Icons.Rounded.ChevronRight, "Next day") }
                }
                Spacer(Modifier.height(6.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(
                        "${records.count { it.status == "present" }} present · ${records.count { it.status == "half" }} half · ${records.count { it.status == "absent" }} absent",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Text(Money.format(wages, project.currency), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                }
                if (project.canEdit && active.isNotEmpty()) {
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = {
                            scope.launch { active.filter { byWorker[it.id] == null }.forEach { container.repo.markAttendance(project.id, it, date, "present", 0.0) } }
                        }) { Text("Mark rest present") }
                        TextButton(onClick = { nav.section("wages") }) { Text("Wages") }
                        TextButton(onClick = { nav.section("workers") }) { Text("Workers") }
                    }
                }
            }
        }
        if (active.isEmpty()) {
            item { EmptyView(Icons.Rounded.Engineering, "No workers yet", "Add the people on site to mark daily attendance and track wages.") }
        }
        items(active, key = { it.id }) { w ->
            val rec = byWorker[w.id]
            SectionCard(padding = 12.dp) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Avatar(w.name)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(w.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                        Text("${Vocab.label(Vocab.trades, w.trade)} · ${Money.format(w.dailyWage, project.currency)}/day", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (rec != null && rec.status != "absent") {
                        TextButton(onClick = {
                            if (project.canEdit) {
                                val next = if (rec.overtimeHours >= 4) 0.0 else rec.overtimeHours + 1
                                scope.launch { container.repo.markAttendance(project.id, w, date, rec.status, next) }
                            }
                        }) { Text(if (rec.overtimeHours > 0) "+${rec.overtimeHours.fmtQty()}h OT" else "+OT") }
                    }
                }
                Spacer(Modifier.height(8.dp))
                val options = listOf("present" to "Present", "half" to "Half", "absent" to "Absent")
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    options.forEachIndexed { i, (value, label) ->
                        SegmentedButton(
                            selected = rec?.status == value,
                            onClick = { if (project.canEdit) scope.launch { container.repo.markAttendance(project.id, w, date, value, if (value == "absent") 0.0 else rec?.overtimeHours ?: 0.0) } },
                            shape = SegmentedButtonDefaults.itemShape(i, options.size),
                        ) { Text(label) }
                    }
                }
            }
        }
    }
}

// ------------------------------------------------------------------ materials

@Composable
private fun MaterialsTab(container: AppContainer, nav: ProjectNav, project: ProjectEntity) {
    val lines by rememberFlowState(project.id, initial = null) { container.repo.stockLines(project.id) }
    val list = lines ?: return LoadingBox()
    LazyColumn(contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 96.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (list.isEmpty()) item { EmptyView(Icons.Rounded.Inventory2, "No materials", "Track cement, steel, sand and other bulk materials.") }
        items(list, key = { it.material.id }) { s ->
            SectionCard(onClick = { nav.material(s.material.id) }) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(s.material.name, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(Vocab.label(Vocab.materialCategories, s.material.category), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (s.low) StatusChip("Low stock", Tone.Amber)
                }
                Spacer(Modifier.height(10.dp))
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(s.stock.fmtQty(), style = MaterialTheme.typography.headlineSmall)
                    Spacer(Modifier.width(6.dp))
                    Text("${s.material.unit} in stock", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 3.dp))
                    Spacer(Modifier.weight(1f))
                    Text(Money.compact(s.value, project.currency), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                s.material.estimatedQty?.takeIf { it > 0 }?.let { est ->
                    Spacer(Modifier.height(8.dp))
                    Meter(s.received, est, progress = true, height = 6.dp)
                    Text("${s.received.fmtQty()} of ${est.fmtQty()} ${s.material.unit} procured", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
                }
                if (project.canEdit) {
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { nav.form("movement", parent = s.material.id, prefill = "type=in") }) { Text("Receive") }
                        OutlinedButton(onClick = { nav.form("movement", parent = s.material.id, prefill = "type=out") }) { Text("Use") }
                    }
                }
            }
        }
    }
}

// ------------------------------------------------------------------ more

@Composable
private fun MoreTab(container: AppContainer, nav: ProjectNav, project: ProjectEntity) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var confirmMove by remember { mutableStateOf(false) }
    var working by remember { mutableStateOf<String?>(null) }
    val entries = buildList {
        add(Triple("budget", "Budget", "Planned vs committed per category"))
        add(Triple("vendors", "Vendors & contractors", "Balances and payments"))
        add(Triple("funds", "Funds", "Savings, loan disbursements, family support"))
        add(Triple("schedule", "Schedule", "Phases and progress"))
        add(Triple("tasks", "Tasks", "What needs doing on site"))
        add(Triple("diary", "Site diary", "Daily work, weather and photos"))
        add(Triple("issues", "Issues & snags", "Defects to fix before handover"))
        add(Triple("documents", "Documents & photos", "Plans, permits, bills, warranties"))
        add(Triple("wages", "Wages", "Earned, paid and balance per worker"))
        add(Triple("reports", "Reports", "PDF report and spreadsheet exports"))
        add(Triple("team", "Team", "Invite your contractor, engineer or family"))
        add(Triple("activity", "Activity", "Every change, by whom and when"))
    }
    LazyColumn(contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (project.isLocal) {
            item {
                SectionCard(
                    onClick = { if (working == null) { if (container.session.isLoggedIn) confirmMove = true else nav.signIn() } },
                    padding = 14.dp,
                ) {
                    Text(
                        when {
                            working == "move" -> "Moving to the cloud…"
                            container.session.isLoggedIn -> "Move to the cloud"
                            else -> "Sign in to move this project to the cloud"
                        },
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    Text(
                        "This project lives only on this phone. In the cloud it syncs across phones, can be shared with your team and is backed up online.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        item {
            SectionCard(
                onClick = {
                    if (working == null) {
                        working = "backup"
                        scope.launch {
                            runCatching { container.repo.exportBackup(project.id) }
                                .onSuccess { shareFile(context, it, "application/zip") }
                                .onFailure { Toast.makeText(context, it.userMessage(), Toast.LENGTH_LONG).show() }
                            working = null
                        }
                    }
                },
                padding = 14.dp,
            ) {
                Text(if (working == "backup") "Preparing backup…" else "Back up to a file", style = MaterialTheme.typography.titleSmall)
                Text("Save a copy (with photos) to Google Drive, WhatsApp or email. On another phone, open the file with BrickLedger to restore it.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        items(entries, key = { it.first }) { (key, title, subtitle) ->
            SectionCard(onClick = { nav.section(key) }, padding = 14.dp) {
                Text(title, style = MaterialTheme.typography.titleSmall)
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (project.isManager) {
            item {
                SectionCard(onClick = { nav.form("project", project.id) }, padding = 14.dp) {
                    Text("Project settings", style = MaterialTheme.typography.titleSmall)
                    Text("Name, budget, currency, dates", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        item {
            Text(
                "App settings",
                color = MaterialTheme.colorScheme.primary,
                style = MaterialTheme.typography.labelLarge,
                modifier = Modifier.clickable { nav.settings() }.padding(8.dp),
            )
        }
    }
    if (confirmMove) {
        ConfirmDialog(
            title = "Move to the cloud?",
            message = "“${project.name}” will be uploaded to your account with all its entries and photos, and synced from then on. It needs an internet connection.",
            confirmLabel = "Move",
            onConfirm = {
                working = "move"
                // App scope: the move deletes the local copy, which closes this screen mid-operation.
                container.appScope.launch {
                    val result = runCatching { container.repo.moveToCloud(project.id) }
                    withContext(Dispatchers.Main) {
                        result.onSuccess { nav.openProject(it.id) }
                            .onFailure { Toast.makeText(context, it.userMessage(), Toast.LENGTH_LONG).show() }
                        working = null
                    }
                }
            },
            onDismiss = { confirmMove = false },
        )
    }
}
