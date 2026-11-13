package com.brickledger.app.data

import android.content.Context
import android.net.Uri
import androidx.room.withTransaction
import com.brickledger.app.core.AppJson
import com.brickledger.app.core.Templates
import com.brickledger.app.core.isoPlusDays
import com.brickledger.app.core.newId
import com.brickledger.app.core.nowIso
import com.brickledger.app.core.todayIso
import com.brickledger.app.core.wageFor
import com.brickledger.app.data.local.AppDatabase
import com.brickledger.app.data.local.Attendance
import com.brickledger.app.data.local.Category
import com.brickledger.app.data.local.Expense
import com.brickledger.app.data.local.Material
import com.brickledger.app.data.local.Phase
import com.brickledger.app.data.local.PendingUpload
import com.brickledger.app.data.local.ProjectEntity
import com.brickledger.app.data.local.ProjectStats
import com.brickledger.app.data.local.SiteTask
import com.brickledger.app.data.local.SyncEntity
import com.brickledger.app.data.local.Vendor
import com.brickledger.app.data.local.Worker
import com.brickledger.app.data.remote.ApiService
import com.brickledger.app.data.remote.CreateProjectRequest
import com.brickledger.app.data.remote.EmailRequest
import com.brickledger.app.data.remote.InviteRequest
import com.brickledger.app.data.remote.LoginRequest
import com.brickledger.app.data.remote.RefreshRequest
import com.brickledger.app.data.remote.RegisterRequest
import java.io.File
import java.time.YearMonth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

// ------------------------------------------------------------------ UI models

data class CategoryLine(val category: Category?, val name: String, val planned: Double, val paid: Double, val due: Double) {
    val committed: Double get() = paid + due
}

data class StockLine(val material: Material, val received: Double, val used: Double, val value: Double, val avgRate: Double?) {
    val stock: Double get() = received - used
    val low: Boolean get() = (material.minStock ?: 0.0) > 0 && stock < (material.minStock ?: 0.0)
}

data class LabourLine(val worker: Worker, val present: Int, val half: Int, val overtime: Double, val earned: Double, val paid: Double) {
    val balance: Double get() = earned - paid
    val days: Double get() = present + half / 2.0
}

data class VendorLine(val vendor: Vendor, val paid: Double, val due: Double) {
    val balance: Double? get() = vendor.contractAmount?.let { it - paid }
}

enum class Severity { Critical, Serious, Warning }

data class Alert(val severity: Severity, val title: String, val detail: String? = null, val target: String? = null)

data class DashboardState(
    val project: ProjectEntity,
    val budget: Double,
    val paid: Double,
    val due: Double,
    val overdue: Double,
    val labourPaid: Double,
    val fundsReceived: Double,
    val progress: Int,
    val categories: List<CategoryLine>,
    val monthly: List<Pair<String, Double>>,
    val phases: List<Phase>,
    val recent: List<Expense>,
    val alerts: List<Alert>,
    val presentToday: Int,
    val activeWorkers: Int,
    val openTasks: Int,
    val overdueTasks: Int,
    val openIssues: Int,
    val lowStock: Int,
    val categoryNames: Map<String, String>,
    val vendorNames: Map<String, String>,
) {
    val committed: Double get() = paid + due
    val remaining: Double get() = budget - committed
    val cashInHand: Double get() = fundsReceived - paid
    val costPerArea: Double? get() = project.builtUpArea?.takeIf { it > 0 }?.let { committed / it }
}

