package com.brickledger.app.ui.screens

import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.PhotoCamera
import androidx.compose.material.icons.rounded.PhotoLibrary
import androidx.compose.material.icons.rounded.Sync
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import com.brickledger.app.AppContainer
import com.brickledger.app.core.LABOUR_CATEGORY
import com.brickledger.app.core.Vocab
import com.brickledger.app.core.fmtQty
import com.brickledger.app.core.newId
import com.brickledger.app.core.todayIso
import com.brickledger.app.data.Images
import com.brickledger.app.data.mergeAttachments
import com.brickledger.app.data.local.Category
import com.brickledger.app.data.local.DailyLog
import com.brickledger.app.data.local.Expense
import com.brickledger.app.data.local.Fund
import com.brickledger.app.data.local.Issue
import com.brickledger.app.data.local.Material
import com.brickledger.app.data.local.Movement
import com.brickledger.app.data.local.Phase
import com.brickledger.app.data.local.ProjectEntity
import com.brickledger.app.data.local.SiteTask
import com.brickledger.app.data.local.SyncEntity
import com.brickledger.app.data.local.Vendor
import com.brickledger.app.data.local.Worker
import com.brickledger.app.data.remote.userMessage
import com.brickledger.app.ui.components.ConfirmDialog
import com.brickledger.app.ui.components.FormField
import com.brickledger.app.ui.components.FormFields
import com.brickledger.app.ui.components.LoadingBox
import com.brickledger.app.ui.components.ScreenScaffold
import com.brickledger.app.ui.components.SectionLabel
import com.brickledger.app.ui.components.Values
import com.brickledger.app.ui.components.bool
import com.brickledger.app.ui.components.int
import com.brickledger.app.ui.components.num
import com.brickledger.app.ui.components.rememberFlowState
import com.brickledger.app.ui.components.str
import com.brickledger.app.ui.components.validate
import com.brickledger.app.ui.navigation.FormRoute
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/** Lookup lists for pickers. */
private data class Lookups(
    val categories: List<Category> = emptyList(),
    val phases: List<Phase> = emptyList(),
    val vendors: List<Vendor> = emptyList(),
    val workers: List<Worker> = emptyList(),
) {
    val categoryOptions get() = categories.map { it.id to it.name }
    val phaseOptions get() = phases.map { it.id to it.name }
    val vendorOptions get() = vendors.map { it.id to it.name }
    val workerOptions get() = workers.filter { it.active }.map { it.id to it.name }
}

/** How one kind of record is edited: fields, mapping to/from form values, and what to save. */
private class FormSpec(
    val noun: String,
    val fields: List<FormField>,
    val attachType: String? = null,
    val toValues: (SyncEntity?) -> Map<String, String>,
    val build: (Values, SyncEntity?, String) -> List<SyncEntity>,
)

private fun s(v: Any?): String = when (v) {
    null -> ""
    is Double -> if (v % 1.0 == 0.0) v.toLong().toString() else v.toString()
    else -> v.toString()
}

private fun parsePrefill(prefill: String?): Map<String, String> =
    prefill?.split(';')?.mapNotNull { part -> part.split('=', limit = 2).takeIf { it.size == 2 }?.let { it[0] to Uri.decode(it[1]) } }?.toMap() ?: emptyMap()

