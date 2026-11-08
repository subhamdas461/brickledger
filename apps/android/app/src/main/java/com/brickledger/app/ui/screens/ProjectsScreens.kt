package com.brickledger.app.ui.screens

import android.Manifest
import android.os.Build
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
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
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.brickledger.app.AppContainer
import com.brickledger.app.core.Money
import com.brickledger.app.core.Vocab
import com.brickledger.app.core.todayIso
import com.brickledger.app.data.local.ProjectEntity
import com.brickledger.app.data.remote.CreateProjectRequest
import com.brickledger.app.data.remote.userMessage
import com.brickledger.app.ui.components.EmptyView
import com.brickledger.app.ui.components.FormField
import com.brickledger.app.ui.components.FormFields
import com.brickledger.app.ui.components.IconBadge
import com.brickledger.app.ui.components.Meter
import com.brickledger.app.ui.components.ScreenScaffold
import com.brickledger.app.ui.components.SectionCard
import com.brickledger.app.ui.components.StatusChip
import com.brickledger.app.ui.components.Tone
import com.brickledger.app.ui.components.bool
import com.brickledger.app.ui.components.int
import com.brickledger.app.ui.components.num
import com.brickledger.app.ui.components.rememberFlowState
import com.brickledger.app.ui.components.str
import com.brickledger.app.ui.components.validate
import java.time.LocalDate
import kotlinx.coroutines.launch

fun statusTone(status: String) = when (status) {
    "completed" -> Tone.Green
    "on_hold" -> Tone.Amber
    "planning" -> Tone.Neutral
    else -> Tone.Blue
}