class Repository(
    private val context: Context,
    val db: AppDatabase,
    private val api: ApiService,
    private val session: SessionStore,
    private val registry: SyncRegistry,
    private val sync: SyncManager,
    private val engine: SyncEngine,
    private val http: okhttp3.OkHttpClient,
) {
    // ------------------------------------------------------------ auth

    suspend fun login(email: String, password: String) {
        val auth = api.login(LoginRequest(email.trim().lowercase(), password))
        protectOtherUsersData(auth.user.id)
        session.saveAuth(auth)
        afterSignIn()
    }

    suspend fun register(name: String, email: String, password: String, company: String?) {
        val auth = api.register(RegisterRequest(name.trim(), email.trim().lowercase(), password, company?.takeIf { it.isNotBlank() }, session.pendingInvite))
        protectOtherUsersData(auth.user.id)
        session.saveAuth(auth)
        session.setPendingInvite(null)
        afterSignIn()
    }

    /** A different person signing in must not see (or push) the previous user's cached cloud data. */
    private suspend fun protectOtherUsersData(newUserId: String) {
        val previous = session.lastUserId
        if (previous != null && previous != newUserId) wipeCloudData()
    }

    /** Start using the app on this phone without an account. */
    suspend fun enterOfflineMode(name: String) = session.enterOfflineMode(name)

    val isCloud: Boolean get() = session.isLoggedIn

    suspend fun forgotPassword(email: String) {
        api.forgotPassword(EmailRequest(email.trim().lowercase()))
    }

    private suspend fun afterSignIn() {
        session.pendingInvite?.let { token -> runCatching { api.acceptInvite(token) }; session.setPendingInvite(null) }
        refreshProjects()
        sync.schedulePeriodic()
    }

    suspend fun refreshProfile() = runCatching { session.saveProfile(api.me()) }

    /** Signs out of the cloud. Projects kept only on this phone (offline mode) stay. */
    suspend fun signOut() {
        val token = session.refreshToken
        if (token != null) runCatching { api.logout(RefreshRequest(token)) }
        wipeCloudData()
        // Last: clearing the session navigates the UI back to sign-in (unless offline mode is on).
        session.clear()
    }

    /** Removes cached cloud projects (and their queued changes/photos) from this phone. */
    private suspend fun wipeCloudData() {
        sync.cancelAll()
        withContext(Dispatchers.IO) {
            for (p in db.projects().cloud()) {
                db.withTransaction {
                    registry.specs.forEach { it.dao.clearProject(p.id) }
                    db.uploads().forProject(p.id).forEach { File(it.path).delete() }
                    db.uploads().clearProject(p.id)
                    db.syncState().delete(p.id)
                    db.projects().delete(p.id)
                }
            }
        }
    }

    suspend fun acceptInvite(token: String): String? = api.acceptInvite(token).projectId.also { refreshProjects() }

    // ------------------------------------------------------------ projects

    /** All projects. Cloud cards use the server's stats; phone-only cards are counted from this phone's data. */
    fun projects(): Flow<List<ProjectEntity>> = combine(db.projects().observeAll(), db.projects().observeLocalStats()) { list, local ->
        val byId = local.associateBy { it.projectId }
        list.map { p -> byId[p.id]?.let { s -> p.copy(stats = ProjectStats(s.spent, s.due, s.progress, s.openTasks)) } ?: p }
    }
    fun project(id: String): Flow<ProjectEntity?> = db.projects().observe(id)

    suspend fun refreshProjects() {
        val list = api.projects()
        val existing = db.projects().all().associateBy { it.id }
        // List payloads carry stats but not plan features - keep the features we know.
        db.projects().upsertAll(list.map { p -> p.copy(features = existing[p.id]?.features ?: p.features) })
        db.projects().deleteExcept(list.map { it.id })
    }

    data class Created(val project: ProjectEntity, val savedOnPhone: Boolean)

    /**
     * Cloud users get a server project; without an account - or without internet - the project
     * is created on the phone and can be moved to the cloud later.
     */
    suspend fun createProject(req: CreateProjectRequest): Created {
        if (!session.isLoggedIn) return Created(createLocalProject(req), true)
        return try {
            val p = api.createProject(req)
            engine.saveProject(p)
            sync.syncNow(p.id)
            Created(p, false)
        } catch (e: java.io.IOException) {
            Created(createLocalProject(req), true)
        }
    }

    suspend fun createLocalProject(req: CreateProjectRequest): ProjectEntity {
        val pid = newId()
        val project = ProjectEntity(
            id = pid, name = req.name, address = req.address, city = req.city, status = req.status, currency = req.currency,
            totalBudget = req.totalBudget, builtUpArea = req.builtUpArea, areaUnit = req.areaUnit, floors = req.floors,
            startDate = req.startDate, targetEndDate = req.targetEndDate, role = "manager", orgName = "On this phone",
            features = com.brickledger.app.data.local.PlanFeatures(csvExport = true, pdfReports = true), isLocal = true,
        )
        db.withTransaction {
            db.projects().upsert(project)
            if (req.useTemplates) {
                val planned = Templates.splitBudget(req.totalBudget)
                db.categories().upsertAll(Templates.categories.mapIndexed { i, c -> Category(newId(), pid, c.name, planned[i], icon = c.icon, sortOrder = i) })
                val dates = Templates.spreadPhaseDates(req.startDate, req.targetEndDate)
                db.phases().upsertAll(Templates.phases.mapIndexed { i, ph -> Phase(newId(), pid, ph.name, plannedStart = dates[i].first, plannedEnd = dates[i].second, sortOrder = i) })
                db.materials().upsertAll(Templates.materials.map { m -> Material(newId(), pid, m.name, m.unit, m.category) })
            }
        }
        return project
    }

    /**
     * Uploads a phone-only project to the signed-in cloud account: the server creates the project,
     * every local record is re-keyed to it and pushed through the normal sync (client UUIDs).
     */
    suspend fun moveToCloud(localId: String): ProjectEntity = moveLock.withLock {
        check(session.isLoggedIn) { "Sign in to move this project to the cloud." }
        // Checked under the lock: a second request for the same project finds it already moved
        // instead of creating a duplicate (and empty) cloud project.
        val local = db.projects().get(localId)?.takeIf { it.isLocal } ?: error("This project has already been moved to the cloud.")
        val created = api.createProject(
            CreateProjectRequest(
                name = local.name, address = local.address, city = local.city, status = local.status, currency = local.currency,
                totalBudget = local.totalBudget, builtUpArea = local.builtUpArea, areaUnit = local.areaUnit, floors = local.floors,
                startDate = local.startDate, targetEndDate = local.targetEndDate, useTemplates = false,
            ),
        )
        db.withTransaction {
            registry.specs.forEach { it.dao.rekey(localId, created.id) }
            db.uploads().rekey(localId, created.id)
            db.syncState().delete(localId)
            db.projects().delete(localId)
            engine.saveProject(created)
        }
        if (session.lastProjectId == localId) session.setLastProject(created.id)
        sync.syncNow(created.id)
        created
    }
    private val moveLock = Mutex()

    suspend fun updateProject(id: String, body: kotlinx.serialization.json.JsonObject): ProjectEntity {
        val p = api.updateProject(id, body)
        engine.saveProject(p)
        return p
    }

    suspend fun createDemo(): ProjectEntity {
        val p = api.createDemo()
        engine.saveProject(p)
        return p
    }

    fun syncNow(projectId: String) = sync.syncNow(projectId)
    val syncState get() = sync.state
    fun pendingCount(projectId: String) = db.pending().observePending(projectId)
    fun syncInfo(projectId: String) = db.syncState().observe(projectId)

    // ------------------------------------------------------------ local-first writes

    private suspend fun isLocalProject(projectId: String) = db.projects().get(projectId)?.isLocal == true

    suspend fun save(item: SyncEntity) {
        val spec = registry.specFor(item)
        val rev = (spec.dao.rev(item.id) ?: 0) + 1
        spec.upsertLocal(item.withLocal(rev))
        if (!isLocalProject(item.projectId)) sync.request(item.projectId)
    }

    suspend fun delete(item: SyncEntity) {
        val spec = registry.specFor(item)
        val local = isLocalProject(item.projectId)
        if (local || (item.serverSeq == 0L && item.dirty)) {
            // Never reached a server - just forget it.
            spec.dao.hardDelete(item.id)
            discardPending(item.id)
        } else {
            val rev = (spec.dao.rev(item.id) ?: 0) + 1
            spec.upsertLocal(item.withLocal(rev, deletedAt = nowIso()))
            sync.request(item.projectId)
        }
    }

    // ------------------------------------------------------------ backups (offline safety net)

    /** Zip with backup.json + photos stored on this phone. Share it to Drive, WhatsApp, email... */
    suspend fun exportBackup(projectId: String): File = withContext(Dispatchers.IO) {
        val p = db.projects().get(projectId) ?: error("Project not found")
        // A queued replacement belongs to a server file, not to this backup.
        val uploads = db.uploads().forProject(projectId).filter { it.replacesId == null }
        val backup = Backup(
            exportedAt = nowIso(),
            project = p,
            categories = db.categories().allFor(projectId), phases = db.phases().allFor(projectId), vendors = db.vendors().allFor(projectId),
            materials = db.materials().allFor(projectId), movements = db.movements().allFor(projectId), workers = db.workers().allFor(projectId),
            attendance = db.attendance().allFor(projectId), expenses = db.expenses().allFor(projectId), tasks = db.tasks().allFor(projectId),
            logs = db.logs().allFor(projectId), funds = db.funds().allFor(projectId), issues = db.issues().allFor(projectId),
            photos = uploads.filter { File(it.path).exists() }.map { BackupPhoto("photos/${it.id}", it.entityType, it.entityId, it.fileName, it.mimeType, it.category, it.name) },
        )
        val slug = p.name.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-').take(40).ifEmpty { "project" }
        val out = File(File(context.cacheDir, "exports").apply { mkdirs() }, "$slug-backup-${todayIso()}.zip")
        java.util.zip.ZipOutputStream(out.outputStream().buffered()).use { zip ->
            zip.putNextEntry(java.util.zip.ZipEntry("backup.json"))
            zip.write(AppJson.encodeToString(Backup.serializer(), backup).toByteArray())
            zip.closeEntry()
            uploads.forEach { u ->
                val f = File(u.path)
                if (f.exists()) {
                    zip.putNextEntry(java.util.zip.ZipEntry("photos/${u.id}"))
                    f.inputStream().use { it.copyTo(zip) }
                    zip.closeEntry()
                }
            }
        }
        out
    }

    /**
     * Copies a backup file into the app and checks it, so the user can see what it holds before
     * restoring. The copy also outlives the sending app's temporary permission to read the file.
     */
    suspend fun readBackup(uri: Uri): IncomingBackup = withContext(Dispatchers.IO) {
        val file = File(File(context.cacheDir, "incoming").apply { mkdirs() }, "${newId()}.zip")
        fun fail(message: String): Nothing {
            file.delete()
            throw BackupException(message)
        }
        try {
            val input = context.contentResolver.openInputStream(uri) ?: fail("Couldn’t open the file.")
            input.use { i -> file.outputStream().use { i.copyTo(it) } }
        } catch (e: BackupException) {
            throw e
        } catch (e: Exception) {
            fail("Couldn’t open the file. If it’s in Google Drive or WhatsApp, download it to the phone first, then try again.")
        }
        if (file.length() == 0L) fail("The file is empty - it may not have finished downloading. Download it again and retry.")
        val json = try {
            readZipText(file, "backup.json")
        } catch (e: Exception) {
            // Truncated download, corrupted file, or entries Android refuses to unpack (e.g. "../" paths).
            fail("This file is damaged or didn’t finish downloading. Download it again, or make a new backup on the other phone.")
        } ?: fail("This isn’t a BrickLedger backup. Choose the .zip file made with “Back up to a file”.")
        val header = runCatching { AppJson.decodeFromString(BackupHeader.serializer(), json) }.getOrNull()
        if (header?.format != BACKUP_FORMAT) fail("This isn’t a BrickLedger backup. Choose the .zip file made with “Back up to a file”.")
        if (header.version > BACKUP_VERSION) fail("This backup was made by a newer version of BrickLedger. Update the app on this phone, then try again.")
        val backup = runCatching { AppJson.decodeFromString(Backup.serializer(), json) }.getOrNull()
            ?: fail("This backup is damaged and can’t be read. Make a new backup on the other phone and send it again.")
        IncomingBackup(file, backup)
    }

    /** Reads one entry, walking the whole archive so a damaged file fails here - before the user confirms. */
    private fun readZipText(zipFile: File, name: String): String? {
        var text: String? = null
        java.util.zip.ZipInputStream(zipFile.inputStream().buffered()).use { zip ->
            for (entry in generateSequence { zip.nextEntry }) {
                if (entry.name == name && text == null) text = zip.readBytes().decodeToString()
            }
        }
        return text
    }

    /**
     * Restores a checked backup as a new project on this phone. Every id is regenerated (and references
     * remapped) so a restored copy never collides with the original, here or in the cloud. Rows are
     * marked as not yet uploaded, so "Move to the cloud" sends all of them.
     */
    suspend fun restoreBackup(incoming: IncomingBackup): ProjectEntity = withContext(Dispatchers.IO) {
        val b = incoming.backup
        val photoFiles = mutableMapOf<String, File>()

        val ids = HashMap<String, String>()
        fun id(old: String) = ids.getOrPut(old) { newId() }
        fun ref(old: String?) = old?.let { ids[it] ?: it }
        val pid = id(b.project.id)
        // Assign new ids first so references can be remapped regardless of order.
        listOf(b.categories, b.phases, b.vendors, b.materials, b.movements, b.workers, b.attendance, b.expenses, b.tasks, b.logs, b.funds, b.issues)
            .flatten().forEach { id(it.id) }
        val project = b.project.copy(
            id = pid, isLocal = true, role = "manager", orgName = "On this phone",
            features = b.project.features.copy(pdfReports = true), stats = ProjectStats(),
        )
        try {
            // Photos: only zip entries that backup.json lists, each written under a fresh name.
            val listed = b.photos.map { it.entry }.toSet()
            java.util.zip.ZipInputStream(incoming.file.inputStream().buffered()).use { zip ->
                for (entry in generateSequence { zip.nextEntry }) {
                    if (entry.name !in listed || entry.name in photoFiles) continue
                    val dest = File(Images.pendingDir(context), newId())
                    photoFiles[entry.name] = dest
                    dest.outputStream().use { zip.copyTo(it) }
                }
            }
            db.withTransaction {
                db.projects().upsert(project)
                // withLocal(1): restored rows count as local changes, so moving the project to the cloud uploads them.
                db.categories().upsertAll(b.categories.map { it.copy(id = id(it.id), projectId = pid, serverSeq = 0).withLocal(1) })
                db.phases().upsertAll(b.phases.map { it.copy(id = id(it.id), projectId = pid, serverSeq = 0).withLocal(1) })
                db.vendors().upsertAll(b.vendors.map { it.copy(id = id(it.id), projectId = pid, serverSeq = 0).withLocal(1) })
                db.materials().upsertAll(b.materials.map { it.copy(id = id(it.id), projectId = pid, serverSeq = 0).withLocal(1) })
                db.workers().upsertAll(b.workers.map { it.copy(id = id(it.id), projectId = pid, vendorId = ref(it.vendorId), serverSeq = 0).withLocal(1) })
                db.expenses().upsertAll(b.expenses.map {
                    it.copy(id = id(it.id), projectId = pid, categoryId = ref(it.categoryId), phaseId = ref(it.phaseId), vendorId = ref(it.vendorId), workerId = ref(it.workerId), serverSeq = 0).withLocal(1)
                })
                db.movements().upsertAll(b.movements.map {
                    it.copy(id = id(it.id), projectId = pid, materialId = ref(it.materialId) ?: it.materialId, vendorId = ref(it.vendorId), phaseId = ref(it.phaseId), expenseId = ref(it.expenseId), serverSeq = 0).withLocal(1)
                })
                db.attendance().upsertAll(b.attendance.map { it.copy(id = id(it.id), projectId = pid, workerId = ref(it.workerId) ?: it.workerId, serverSeq = 0).withLocal(1) })
                db.tasks().upsertAll(b.tasks.map { it.copy(id = id(it.id), projectId = pid, phaseId = ref(it.phaseId), serverSeq = 0).withLocal(1) })
                db.logs().upsertAll(b.logs.map { it.copy(id = id(it.id), projectId = pid, serverSeq = 0).withLocal(1) })
                db.funds().upsertAll(b.funds.map { it.copy(id = id(it.id), projectId = pid, serverSeq = 0).withLocal(1) })
                db.issues().upsertAll(b.issues.map { it.copy(id = id(it.id), projectId = pid, phaseId = ref(it.phaseId), serverSeq = 0).withLocal(1) })
                for (ph in b.photos) {
                    val file = photoFiles[ph.entry] ?: continue
                    db.uploads().upsert(
                        PendingUpload(
                            id = newId(), projectId = pid, entityType = ph.entityType, entityId = ref(ph.entityId), path = file.absolutePath,
                            fileName = ph.fileName, mimeType = ph.mimeType, category = ph.category, name = ph.name,
                        ),
                    )
                }
            }
        } catch (e: Exception) {
            photoFiles.values.forEach { it.delete() }
            throw e
        }
        project
    }

    suspend fun markAttendance(projectId: String, worker: Worker, date: String, status: String, overtime: Double) {
        val existing = db.attendance().find(projectId, worker.id, date)
        val record = existing?.copy(status = status, overtimeHours = overtime)
            ?: Attendance(id = newId(), projectId = projectId, workerId = worker.id, date = date, status = status, overtimeHours = overtime)
        save(record)
    }

    // ------------------------------------------------------------ attachments

    suspend fun addAttachment(projectId: String, entityType: String, entityId: String?, uri: Uri, category: String) {
        val prepared = withContext(Dispatchers.IO) { Images.prepare(context, uri) }
        db.uploads().upsert(
            PendingUpload(
                id = newId(),
                projectId = projectId,
                entityType = entityType,
                entityId = entityId,
                path = prepared.file.absolutePath,
                fileName = prepared.fileName,
                mimeType = prepared.mimeType,
                category = category,
                name = prepared.fileName.substringBeforeLast('.'),
            ),
        )
        sync.request(projectId)
    }

    suspend fun discardPending(entityId: String) {
        db.uploads().forEntity(entityId).forEach {
            File(it.path).delete()
            db.uploads().delete(it.id)
        }
    }

    /** Renames a photo or bill: synced like any edit, or straight in the queue while it's only on this phone. */
    suspend fun renameAttachment(a: Attachment, name: String, notes: String? = a.file?.notes) {
        val clean = name.trim().take(200)
        if (clean.isEmpty()) return
        if (a.file != null) save(a.file.copy(name = clean, notes = notes?.trim()?.ifEmpty { null }))
        else db.uploads().upsert(a.queued!!.copy(name = clean))
    }

    /**
     * Swaps the picture and keeps the bill (name, notes, expense). Works offline: a server file gets
     * its new picture queued and sent when online; one still on the phone is swapped in place.
     */
    suspend fun replaceAttachment(a: Attachment, uri: Uri) {
        val prepared = withContext(Dispatchers.IO) { Images.prepare(context, uri) }
        val old = a.queued
        val swapped = { u: PendingUpload -> u.copy(path = prepared.file.absolutePath, fileName = prepared.fileName, mimeType = prepared.mimeType, attempts = 0, error = null) }
        if (a.file == null) {
            db.uploads().upsert(swapped(old!!))
            if (!isLocalProject(old.projectId)) sync.request(old.projectId)
        } else {
            val f = a.file
            val entry = old ?: PendingUpload(
                id = newId(), projectId = f.projectId, entityType = f.entityType ?: "document", entityId = f.entityId,
                path = "", fileName = "", mimeType = "", category = f.category, name = f.name, replacesId = f.id,
            )
            db.uploads().upsert(swapped(entry))
            sync.request(f.projectId)
        }
        old?.let { File(it.path).delete() }
    }

    suspend fun deleteAttachment(a: Attachment) {
        a.queued?.let {
            db.uploads().delete(it.id)
            File(it.path).delete()
        }
        a.file?.let { delete(it) }
    }

    /** Opens a file in another app (PDFs, documents): straight from the phone, or downloaded first. */
    suspend fun localCopy(a: Attachment): File = a.queued?.let { File(it.path) } ?: downloadAttachment(a.file!!)

    fun fileUrl(fileId: String) = "${session.baseUrl}api/v1/files/$fileId/content"

    /** Image URL that changes when the file's content does, so no cache shows a replaced picture. */
    fun fileUrl(file: com.brickledger.app.data.local.ProjectFile) = "${fileUrl(file.id)}?v=${file.sizeBytes}-${(file.updatedAt ?: "").hashCode().toUInt().toString(36)}"

    /** Downloads an attachment (authenticated) into cache so it can be opened or shared. */
    suspend fun downloadAttachment(file: com.brickledger.app.data.local.ProjectFile): File = withContext(Dispatchers.IO) {
        val safeName = file.fileName.ifBlank { file.name }.replace(Regex("[\\\\/:*?\"<>|]"), "_")
        val version = (file.updatedAt ?: "").hashCode().toUInt().toString(36)
        val out = File(File(context.cacheDir, "exports").apply { mkdirs() }, "${file.id.take(8)}-$version-$safeName")
        if (out.exists() && out.length() == file.sizeBytes) return@withContext out
        http.newCall(okhttp3.Request.Builder().url(fileUrl(file.id)).build()).execute().use { res ->
            if (!res.isSuccessful) throw java.io.IOException("Download failed (${res.code})")
            res.body?.byteStream()?.use { input -> out.outputStream().use { input.copyTo(it) } }
        }
        out
    }

    // ------------------------------------------------------------ online-only

    suspend fun members(projectId: String) = api.members(projectId)
    suspend fun invite(projectId: String, email: String, role: String) = api.invite(projectId, InviteRequest(email.trim().lowercase(), role))
    suspend fun activity(projectId: String) = api.activity(projectId)

    /** Downloads a PDF report or CSV export into cache/exports for sharing. */
    suspend fun download(projectId: String, kind: String, fileName: String): File = withContext(Dispatchers.IO) {
        val body = if (kind == "pdf") api.reportPdf(projectId, todayIso()) else api.export(projectId, "$kind.csv")
        val dir = File(context.cacheDir, "exports").apply { mkdirs() }
        val out = File(dir, fileName)
        body.byteStream().use { input -> out.outputStream().use { input.copyTo(it) } }
        out
    }

    // ------------------------------------------------------------ derived data

    fun stockLines(pid: String): Flow<List<StockLine>> =
        combine(db.materials().observe(pid), db.movements().observeStock(pid)) { materials, rows ->
            val byId = rows.associateBy { it.materialId }
            materials.map { m ->
                val r = byId[m.id]
                StockLine(m, r?.received ?: 0.0, r?.used ?: 0.0, r?.value ?: 0.0, r?.takeIf { it.ratedQty > 0 }?.let { it.value / it.ratedQty })
            }
        }

    fun labourLines(pid: String): Flow<List<LabourLine>> =
        combine(db.workers().observe(pid), db.attendance().observeAgg(pid), db.expenses().observeWorkerPaid(pid)) { workers, agg, paid ->
            val a = agg.associateBy { it.workerId }
            val p = paid.associateBy { it.workerId }
            workers.map { w ->
                val x = a[w.id]
                val present = x?.present ?: 0
                val half = x?.half ?: 0
                val ot = x?.overtime ?: 0.0
                val earned = present * w.dailyWage + half * w.dailyWage / 2 + wageFor("absent", ot, w.dailyWage)
                LabourLine(w, present, half, ot, earned, p[w.id]?.paid ?: 0.0)
            }
        }

    fun vendorLines(pid: String): Flow<List<VendorLine>> =
        combine(db.vendors().observe(pid), db.expenses().observeByVendor(pid)) { vendors, sums ->
            val s = sums.associateBy { it.vendorId }
            vendors.map { v -> VendorLine(v, s[v.id]?.paid ?: 0.0, s[v.id]?.due ?: 0.0) }
        }

    fun categoryLines(pid: String): Flow<List<CategoryLine>> =
        combine(db.categories().observe(pid), db.expenses().observeByCategory(pid)) { cats, sums ->
            val s = sums.associateBy { it.categoryId }
            val known = cats.map { it.id }.toSet()
            val lines = cats.map { c -> CategoryLine(c, c.name, c.plannedAmount, s[c.id]?.paid ?: 0.0, s[c.id]?.due ?: 0.0) }
            val orphan = sums.filter { it.categoryId == null || it.categoryId !in known }
            if (orphan.isEmpty()) lines else lines + CategoryLine(null, "Uncategorised", 0.0, orphan.sumOf { it.paid }, orphan.sumOf { it.due })
        }

    private data class PartA(val project: ProjectEntity?, val totals: com.brickledger.app.data.local.ExpenseTotals, val categories: List<CategoryLine>, val monthly: List<Pair<String, Double>>)
    private data class PartB(val funds: Double, val tasks: com.brickledger.app.data.local.Counts, val issues: com.brickledger.app.data.local.Counts, val presentToday: Int)
    private data class PartC(val stock: List<StockLine>, val workers: List<Worker>, val recent: List<Expense>, val vendors: Map<String, String>, val tasks: List<SiteTask>)

    fun dashboard(pid: String): Flow<DashboardState?> {
        val today = todayIso()
        val soon = isoPlusDays(today, 7)
        val a = combine(
            db.projects().observe(pid),
            db.expenses().observeTotals(pid, today, soon),
            categoryLines(pid),
            db.expenses().observeMonthly(pid),
            db.phases().observe(pid),
        ) { project, totals, categories, monthly, phases ->
            PartA(project, totals, categories, fillMonths(monthly.associate { it.month to it.amount }, project?.startDate)) to phases
        }
        val b = combine(
            db.funds().observeTotal(pid),
            db.tasks().observeCounts(pid, today),
            db.issues().observeCounts(pid),
            db.attendance().observePresent(pid, today),
        ) { funds, tasks, issues, present -> PartB(funds, tasks, issues, present) }
        val c = combine(
            stockLines(pid),
            db.workers().observe(pid),
            db.expenses().observeRecent(pid, 6),
            db.vendors().observe(pid).map { list -> list.associate { it.id to it.name } },
            db.tasks().observe(pid),
        ) { stock, workers, recent, vendors, tasks -> PartC(stock, workers, recent, vendors, tasks) }

        return combine(a, b, c) { (pa, phases), pb, pc ->
            val project = pa.project ?: return@combine null
            val t = pa.totals
            val budget = if (project.totalBudget > 0) project.totalBudget else pa.categories.sumOf { it.planned }
            val committed = t.paid + t.due
            val alerts = buildList {
                if (budget > 0 && committed > budget) add(Alert(Severity.Critical, "Over budget", "Committed is ${pct(committed, budget)}% of the budget.", "budget"))
                if (t.overdueCount > 0) add(Alert(Severity.Critical, "${t.overdueCount} overdue payment${if (t.overdueCount == 1) "" else "s"}", null, "expenses"))
                if (pb.issues.flagged > 0) add(Alert(Severity.Critical, "${pb.issues.flagged} critical issue${if (pb.issues.flagged == 1) "" else "s"} open", null, "issues"))
                pa.categories.filter { it.planned > 0 && it.committed > it.planned * 1.0001 }.forEach {
                    add(Alert(Severity.Serious, "${it.name} at ${pct(it.committed, it.planned)}% of plan", null, "budget"))
                }
                pc.tasks.filter { it.status != "done" && it.dueDate != null && it.dueDate < today }.take(3).forEach {
                    add(Alert(Severity.Serious, "Overdue: ${it.title}", null, "tasks"))
                }
                if (t.dueSoonCount > 0) add(Alert(Severity.Warning, "${t.dueSoonCount} payment${if (t.dueSoonCount == 1) "" else "s"} due this week", null, "expenses"))
                pc.stock.filter { it.low }.take(4).forEach { add(Alert(Severity.Warning, "Low stock: ${it.material.name}", null, "materials")) }
            }
            DashboardState(
                project = project,
                budget = budget,
                paid = t.paid,
                due = t.due,
                overdue = t.overdue,
                labourPaid = t.labourPaid,
                fundsReceived = pb.funds,
                progress = if (phases.isEmpty()) 0 else phases.sumOf { it.progress } / phases.size,
                categories = pa.categories,
                monthly = pa.monthly,
                phases = phases,
                recent = pc.recent,
                alerts = alerts,
                presentToday = pb.presentToday,
                activeWorkers = pc.workers.count { it.active },
                openTasks = pb.tasks.open,
                overdueTasks = pb.tasks.flagged,
                openIssues = pb.issues.open,
                lowStock = pc.stock.count { it.low },
                categoryNames = pa.categories.mapNotNull { l -> l.category?.let { it.id to it.name } }.toMap(),
                vendorNames = pc.vendors,
            )
        }
    }

    private fun pct(a: Double, b: Double) = if (b <= 0) 0 else ((a / b) * 100).toInt()

    /** Last 6-12 months, oldest first, filling months with no spend. */
    private fun fillMonths(byMonth: Map<String, Double>, start: String?): List<Pair<String, Double>> {
        val end = YearMonth.now()
        val first = listOfNotNull(byMonth.keys.minOrNull(), start?.take(7)).minOrNull()?.let { runCatching { YearMonth.parse(it) }.getOrNull() } ?: end
        var from = if (first.isBefore(end.minusMonths(11))) end.minusMonths(11) else first
        if (from.isAfter(end.minusMonths(5))) from = end.minusMonths(5)
        val out = mutableListOf<Pair<String, Double>>()
        var m = from
        while (!m.isAfter(end)) {
            val key = m.toString()
            out += key to (byMonth[key] ?: 0.0)
            m = m.plusMonths(1)
        }
        return out
    }
}