private fun specFor(kind: String, pid: String, project: ProjectEntity, l: Lookups, material: Material?, prefill: Map<String, String>): FormSpec = when (kind) {
    "expense" -> FormSpec(
        noun = "expense",
        attachType = "expense",
        fields = listOf(
            FormField.Amount("amount", "Amount", required = true),
            FormField.Text("title", "What was it for?", required = true, placeholder = "e.g. Cement 50 bags"),
            FormField.Date("date", "Date", required = true),
            FormField.Choice("status", "Status", Vocab.expenseStatus, required = true, chips = true),
            FormField.Date("dueDate", "Due date", visible = { it["status"] == "due" }),
            FormField.Choice("categoryId", "Budget category", l.categoryOptions),
            FormField.Choice("vendorId", "Paid to (vendor)", l.vendorOptions),
            FormField.Choice("paymentMode", "Payment mode", Vocab.paymentModes, required = true, chips = true),
            FormField.Choice("phaseId", "Construction phase", l.phaseOptions),
            FormField.Section("more", "More details"),
            FormField.Amount("quantity", "Quantity", money = false),
            FormField.Text("unit", "Unit", placeholder = "bags, kg, cft…"),
            FormField.Amount("rate", "Rate per unit"),
            FormField.Amount("taxAmount", "Tax / GST included"),
            FormField.Text("reference", "Bill / cheque / UTR no."),
            FormField.Text("paidBy", "Paid by"),
            FormField.Choice("workerId", "Worker (wage payment)", l.workerOptions),
            FormField.Text("notes", "Notes", multiline = true),
        ),
        toValues = { e ->
            (e as? Expense)?.let {
                mapOf(
                    "amount" to s(it.amount), "title" to it.title, "date" to it.date, "status" to it.status, "dueDate" to s(it.dueDate),
                    "categoryId" to s(it.categoryId), "vendorId" to s(it.vendorId), "paymentMode" to it.paymentMode, "phaseId" to s(it.phaseId),
                    "quantity" to s(it.quantity), "unit" to s(it.unit), "rate" to s(it.rate), "taxAmount" to s(it.taxAmount),
                    "reference" to s(it.reference), "paidBy" to s(it.paidBy), "workerId" to s(it.workerId), "notes" to s(it.notes),
                )
            } ?: (mapOf("date" to todayIso(), "status" to "paid", "paymentMode" to "upi") + prefill)
        },
        build = { v, e, id ->
            val old = e as? Expense
            listOf(
                Expense(
                    id = id, projectId = pid, date = v.str("date")!!, title = v.str("title")!!, amount = v.num("amount")!!,
                    categoryId = v.str("categoryId"), phaseId = v.str("phaseId"), vendorId = v.str("vendorId"), workerId = v.str("workerId"),
                    paymentMode = v["paymentMode"] ?: "cash", status = v["status"] ?: "paid", dueDate = if (v["status"] == "due") v.str("dueDate") else null,
                    reference = v.str("reference"), quantity = v.num("quantity"), unit = v.str("unit"), rate = v.num("rate"),
                    taxAmount = v.num("taxAmount"), paidBy = v.str("paidBy"), notes = v.str("notes"),
                    createdBy = old?.createdBy, updatedAt = old?.updatedAt, serverSeq = old?.serverSeq ?: 0,
                ),
            )
        },
    )

    "category" -> FormSpec(
        noun = "budget category",
        fields = listOf(FormField.Text("name", "Name", required = true), FormField.Amount("plannedAmount", "Planned amount")),
        toValues = { e -> (e as? Category)?.let { mapOf("name" to it.name, "plannedAmount" to s(it.plannedAmount)) } ?: emptyMap() },
        build = { v, e, id ->
            val old = e as? Category
            listOf(
                Category(
                    id = id, projectId = pid, name = v.str("name")!!, plannedAmount = v.num("plannedAmount") ?: 0.0, icon = old?.icon,
                    sortOrder = old?.sortOrder ?: ((l.categories.maxOfOrNull { it.sortOrder } ?: 0) + 1),
                    createdBy = old?.createdBy, updatedAt = old?.updatedAt, serverSeq = old?.serverSeq ?: 0,
                ),
            )
        },
    )

    "phase" -> FormSpec(
        noun = "phase",
        fields = listOf(
            FormField.Text("name", "Phase name", required = true),
            FormField.Choice("status", "Status", Vocab.phaseStatus, required = true, chips = true),
            FormField.Amount("progress", "Progress", money = false, suffix = "%"),
            FormField.Date("plannedStart", "Planned start"),
            FormField.Date("plannedEnd", "Planned end"),
            FormField.Date("actualStart", "Actual start"),
            FormField.Date("actualEnd", "Actual end"),
            FormField.Text("description", "Notes", multiline = true),
        ),
        toValues = { e ->
            (e as? Phase)?.let {
                mapOf(
                    "name" to it.name, "status" to it.status, "progress" to it.progress.toString(), "plannedStart" to s(it.plannedStart),
                    "plannedEnd" to s(it.plannedEnd), "actualStart" to s(it.actualStart), "actualEnd" to s(it.actualEnd), "description" to s(it.description),
                )
            } ?: mapOf("status" to "not_started", "progress" to "0")
        },
        build = { v, e, id ->
            val old = e as? Phase
            var status = v["status"] ?: "not_started"
            var progress = (v.int("progress") ?: 0).coerceIn(0, 100)
            if (status == "completed") progress = 100 else if (progress == 100) status = "completed"
            if (progress in 1..99 && status == "not_started") status = "in_progress"
            listOf(
                Phase(
                    id = id, projectId = pid, name = v.str("name")!!, description = v.str("description"), status = status, progress = progress,
                    plannedStart = v.str("plannedStart"), plannedEnd = v.str("plannedEnd"), actualStart = v.str("actualStart") ?: if (status != "not_started") todayIso() else null,
                    actualEnd = v.str("actualEnd") ?: if (status == "completed") todayIso() else null,
                    sortOrder = old?.sortOrder ?: ((l.phases.maxOfOrNull { it.sortOrder } ?: 0) + 1),
                    createdBy = old?.createdBy, updatedAt = old?.updatedAt, serverSeq = old?.serverSeq ?: 0,
                ),
            )
        },
    )

    "vendor" -> FormSpec(
        noun = "vendor",
        fields = listOf(
            FormField.Text("name", "Name", required = true),
            FormField.Choice("type", "Type", Vocab.vendorTypes, required = true),
            FormField.Text("contactPerson", "Contact person"),
            FormField.Text("phone", "Phone", keyboard = KeyboardType.Phone),
            FormField.Text("email", "Email", keyboard = KeyboardType.Email),
            FormField.Amount("contractAmount", "Agreed contract amount"),
            FormField.Text("taxId", "GSTIN / tax ID"),
            FormField.Text("address", "Address"),
            FormField.Text("notes", "Notes", multiline = true),
        ),
        toValues = { e ->
            (e as? Vendor)?.let {
                mapOf(
                    "name" to it.name, "type" to it.type, "contactPerson" to s(it.contactPerson), "phone" to s(it.phone), "email" to s(it.email),
                    "contractAmount" to s(it.contractAmount), "taxId" to s(it.taxId), "address" to s(it.address), "notes" to s(it.notes),
                )
            } ?: mapOf("type" to "supplier")
        },
        build = { v, e, id ->
            val old = e as? Vendor
            listOf(
                Vendor(
                    id = id, projectId = pid, name = v.str("name")!!, type = v["type"] ?: "supplier", contactPerson = v.str("contactPerson"),
                    phone = v.str("phone"), email = v.str("email"), address = v.str("address"), taxId = v.str("taxId"),
                    contractAmount = v.num("contractAmount"), notes = v.str("notes"),
                    createdBy = old?.createdBy, updatedAt = old?.updatedAt, serverSeq = old?.serverSeq ?: 0,
                ),
            )
        },
    )

    "material" -> FormSpec(
        noun = "material",
        fields = listOf(
            FormField.Text("name", "Material", required = true, placeholder = "e.g. Cement (OPC 53)"),
            FormField.Choice("category", "Category", Vocab.materialCategories, required = true),
            FormField.Choice("unit", "Unit", Vocab.units, required = true),
            FormField.Amount("estimatedQty", "Estimated total needed", money = false),
            FormField.Amount("minStock", "Alert when stock below", money = false),
            FormField.Text("notes", "Notes", multiline = true),
        ),
        toValues = { e ->
            (e as? Material)?.let {
                mapOf("name" to it.name, "category" to it.category, "unit" to it.unit, "estimatedQty" to s(it.estimatedQty), "minStock" to s(it.minStock), "notes" to s(it.notes))
            } ?: mapOf("category" to "other", "unit" to "nos")
        },
        build = { v, e, id ->
            val old = e as? Material
            listOf(
                Material(
                    id = id, projectId = pid, name = v.str("name")!!, unit = v["unit"] ?: "nos", category = v["category"] ?: "other",
                    minStock = v.num("minStock"), estimatedQty = v.num("estimatedQty"), notes = v.str("notes"),
                    createdBy = old?.createdBy, updatedAt = old?.updatedAt, serverSeq = old?.serverSeq ?: 0,
                ),
            )
        },
    )

    "movement" -> {
        val incoming = (prefill["type"] ?: "in") == "in"
        val unit = material?.unit ?: ""
        FormSpec(
            noun = if (incoming) "delivery" else "usage",
            fields = buildList {
                add(FormField.Amount("quantity", "Quantity ($unit)", required = true, money = false))
                add(FormField.Date("date", "Date", required = true))
                if (incoming) {
                    add(FormField.Amount("rate", "Rate per $unit"))
                    add(FormField.Choice("vendorId", "Supplier", l.vendorOptions))
                    add(FormField.Toggle("recordExpense", "Also record as an expense", "Amount = quantity × rate. Keeps budget and stock in sync."))
                    add(FormField.Choice("categoryId", "Budget category", l.categoryOptions, visible = { it["recordExpense"] == "true" }))
                    add(FormField.Choice("expenseStatus", "Payment", Vocab.expenseStatus, chips = true, visible = { it["recordExpense"] == "true" }))
                } else {
                    add(FormField.Choice("phaseId", "Used for phase", l.phaseOptions))
                }
                add(FormField.Text("notes", "Notes", multiline = true))
            },
            toValues = { mapOf("date" to todayIso(), "recordExpense" to "true", "expenseStatus" to "paid") + prefill },
            build = { v, _, id ->
                val qty = v.num("quantity")!!
                val rate = v.num("rate")
                val vendorId = v.str("vendorId")
                val expense = if (incoming && v.bool("recordExpense") && rate != null && material != null) {
                    Expense(
                        id = newId(), projectId = pid, date = v.str("date")!!, title = "${material.name} - ${qty.fmtQty()} $unit",
                        amount = Math.round(qty * rate * 100) / 100.0, categoryId = v.str("categoryId"), vendorId = vendorId,
                        paymentMode = "bank_transfer", status = v["expenseStatus"] ?: "paid", quantity = qty, unit = unit, rate = rate,
                    )
                } else null
                listOfNotNull(
                    expense,
                    Movement(
                        id = id, projectId = pid, materialId = material?.id ?: "", type = if (incoming) "in" else "out", quantity = qty,
                        rate = if (incoming) rate else null, date = v.str("date")!!, vendorId = if (incoming) vendorId else null,
                        phaseId = if (incoming) null else v.str("phaseId"), expenseId = expense?.id, notes = v.str("notes"),
                    ),
                )
            },
        )
    }

    "worker" -> FormSpec(
        noun = "worker",
        fields = listOf(
            FormField.Text("name", "Name", required = true),
            FormField.Choice("trade", "Trade", Vocab.trades, required = true),
            FormField.Amount("dailyWage", "Daily wage", required = true),
            FormField.Text("phone", "Phone", keyboard = KeyboardType.Phone),
            FormField.Choice("vendorId", "Labour contractor", l.vendorOptions),
            FormField.Toggle("active", "Currently working on site"),
            FormField.Text("notes", "Notes", multiline = true),
        ),
        toValues = { e ->
            (e as? Worker)?.let {
                mapOf("name" to it.name, "trade" to it.trade, "dailyWage" to s(it.dailyWage), "phone" to s(it.phone), "vendorId" to s(it.vendorId), "active" to it.active.toString(), "notes" to s(it.notes))
            } ?: mapOf("trade" to "helper", "active" to "true")
        },
        build = { v, e, id ->
            val old = e as? Worker
            listOf(
                Worker(
                    id = id, projectId = pid, name = v.str("name")!!, phone = v.str("phone"), trade = v["trade"] ?: "helper", dailyWage = v.num("dailyWage") ?: 0.0,
                    vendorId = v.str("vendorId"), active = v.bool("active"), notes = v.str("notes"),
                    createdBy = old?.createdBy, updatedAt = old?.updatedAt, serverSeq = old?.serverSeq ?: 0,
                ),
            )
        },
    )

    "task" -> FormSpec(
        noun = "task",
        fields = listOf(
            FormField.Text("title", "Task", required = true),
            FormField.Choice("status", "Status", Vocab.taskStatus, required = true, chips = true),
            FormField.Choice("priority", "Priority", Vocab.priorities, required = true, chips = true),
            FormField.Text("assignee", "Assigned to"),
            FormField.Date("dueDate", "Due date"),
            FormField.Choice("phaseId", "Phase", l.phaseOptions),
            FormField.Text("description", "Details", multiline = true),
        ),
        toValues = { e ->
            (e as? SiteTask)?.let {
                mapOf("title" to it.title, "status" to it.status, "priority" to it.priority, "assignee" to s(it.assignee), "dueDate" to s(it.dueDate), "phaseId" to s(it.phaseId), "description" to s(it.description))
            } ?: mapOf("status" to "todo", "priority" to "medium")
        },
        build = { v, e, id ->
            val old = e as? SiteTask
            val status = v["status"] ?: "todo"
            listOf(
                SiteTask(
                    id = id, projectId = pid, title = v.str("title")!!, description = v.str("description"), phaseId = v.str("phaseId"), status = status,
                    priority = v["priority"] ?: "medium", assignee = v.str("assignee"), dueDate = v.str("dueDate"),
                    completedAt = if (status == "done") old?.completedAt ?: com.brickledger.app.core.nowIso() else null,
                    createdBy = old?.createdBy, updatedAt = old?.updatedAt, serverSeq = old?.serverSeq ?: 0,
                ),
            )
        },
    )

    "log" -> FormSpec(
        noun = "diary entry",
        attachType = "log",
        fields = listOf(
            FormField.Date("date", "Date", required = true),
            FormField.Choice("weather", "Weather", Vocab.weather, chips = true),
            FormField.Text("labourCount", "People on site", keyboard = KeyboardType.Number),
            FormField.Text("workDone", "Work done today", required = true, multiline = true),
            FormField.Text("issues", "Problems / delays", multiline = true),
            FormField.Text("notes", "Other notes", multiline = true),
        ),
        toValues = { e ->
            (e as? DailyLog)?.let {
                mapOf("date" to it.date, "weather" to s(it.weather), "labourCount" to s(it.labourCount), "workDone" to it.workDone, "issues" to s(it.issues), "notes" to s(it.notes))
            } ?: mapOf("date" to todayIso())
        },
        build = { v, e, id ->
            val old = e as? DailyLog
            listOf(
                DailyLog(
                    id = id, projectId = pid, date = v.str("date")!!, weather = v.str("weather"), workDone = v.str("workDone")!!,
                    labourCount = v.int("labourCount"), issues = v.str("issues"), notes = v.str("notes"),
                    createdBy = old?.createdBy, updatedAt = old?.updatedAt, serverSeq = old?.serverSeq ?: 0,
                ),
            )
        },
    )

    "fund" -> FormSpec(
        noun = "funds entry",
        fields = listOf(
            FormField.Amount("amount", "Amount", required = true),
            FormField.Date("date", "Date received", required = true),
            FormField.Choice("source", "Source", Vocab.fundSources, required = true),
            FormField.Text("description", "Description", placeholder = "e.g. Home loan - tranche 2"),
            FormField.Text("reference", "Reference"),
            FormField.Text("notes", "Notes", multiline = true),
        ),
        toValues = { e ->
            (e as? Fund)?.let {
                mapOf("amount" to s(it.amount), "date" to it.date, "source" to it.source, "description" to s(it.description), "reference" to s(it.reference), "notes" to s(it.notes))
            } ?: mapOf("date" to todayIso(), "source" to "savings")
        },
        build = { v, e, id ->
            val old = e as? Fund
            listOf(
                Fund(
                    id = id, projectId = pid, date = v.str("date")!!, source = v["source"] ?: "savings", description = v.str("description"),
                    amount = v.num("amount")!!, reference = v.str("reference"), notes = v.str("notes"),
                    createdBy = old?.createdBy, updatedAt = old?.updatedAt, serverSeq = old?.serverSeq ?: 0,
                ),
            )
        },
    )

    "issue" -> FormSpec(
        noun = "issue",
        attachType = "issue",
        fields = listOf(
            FormField.Text("title", "What’s wrong?", required = true),
            FormField.Choice("severity", "Severity", Vocab.severities, required = true, chips = true),
            FormField.Choice("status", "Status", Vocab.issueStatus, required = true, chips = true),
            FormField.Text("assignee", "Who will fix it"),
            FormField.Date("dueDate", "Fix by"),
            FormField.Choice("phaseId", "Phase", l.phaseOptions),
            FormField.Text("description", "Details", multiline = true),
        ),
        toValues = { e ->
            (e as? Issue)?.let {
                mapOf("title" to it.title, "severity" to it.severity, "status" to it.status, "assignee" to s(it.assignee), "dueDate" to s(it.dueDate), "phaseId" to s(it.phaseId), "description" to s(it.description))
            } ?: mapOf("severity" to "medium", "status" to "open")
        },
        build = { v, e, id ->
            val old = e as? Issue
            val status = v["status"] ?: "open"
            listOf(
                Issue(
                    id = id, projectId = pid, title = v.str("title")!!, description = v.str("description"), severity = v["severity"] ?: "medium",
                    status = status, phaseId = v.str("phaseId"), assignee = v.str("assignee"), dueDate = v.str("dueDate"),
                    resolvedAt = if (status == "resolved") old?.resolvedAt ?: com.brickledger.app.core.nowIso() else null,
                    createdBy = old?.createdBy, createdAt = old?.createdAt, updatedAt = old?.updatedAt, serverSeq = old?.serverSeq ?: 0,
                ),
            )
        },
    )

    else -> error("Unknown form kind $kind")
}

