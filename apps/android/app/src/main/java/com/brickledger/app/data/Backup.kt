package com.brickledger.app.data

import android.net.Uri
import com.brickledger.app.data.local.Attendance
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
import com.brickledger.app.data.local.Vendor
import com.brickledger.app.data.local.Worker
import java.io.File
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable

/** Photo stored in the backup zip under [entry]. */
@Serializable
data class BackupPhoto(
    val entry: String,
    val entityType: String,
    val entityId: String?,
    val fileName: String,
    val mimeType: String,
    val category: String,
    val name: String,
)

const val BACKUP_FORMAT = "brickledger-backup"
const val BACKUP_VERSION = 1

/** Just enough of backup.json to tell what the file is before reading all of it. */
@Serializable
data class BackupHeader(val format: String = "", val version: Int = 0)

/** backup.json inside a project backup zip (format version [BACKUP_VERSION]). */
@Serializable
data class Backup(
    val format: String = BACKUP_FORMAT,
    val version: Int = BACKUP_VERSION,
    val exportedAt: String,
    val project: ProjectEntity,
    val categories: List<Category> = emptyList(),
    val phases: List<Phase> = emptyList(),
    val vendors: List<Vendor> = emptyList(),
    val materials: List<Material> = emptyList(),
    val movements: List<Movement> = emptyList(),
    val workers: List<Worker> = emptyList(),
    val attendance: List<Attendance> = emptyList(),
    val expenses: List<Expense> = emptyList(),
    val tasks: List<SiteTask> = emptyList(),
    val logs: List<DailyLog> = emptyList(),
    val funds: List<Fund> = emptyList(),
    val issues: List<Issue> = emptyList(),
    val photos: List<BackupPhoto> = emptyList(),
)

/** A restore problem, with a message written for the person holding the phone. */
class BackupException(message: String) : Exception(message)

/** A backup file copied into the app and checked, waiting for the user to confirm the restore. */
class IncomingBackup(val file: File, val backup: Backup) {
    val summary: String
        get() = listOfNotNull(
            plural(backup.expenses.size, "expense"),
            plural(backup.workers.size, "worker"),
            plural(backup.materials.size, "material"),
            plural(backup.logs.size, "diary entry", "diary entries"),
            plural(backup.photos.size, "photo"),
        ).joinToString(" · ").ifEmpty { "Budget and schedule only" }

    private fun plural(n: Int, one: String, many: String = one + "s") = if (n == 0) null else "$n ${if (n == 1) one else many}"
}

/**
 * Backups arriving from another app (opened or shared from WhatsApp, Gmail, Drive, Files) or picked
 * inside the app. The file is read and checked first; nothing is restored until the user confirms.
 */
class BackupInbox(private val repo: Repository, private val session: SessionStore) {
    sealed interface State {
        data object Reading : State
        data class Ready(val incoming: IncomingBackup, val restoring: Boolean = false) : State
        data class Failed(val message: String) : State
    }

    private val _state = MutableStateFlow<State?>(null)
    val state: StateFlow<State?> = _state.asStateFlow()

    suspend fun offer(uri: Uri) {
        discard()
        _state.value = State.Reading
        _state.value = try {
            State.Ready(repo.readBackup(uri))
        } catch (e: Exception) {
            State.Failed(e.restoreMessage())
        }
    }

    /** Restores the waiting backup and returns the new project, or null if it failed (the state says why). */
    suspend fun confirm(): ProjectEntity? {
        val ready = _state.value as? State.Ready ?: return null
        if (ready.restoring) return null
        _state.value = ready.copy(restoring = true)
        return try {
            // A phone with no account yet: restoring starts offline mode, so the project can be opened.
            if (!session.isActive) session.enterOfflineMode("")
            repo.restoreBackup(ready.incoming).also { discard() }
        } catch (e: Exception) {
            ready.incoming.file.delete()
            _state.value = State.Failed(e.restoreMessage())
            null
        }
    }

    fun discard() {
        (_state.value as? State.Ready)?.incoming?.file?.delete()
        _state.value = null
    }

    private fun Exception.restoreMessage() =
        (this as? BackupException)?.message ?: "The backup couldn’t be restored (${message ?: javaClass.simpleName}). Try again, or make a new backup."
}