@Composable
fun ProjectsScreen(
    container: AppContainer,
    onOpen: (String) -> Unit,
    onCreate: () -> Unit,
    onSettings: () -> Unit,
    onSignIn: () -> Unit,
    onRegister: () -> Unit,
) {
    val projects by rememberFlowState(initial = null) { container.repo.projects() }
    val profile by container.session.profile.collectAsStateWithLifecycle()
    val isCloud = profile != null
    var refreshing by remember { mutableStateOf(false) }
    var creatingDemo by remember { mutableStateOf(false) }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    val pickBackup = rememberBackupPicker(container)
    val notifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    LaunchedEffect(isCloud) {
        if (Build.VERSION.SDK_INT >= 33) notifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        if (isCloud) {
            runCatching { container.repo.refreshProjects() }
            container.repo.refreshProfile()
        }
    }
    fun refresh() {
        refreshing = true
        scope.launch {
            if (isCloud) runCatching { container.repo.refreshProjects() }.onFailure { snackbar.showSnackbar(it.userMessage()) }
            refreshing = false
        }
    }
    fun demo() {
        creatingDemo = true
        scope.launch {
            runCatching { container.repo.createDemo() }
                .onSuccess { onOpen(it.id) }
                .onFailure { snackbar.showSnackbar(it.userMessage()) }
            creatingDemo = false
        }
    }

    ScreenScaffold(
        title = container.session.displayName.substringBefore(' ').let { if (it.isBlank()) "Your projects" else "Hello, $it" },
        subtitle = if (isCloud) "Your projects" else "Offline mode · saved on this phone",
        actions = { IconButton(onClick = onSettings) { Icon(Icons.Rounded.Settings, contentDescription = "Settings") } },
        floatingActionButton = {
            // This overload hides `text` from accessibility; the icon's description is the button's label.
            ExtendedFloatingActionButton(onClick = onCreate, icon = { Icon(Icons.Rounded.Add, contentDescription = "New project") }, text = { Text("New project") })
        },
        snackbar = snackbar,
    ) { padding ->
        PullToRefreshBox(isRefreshing = refreshing, onRefresh = ::refresh, modifier = Modifier.padding(padding).fillMaxSize()) {
            val list = projects
            if (list != null && list.isEmpty()) {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                    if (!isCloud) OfflineBanner(onSignIn, onRegister, Modifier.padding(16.dp))
                    EmptyView(
                        Icons.Rounded.Home,
                        "Create your first project",
                        if (isCloud) "Add your budget and dates - we’ll set up budget heads, a phase-by-phase schedule and common materials."
                        else "It’s saved on this phone - no internet needed. We’ll set up budget heads, phases and common materials.",
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Button(onClick = onCreate) { Text("Create project") }
                            TextButton(onClick = pickBackup) { Text("Restore from a backup file") }
                            if (isCloud) {
                                Spacer(Modifier.height(8.dp))
                                OutlinedButton(onClick = ::demo, enabled = !creatingDemo) {
                                    Icon(Icons.Rounded.AutoAwesome, null)
                                    Spacer(Modifier.width(8.dp))
                                    Text(if (creatingDemo) "Preparing…" else "Explore a sample project")
                                }
                            }
                        }
                    }
                }
            } else {
                LazyColumn(contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 96.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (!isCloud) item { OfflineBanner(onSignIn, onRegister) }
                    items(list.orEmpty(), key = { it.id }) { p -> ProjectCard(p) { onOpen(p.id) } }
                    if (isCloud && list != null && list.none { it.name.startsWith("Sample:") }) {
                        item {
                            OutlinedButton(onClick = ::demo, enabled = !creatingDemo, modifier = Modifier.fillMaxWidth()) {
                                Icon(Icons.Rounded.AutoAwesome, null)
                                Spacer(Modifier.width(8.dp))
                                Text("Explore a sample project")
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun OfflineBanner(onSignIn: () -> Unit, onRegister: () -> Unit, modifier: Modifier = Modifier) {
    SectionCard(modifier) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconBadge(Icons.Rounded.CloudOff)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text("Offline mode", style = MaterialTheme.typography.titleSmall)
                Text(
                    "Projects are stored only on this phone. Back them up from each project’s More tab, or create a free account to sync, back up and share with your team.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = onRegister) { Text("Create free account") }
            androidx.compose.material3.TextButton(onClick = onSignIn) { Text("Sign in") }
        }
    }
}

@Composable
private fun ProjectCard(p: ProjectEntity, onClick: () -> Unit) {
    val committed = p.stats.spent + p.stats.due
    SectionCard(onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconBadge(Icons.Rounded.Home)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(p.name, style = MaterialTheme.typography.titleMedium, maxLines = 1)
                Text(listOfNotNull(p.city, p.orgName.takeIf { p.city == null }).joinToString(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            StatusChip(Vocab.label(Vocab.projectStatus, p.status), statusTone(p.status))
            if (p.role != "manager") StatusChip(Vocab.label(Vocab.projectRoles, p.role))
            if (p.name.startsWith("Sample:")) StatusChip("Sample", Tone.Brand)
            if (p.isLocal) StatusChip("On this phone", Tone.Amber)
        }
        Spacer(Modifier.height(14.dp))
        Row {
            Column(Modifier.weight(1f)) {
                Text("Committed", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(Money.compact(committed, p.currency), style = MaterialTheme.typography.titleLarge)
                Text("of ${Money.compact(p.totalBudget, p.currency)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Column(Modifier.weight(1f)) {
                Text("Progress", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("${p.stats.progress}%", style = MaterialTheme.typography.titleLarge)
                Text("${p.stats.openTasks} open tasks", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Spacer(Modifier.height(12.dp))
        Meter(committed, p.totalBudget)
    }
}

@Composable
fun CreateProjectScreen(container: AppContainer, onBack: () -> Unit, onCreated: (String) -> Unit) {
    val values = remember {
        mutableStateMapOf(
            "status" to "in_progress",
            "currency" to "INR",
            "areaUnit" to "sqft",
            "startDate" to todayIso(),
            "targetEndDate" to LocalDate.now().plusYears(1).toString(),
            "useTemplates" to "true",
        )
    }
    var errors by remember { mutableStateOf(emptyMap<String, String>()) }
    var busy by remember { mutableStateOf(false) }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val fields = listOf(
        FormField.Text("name", "Project name", required = true, placeholder = "e.g. Our home, Whitefield"),
        FormField.Text("address", "Site address"),
        FormField.Text("city", "City"),
        FormField.Choice("status", "Stage", Vocab.projectStatus.filter { it.first != "completed" }, required = true, chips = true),
        FormField.Section("budget", "Budget"),
        FormField.Choice("currency", "Currency", Money.currencies.map { it to it }, required = true),
        FormField.Amount("totalBudget", "Total budget"),
        FormField.Section("house", "House"),
        FormField.Amount("builtUpArea", "Built-up area", money = false),
        FormField.Choice("areaUnit", "Area unit", Vocab.areaUnits, required = true, chips = true),
        FormField.Text("floors", "Floors", keyboard = KeyboardType.Number),
        FormField.Section("timeline", "Timeline"),
        FormField.Date("startDate", "Start date"),
        FormField.Date("targetEndDate", "Target completion"),
        FormField.Toggle("useTemplates", "Set up budget heads, phases & materials", "Recommended - everything stays editable."),
    )
    ScreenScaffold(title = "New project", onBack = onBack, snackbar = snackbar) { padding ->
        Column(Modifier.padding(padding).fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(16.dp)) {
            FormFields(fields, values, errors, values["currency"] ?: "INR")
            Spacer(Modifier.height(20.dp))
            Button(
                onClick = {
                    if (busy) return@Button // a second tap before the button disables would create a duplicate
                    errors = validate(fields, values)
                    if (errors.isNotEmpty()) return@Button
                    busy = true
                    scope.launch {
                        runCatching {
                            container.repo.createProject(
                                CreateProjectRequest(
                                    name = values.str("name")!!,
                                    address = values.str("address"),
                                    city = values.str("city"),
                                    status = values["status"] ?: "in_progress",
                                    currency = values["currency"] ?: "INR",
                                    totalBudget = values.num("totalBudget") ?: 0.0,
                                    builtUpArea = values.num("builtUpArea"),
                                    areaUnit = values["areaUnit"] ?: "sqft",
                                    floors = values.int("floors"),
                                    startDate = values.str("startDate"),
                                    targetEndDate = values.str("targetEndDate"),
                                    useTemplates = values.bool("useTemplates"),
                                ),
                            )
                        }.onSuccess { result ->
                            if (result.savedOnPhone && container.session.isLoggedIn) {
                                Toast.makeText(context, "No internet - project saved on this phone. Move it to the cloud from More when you’re online.", Toast.LENGTH_LONG).show()
                            }
                            onCreated(result.project.id)
                        }.onFailure { snackbar.showSnackbar(it.userMessage()) }
                        busy = false
                    }
                },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) { Text(if (busy) "Creating…" else "Create project", fontWeight = FontWeight.SemiBold) }
            Spacer(Modifier.height(24.dp))
        }
    }
}