private suspend fun loadEntity(container: AppContainer, kind: String, id: String): SyncEntity? = when (kind) {
    "expense" -> container.db.expenses().get(id)
    "category" -> container.db.categories().get(id)
    "phase" -> container.db.phases().get(id)
    "vendor" -> container.db.vendors().get(id)
    "material" -> container.db.materials().get(id)
    "worker" -> container.db.workers().get(id)
    "task" -> container.db.tasks().get(id)
    "log" -> container.db.logs().get(id)
    "fund" -> container.db.funds().get(id)
    "issue" -> container.db.issues().get(id)
    else -> null
}

@Composable
fun EntityFormScreen(container: AppContainer, route: FormRoute, onDone: () -> Unit) {
    if (route.kind == "project") return ProjectSettingsForm(container, route.projectId, onDone)
    val pid = route.projectId
    val project by rememberFlowState(pid, initial = null) { container.repo.project(pid) }
    val profile by container.session.profile.collectAsStateWithLifecycle()
    val categories by rememberFlowState(pid, initial = emptyList()) { container.db.categories().observe(pid) }
    val phases by rememberFlowState(pid, initial = emptyList()) { container.db.phases().observe(pid) }
    val vendors by rememberFlowState(pid, initial = emptyList()) { container.db.vendors().observe(pid) }
    val workers by rememberFlowState(pid, initial = emptyList()) { container.db.workers().observe(pid) }
    val entityId = remember { route.id ?: newId() }
    val values = remember { mutableStateMapOf<String, String>() }
    var existing by remember { mutableStateOf<SyncEntity?>(null) }
    var material by remember { mutableStateOf<Material?>(null) }
    var loaded by remember { mutableStateOf(false) }
    var errors by remember { mutableStateOf(emptyMap<String, String>()) }
    var confirmDelete by remember { mutableStateOf(false) }
    val prefill = remember { parsePrefill(route.prefill) }

    val p = project
    val lookups = Lookups(categories, phases, vendors, workers)
    LaunchedEffect(route) {
        existing = route.id?.let { loadEntity(container, route.kind, it) }
        material = route.parent?.let { container.db.materials().get(it) }
        // Wage payments default to the labour budget head.
        val extra = if (route.kind == "expense" && existing == null && prefill.containsKey("workerId") && !prefill.containsKey("categoryId")) {
            container.db.categories().observe(pid).first().firstOrNull { it.name == LABOUR_CATEGORY }?.let { mapOf("categoryId" to it.id) } ?: emptyMap()
        } else emptyMap()
        loaded = true
        values.clear()
        values.putAll(extra)
    }
    if (p == null || !loaded) return LoadingBox()
    val spec = remember(route.kind, lookups, material, p.id) { specFor(route.kind, pid, p, lookups, material, prefill) }
    val initialized = remember { java.util.concurrent.atomic.AtomicBoolean(false) }
    if (initialized.compareAndSet(false, true)) {
        // Runs once, before the fields read `values`: entity values (or defaults + prefill), keeping derived defaults set above.
        spec.toValues(existing).forEach { (k, v) -> if (!values.containsKey(k)) values[k] = v }
    }

    val isNew = existing == null
    val canEdit = p.canEdit
    val canDelete = !isNew && (p.isManager || (canEdit && existing?.createdBy == profile?.user?.id) || (existing?.createdBy == null && existing?.serverSeq == 0L))
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    // The screen stays tappable while it animates away: save, leave and delete each close it once.
    val closing = remember { java.util.concurrent.atomic.AtomicBoolean(false) }

    fun leave() {
        if (!closing.compareAndSet(false, true)) return
        if (isNew && spec.attachType != null) scope.launch { container.repo.discardPending(entityId); onDone() } else onDone()
    }
    BackHandler(onBack = ::leave)

    fun save() {
        if (closing.get()) return
        errors = validate(spec.fields, values)
        if (errors.isNotEmpty()) {
            scope.launch { snackbar.showSnackbar("Please fix the highlighted fields") }
            return
        }
        if (!closing.compareAndSet(false, true)) return
        val records = spec.build(values.toMap(), existing, entityId)
        // App scope: the write completes even though this screen closes immediately.
        container.appScope.launch { records.forEach { container.repo.save(it) } }
        onDone()
    }

    ScreenScaffold(
        title = (if (isNew) "New " else if (canEdit) "Edit " else "") + spec.noun,
        subtitle = material?.name ?: p.name,
        onBack = ::leave,
        snackbar = snackbar,
        actions = {
            if (canDelete) IconButton(onClick = { confirmDelete = true }) { Icon(Icons.Rounded.Delete, "Delete") }
            if (canEdit) TextButton(onClick = ::save) { Text("Save", fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold) }
        },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 8.dp),
        ) {
            FormFields(spec.fields, values, errors, p.currency, enabled = canEdit)
            if (spec.attachType != null) {
                Spacer(Modifier.height(16.dp))
                Attachments(container, p, spec.attachType, entityId)
            }
            if (canEdit) {
                Spacer(Modifier.height(24.dp))
                Button(onClick = ::save, modifier = Modifier.fillMaxWidth().height(52.dp)) { Text(if (isNew) "Save" else "Save changes") }
                Text(
                    if (p.isLocal) "Saved on this phone - no internet needed." else "Saved on this phone instantly and synced when online.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 8.dp).align(Alignment.CenterHorizontally),
                )
            }
            Spacer(Modifier.height(32.dp))
        }
    }
    if (confirmDelete) {
        ConfirmDialog(
            title = "Delete ${spec.noun}?",
            message = "This removes it for everyone on the project.",
            onConfirm = {
                val target = existing ?: return@ConfirmDialog
                if (!closing.compareAndSet(false, true)) return@ConfirmDialog
                container.appScope.launch { container.repo.delete(target) }
                onDone()
            },
            onDismiss = { confirmDelete = false },
        )
    }
}

