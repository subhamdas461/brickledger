package com.brickledger.app.data

import android.content.Context
import androidx.room.withTransaction
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.brickledger.app.BrickLedgerApp
import com.brickledger.app.core.AppJson
import com.brickledger.app.core.nowIso
import com.brickledger.app.data.local.AppDatabase
import com.brickledger.app.data.local.Attendance
import com.brickledger.app.data.local.Category
import com.brickledger.app.data.local.DailyLog
import com.brickledger.app.data.local.Expense
import com.brickledger.app.data.local.Fund
import com.brickledger.app.data.local.Issue
import com.brickledger.app.data.local.Material
import com.brickledger.app.data.local.Movement
import com.brickledger.app.data.local.PendingUpload
import com.brickledger.app.data.local.Phase
import com.brickledger.app.data.local.ProjectEntity
import com.brickledger.app.data.local.ProjectFile
import com.brickledger.app.data.local.SiteTask
import com.brickledger.app.data.local.SyncDao
import com.brickledger.app.data.local.SyncEntity
import com.brickledger.app.data.local.SyncStateEntity
import com.brickledger.app.data.local.Vendor
import com.brickledger.app.data.local.Worker
import com.brickledger.app.data.remote.ApiService
import com.brickledger.app.data.remote.MutationDto
import com.brickledger.app.data.remote.SyncPushRequest
import com.brickledger.app.data.remote.httpCode
import com.brickledger.app.data.remote.userMessage
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.reflect.KClass
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.jsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import retrofit2.HttpException

/** One synced table: API key, JSON serializer and DAO. Generic work stays inside the class. */
class SyncSpec<T : SyncEntity>(
    val key: String,
    private val type: KClass<T>,
    private val serializer: KSerializer<T>,
    val dao: SyncDao<T>,
) {
    fun owns(item: SyncEntity) = type.isInstance(item)

    @Suppress("UNCHECKED_CAST")
    suspend fun upsertLocal(item: SyncEntity) = dao.upsert(item as T)

    suspend fun pendingMutations(projectId: String): List<Pair<MutationDto, Int>> =
        dao.dirty(projectId).map { item ->
            val m = if (item.deletedAt != null) {
                MutationDto(key, "delete", item.id)
            } else {
                MutationDto(key, "upsert", item.id, AppJson.encodeToJsonElement(serializer, item).jsonObject)
            }
            m to item.localRev
        }

    /** Applies pulled rows; rows with local unpushed edits are left alone (they win until pushed). */
    suspend fun applyPulled(projectId: String, array: JsonArray): List<T> {
        val items = array.map { AppJson.decodeFromJsonElement(serializer, it) }
        val dirty = dao.dirtyIds(projectId).toSet()
        val incoming = items.filter { it.id !in dirty }
        incoming.filter { it.deletedAt != null }.forEach { dao.hardDelete(it.id) }
        val live = incoming.filter { it.deletedAt == null }
        if (live.isNotEmpty()) dao.upsertAll(live)
        return live
    }
}

class SyncRegistry(db: AppDatabase) {
    /** Dependency order (referenced entities first) - matches the server's RESOURCE_KEYS. */
    val specs: List<SyncSpec<*>> = listOf(
        SyncSpec("categories", Category::class, Category.serializer(), db.categories()),
        SyncSpec("phases", Phase::class, Phase.serializer(), db.phases()),
        SyncSpec("vendors", Vendor::class, Vendor.serializer(), db.vendors()),
        SyncSpec("materials", Material::class, Material.serializer(), db.materials()),
        SyncSpec("workers", Worker::class, Worker.serializer(), db.workers()),
        SyncSpec("expenses", Expense::class, Expense.serializer(), db.expenses()),
        SyncSpec("movements", Movement::class, Movement.serializer(), db.movements()),
        SyncSpec("attendance", Attendance::class, Attendance.serializer(), db.attendance()),
        SyncSpec("tasks", SiteTask::class, SiteTask.serializer(), db.tasks()),
        SyncSpec("logs", DailyLog::class, DailyLog.serializer(), db.logs()),
        SyncSpec("funds", Fund::class, Fund.serializer(), db.funds()),
        SyncSpec("issues", Issue::class, Issue.serializer(), db.issues()),
        SyncSpec("files", ProjectFile::class, ProjectFile.serializer(), db.files()),
    )

    fun specFor(item: SyncEntity): SyncSpec<*> = specs.first { it.owns(item) }
}

data class SyncOutcome(val errors: List<String> = emptyList())

/**
 * Push local changes, pull remote changes since the stored cursor, then upload queued
 * photos. Serialised with a mutex so the foreground and WorkManager never overlap.
 */