/** Photos and bills for one record; queued offline and uploaded in the background. Tap one to view, edit, replace or delete it. */
@Composable
fun Attachments(container: AppContainer, project: ProjectEntity, entityType: String, entityId: String) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val files by rememberFlowState(entityId, initial = emptyList()) { container.db.files().observeForEntity(entityId) }
    val queue by rememberFlowState(entityId, initial = emptyList()) { container.db.uploads().observeForEntity(entityId) }
    val items = remember(files, queue) { mergeAttachments(files, queue) }
    var viewing by rememberSaveable { mutableStateOf<String?>(null) }
    var cameraUri by remember { mutableStateOf<Uri?>(null) }
    val bills = entityType == "expense"
    val category = if (bills) "receipt" else "photo"
    val takePicture = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val uri = cameraUri
        if (ok && uri != null) scope.launch { container.repo.addAttachment(project.id, entityType, entityId, uri, category) }
    }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) scope.launch { container.repo.addAttachment(project.id, entityType, entityId, uri, category) }
    }
    Column {
        SectionLabel(if (bills) "Receipts & bills" else "Photos")
        if (items.isEmpty()) {
            Text("Nothing attached yet.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(items, key = { it.key }) { a ->
                    AttachmentThumb(container, a, phoneOnly = project.isLocal, modifier = Modifier.size(88.dp)) { viewing = a.key }
                }
            }
        }
        if (project.canEdit) {
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = {
                    val file = Images.cameraFile(context)
                    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
                    cameraUri = uri
                    takePicture.launch(uri)
                }) {
                    Icon(Icons.Rounded.PhotoCamera, null)
                    Spacer(Modifier.width(8.dp))
                    Text("Camera")
                }
                OutlinedButton(onClick = { pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }) {
                    Icon(Icons.Rounded.PhotoLibrary, null)
                    Spacer(Modifier.width(8.dp))
                    Text("Gallery")
                }
            }
        }
    }
    viewing?.let { key ->
        FileViewer(container, project, items, startKey = key, noun = if (bills) "bill" else "photo", onDismiss = { viewing = null })
    }
}

/** Project details are edited online (they affect everyone's budget view immediately). */
@Composable
private fun ProjectSettingsForm(container: AppContainer, projectId: String, onDone: () -> Unit) {
    val project by rememberFlowState(projectId, initial = null) { container.repo.project(projectId) }
    val p = project ?: return LoadingBox()
    val values = remember(p.id) {
        mutableStateMapOf(
            "name" to p.name, "address" to s(p.address), "city" to s(p.city), "status" to p.status, "totalBudget" to s(p.totalBudget),
            "builtUpArea" to s(p.builtUpArea), "areaUnit" to p.areaUnit, "floors" to s(p.floors), "startDate" to s(p.startDate), "targetEndDate" to s(p.targetEndDate),
        )
    }
    var errors by remember { mutableStateOf(emptyMap<String, String>()) }
    var busy by remember { mutableStateOf(false) }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val fields = listOf(
        FormField.Text("name", "Project name", required = true),
        FormField.Text("address", "Site address"),
        FormField.Text("city", "City"),
        FormField.Choice("status", "Stage", Vocab.projectStatus, required = true, chips = true),
        FormField.Amount("totalBudget", "Total budget"),
        FormField.Amount("builtUpArea", "Built-up area", money = false),
        FormField.Choice("areaUnit", "Area unit", Vocab.areaUnits, required = true, chips = true),
        FormField.Text("floors", "Floors", keyboard = KeyboardType.Number),
        FormField.Date("startDate", "Start date"),
        FormField.Date("targetEndDate", "Target completion"),
    )
    ScreenScaffold(title = "Project settings", subtitle = p.name, onBack = onDone, snackbar = snackbar) { padding ->
        Column(Modifier.padding(padding).fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(16.dp)) {
            FormFields(fields, values, errors, p.currency, enabled = p.isManager)
            Spacer(Modifier.height(20.dp))
            if (p.isManager) {
                Button(
                    enabled = !busy,
                    onClick = {
                        if (busy) return@Button
                        errors = validate(fields, values)
                        if (errors.isNotEmpty()) return@Button
                        busy = true
                        scope.launch {
                            val body = buildJsonObject {
                                put("name", JsonPrimitive(values.str("name")))
                                put("address", values.str("address")?.let(::JsonPrimitive) ?: JsonNull)
                                put("city", values.str("city")?.let(::JsonPrimitive) ?: JsonNull)
                                put("status", JsonPrimitive(values["status"]))
                                put("totalBudget", JsonPrimitive(values.num("totalBudget") ?: 0.0))
                                put("builtUpArea", values.num("builtUpArea")?.let(::JsonPrimitive) ?: JsonNull)
                                put("areaUnit", JsonPrimitive(values["areaUnit"]))
                                put("floors", values.int("floors")?.let(::JsonPrimitive) ?: JsonNull)
                                put("startDate", values.str("startDate")?.let(::JsonPrimitive) ?: JsonNull)
                                put("targetEndDate", values.str("targetEndDate")?.let(::JsonPrimitive) ?: JsonNull)
                            }
                            runCatching { container.repo.updateProject(p.id, body) }
                                .onSuccess { onDone() }
                                .onFailure { snackbar.showSnackbar(it.userMessage()) }
                            busy = false
                        }
                    },
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                ) { Text(if (busy) "Saving…" else "Save changes") }
            }
        }
    }
}