class SyncEngine(
    private val db: AppDatabase,
    private val api: ApiService,
    private val registry: SyncRegistry,
) {
    private val mutex = Mutex()

    suspend fun sync(projectId: String): SyncOutcome = mutex.withLock {
        val errors = mutableListOf<String>()
        val project = db.projects().get(projectId)
        // Phone-only projects (offline mode) never talk to a server until moved to the cloud.
        if (project?.isLocal == true) return@withLock SyncOutcome()
        if (project == null || project.role != "viewer") push(projectId, errors)
        pull(projectId)
        uploadPending(projectId, errors)
        if (errors.isNotEmpty()) {
            val state = db.syncState().get(projectId) ?: SyncStateEntity(projectId)
            db.syncState().upsert(state.copy(lastError = errors.first()))
        }
        SyncOutcome(errors)
    }

    private suspend fun push(projectId: String, errors: MutableList<String>) {
        val batch = registry.specs.flatMap { spec -> spec.pendingMutations(projectId).map { (m, rev) -> Triple(spec, m, rev) } }
        if (batch.isEmpty()) return
        var rejected = false
        for (chunk in batch.chunked(200)) {
            val response = api.push(projectId, SyncPushRequest(chunk.map { it.second }))
            val byId = chunk.associateBy { it.second.id }
            for (r in response.results) {
                val (spec, m, rev) = byId[r.id] ?: continue
                when {
                    r.status == "ok" && m.op == "delete" -> spec.dao.hardDelete(r.id)
                    // Server merged this record into another (same worker + day): the canonical row arrives on pull.
                    r.status == "ok" && r.canonicalId != null && r.canonicalId != r.id -> spec.dao.hardDelete(r.id)
                    r.status == "ok" -> spec.dao.markClean(r.id, rev)
                    r.retryable == false -> {
                        // Never going to succeed (permissions/validation): drop it and re-pull the server's version.
                        spec.dao.hardDelete(r.id)
                        rejected = true
                        errors += r.error ?: "A change was rejected by the server."
                    }
                    else -> Unit // transient - stays dirty, retried next sync
                }
            }
        }
        if (rejected) {
            val state = db.syncState().get(projectId) ?: SyncStateEntity(projectId)
            db.syncState().upsert(state.copy(cursor = 0))
        }
    }

    private suspend fun pull(projectId: String) {
        var cursor = db.syncState().get(projectId)?.cursor ?: 0
        do {
            val res = api.pull(projectId, cursor)
            db.withTransaction {
                for (spec in registry.specs) {
                    val array = res.changes[spec.key] as? JsonArray ?: continue
                    val live = spec.applyPulled(projectId, array)
                    if (spec.key == "attendance") {
                        live.filterIsInstance<Attendance>().forEach { db.attendance().deleteDuplicates(it.workerId, it.date, it.id) }
                    }
                }
                saveProject(res.project)
                db.syncState().upsert(SyncStateEntity(projectId, res.cursor, System.currentTimeMillis(), null))
            }
            cursor = res.cursor
        } while (res.hasMore)
    }

    suspend fun saveProject(p: ProjectEntity) {
        val existing = db.projects().get(p.id)
        // Detail payloads carry features but not list stats - keep the stats we already have.
        db.projects().upsert(p.copy(stats = existing?.stats ?: p.stats))
    }

    private suspend fun entityState(type: String, id: String): Boolean? = when (type) {
        "expense" -> db.expenses().isDirty(id)
        "log" -> db.logs().isDirty(id)
        "issue" -> db.issues().isDirty(id)
        "task" -> db.tasks().isDirty(id)
        "vendor" -> db.vendors().isDirty(id)
        else -> false
    }

    private suspend fun uploadPending(projectId: String, errors: MutableList<String>) {
        for (u in db.uploads().forProject(projectId)) {
            // A replacement's file is already on the server; a new upload waits for the record it belongs to.
            if (u.replacesId == null && u.entityId != null) {
                when (entityState(u.entityType, u.entityId)) {
                    null -> { // the entity was deleted - nothing to attach to
                        db.uploads().delete(u.id)
                        File(u.path).delete()
                        continue
                    }
                    true -> continue // wait until the entity itself is on the server
                    false -> Unit
                }
            }
            val file = File(u.path)
            if (!file.exists()) {
                db.uploads().delete(u.id)
                continue
            }
            val content = MultipartBody.Part.createFormData("file", u.fileName, file.asRequestBody(u.mimeType.toMediaType()))
            val saved = try {
                if (u.replacesId != null) {
                    api.replaceContent(projectId, u.replacesId, content)
                } else {
                    api.upload(projectId, buildList {
                        add(MultipartBody.Part.createFormData("id", u.id))
                        add(MultipartBody.Part.createFormData("name", u.name))
                        add(MultipartBody.Part.createFormData("category", u.category))
                        add(MultipartBody.Part.createFormData("entityType", u.entityType))
                        u.entityId?.let { add(MultipartBody.Part.createFormData("entityId", it)) }
                        add(content)
                    })
                }
            } catch (e: HttpException) {
                val code = e.code()
                if (code == 402 || code == 413) {
                    errors += e.userMessage() // plan/storage limit: keep it for later
                } else if (code in 400..499 && code != 401 && code != 408 && code != 429) {
                    errors += e.userMessage() // e.g. the file was deleted on the server, or no permission
                    db.uploads().delete(u.id)
                    file.delete()
                } else {
                    throw e
                }
                continue
            }
            val local = db.files().get(saved.id)
            // An edit made on the phone and not yet sent (a rename, a delete) still wins; the new picture's details are taken.
            db.files().upsert(
                if (local?.dirty == true) local.copy(fileName = saved.fileName, mimeType = saved.mimeType, sizeBytes = saved.sizeBytes, updatedAt = saved.updatedAt) else saved,
            )
            settle(u, saved)
        }
    }

    /** The queue entry can change while it is being sent: replaced again, renamed or deleted. None of that may be lost. */
    private suspend fun settle(sent: PendingUpload, saved: ProjectFile) {
        val now = db.uploads().get(sent.id)
        when {
            // Deleted on the phone mid-upload: delete it on the server too (next sync).
            now == null -> if (sent.replacesId == null) db.files().upsert(saved.withLocal(1, deletedAt = nowIso()))
            // A newer picture was chosen mid-upload: send it next, as a replacement.
            now.path != sent.path -> db.uploads().upsert(now.copy(replacesId = saved.id))
            else -> db.uploads().delete(sent.id)
        }
        // Renamed on the phone mid-upload (only possible before its first upload).
        if (now != null && sent.replacesId == null && now.name != sent.name) db.files().upsert(saved.copy(name = now.name).withLocal(1))
        File(sent.path).delete()
    }
}

/** Foreground sync state for the UI + scheduling of background sync through WorkManager. */
class SyncManager(
    private val context: Context,
    private val engine: SyncEngine,
    private val scope: CoroutineScope,
) {
    sealed interface State {
        data object Idle : State
        data object Running : State
        data class Done(val at: Long) : State
        data class Failed(val message: String, val offline: Boolean) : State
    }

    private val _state = MutableStateFlow<State>(State.Idle)
    val state: StateFlow<State> = _state.asStateFlow()

    fun syncNow(projectId: String, onDone: (SyncOutcome?) -> Unit = {}) {
        scope.launch {
            _state.value = State.Running
            try {
                val outcome = engine.sync(projectId)
                _state.value = if (outcome.errors.isEmpty()) State.Done(System.currentTimeMillis()) else State.Failed(outcome.errors.first(), false)
                onDone(outcome)
            } catch (e: Exception) {
                _state.value = State.Failed(e.userMessage(), e is IOException)
                if (e is IOException) request(projectId) // retry automatically when back online
                onDone(null)
            }
        }
    }

    /** Debounced background sync for a project (runs when there is a network connection). */
    fun request(projectId: String) {
        val work = OneTimeWorkRequestBuilder<SyncWorker>()
            .setInputData(workDataOf(SyncWorker.KEY_PROJECT to projectId))
            .setInitialDelay(3, TimeUnit.SECONDS)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork("sync-$projectId", ExistingWorkPolicy.APPEND_OR_REPLACE, work)
    }

    fun schedulePeriodic() {
        val periodic = PeriodicWorkRequestBuilder<SyncWorker>(1, TimeUnit.HOURS)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork("sync-all", ExistingPeriodicWorkPolicy.KEEP, periodic)
    }

    fun cancelAll() = WorkManager.getInstance(context).cancelAllWork()
}

class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val container = (applicationContext as BrickLedgerApp).container
        if (!container.session.loaded.value) container.session.load()
        if (!container.session.isLoggedIn) return Result.success()
        val ids = inputData.getString(KEY_PROJECT)?.let { listOf(it) } ?: container.db.projects().all().map { it.id }
        return try {
            ids.forEach { container.syncEngine.sync(it) }
            Result.success()
        } catch (e: IOException) {
            Result.retry()
        } catch (e: HttpException) {
            if (e.httpCode in listOf(401, 403, 404)) Result.failure() else Result.retry()
        }
    }

    companion object {
        const val KEY_PROJECT = "projectId"
    }
}
