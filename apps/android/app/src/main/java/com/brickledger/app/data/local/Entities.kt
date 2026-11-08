package com.brickledger.app.data.local

import androidx.room.ColumnInfo
import androidx.room.Embedded
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import kotlinx.serialization.Serializable
import kotlinx.serialization.Transient

/**
 * Room entities double as the API's JSON shapes (same field names), so records go
 * straight from the sync payload into SQLite. `dirty`/`localRev` are local-only:
 * dirty = has changes not yet pushed; localRev guards against marking a record clean
 * when it was edited again while a push was in flight.
 */
interface SyncEntity {
    val id: String
    val projectId: String
    val createdBy: String?
    val deletedAt: String?
    val serverSeq: Long
    val dirty: Boolean
    val localRev: Int

    /** Copy marked as a pending local change. */
    fun withLocal(rev: Int, deletedAt: String? = this.deletedAt): SyncEntity
}

// ------------------------------------------------------------------ projects & sync bookkeeping

@Serializable
data class PlanFeatures(
    val csvExport: Boolean = true,
    val pdfReports: Boolean = false,
    val branding: Boolean = false,
    val prioritySupport: Boolean = false,
)

@Serializable
data class ProjectStats(
    val spent: Double = 0.0,
    val due: Double = 0.0,
    val progress: Int = 0,
    val openTasks: Int = 0,
)

@Serializable
@Entity(tableName = "projects")
data class ProjectEntity(
    @PrimaryKey val id: String,
    val orgId: String = "",
    val name: String,
    val description: String? = null,
    val address: String? = null,
    val city: String? = null,
    val status: String = "in_progress",
    val currency: String = "INR",
    val totalBudget: Double = 0.0,
    val plotArea: Double? = null,
    val builtUpArea: Double? = null,
    val areaUnit: String = "sqft",
    val floors: Int? = null,
    val startDate: String? = null,
    val targetEndDate: String? = null,
    val role: String = "viewer",
    val orgName: String = "",
    val orgPlan: String? = null,
    /** Present in project detail responses (list responses omit it). */
    @Embedded(prefix = "feat_") val features: PlanFeatures = PlanFeatures(),
    /** Present in project list responses (detail responses omit it). */
    @Embedded(prefix = "stats_") val stats: ProjectStats = ProjectStats(),
    val updatedAt: String? = null,
    /** Created in offline mode: lives only on this phone until moved to the cloud. */
    @ColumnInfo(defaultValue = "0") val isLocal: Boolean = false,
) {
    val canEdit: Boolean get() = role != "viewer"
    val isManager: Boolean get() = role == "manager"
}

@Entity(tableName = "sync_state")
data class SyncStateEntity(
    @PrimaryKey val projectId: String,
    val cursor: Long = 0,
    val lastSyncedAt: Long = 0,
    val lastError: String? = null,
)

/** A photo/document waiting to be uploaded (compressed copy kept in app storage). */
@Entity(tableName = "pending_uploads", indices = [Index("projectId"), Index("entityId")])
data class PendingUpload(
    @PrimaryKey val id: String,
    val projectId: String,
    val entityType: String,
    val entityId: String?,
    val path: String,
    val fileName: String,
    val mimeType: String,
    val category: String,
    val name: String,
    val createdAt: Long = System.currentTimeMillis(),
    val attempts: Int = 0,
    val error: String? = null,
)

// ------------------------------------------------------------------ synced entities

@Serializable
@Entity(tableName = "categories", indices = [Index("projectId")])
data class Category(
    @PrimaryKey override val id: String,
    override val projectId: String,
    val name: String,
    val plannedAmount: Double = 0.0,
    val color: String? = null,
    val icon: String? = null,
    val sortOrder: Int = 0,
    override val createdBy: String? = null,
    val updatedAt: String? = null,
    override val deletedAt: String? = null,
    override val serverSeq: Long = 0,
    @Transient override val dirty: Boolean = false,
    @Transient override val localRev: Int = 0,
) : SyncEntity {
    override fun withLocal(rev: Int, deletedAt: String?) = copy(dirty = true, localRev = rev, deletedAt = deletedAt)
}

@Serializable
@Entity(tableName = "phases", indices = [Index("projectId")])
data class Phase(
    @PrimaryKey override val id: String,
    override val projectId: String,
    val name: String,
    val description: String? = null,
    val status: String = "not_started",
    val progress: Int = 0,
    val plannedStart: String? = null,
    val plannedEnd: String? = null,
    val actualStart: String? = null,
    val actualEnd: String? = null,
    val sortOrder: Int = 0,
    override val createdBy: String? = null,
    val updatedAt: String? = null,
    override val deletedAt: String? = null,
    override val serverSeq: Long = 0,
    @Transient override val dirty: Boolean = false,
    @Transient override val localRev: Int = 0,
) : SyncEntity {
    override fun withLocal(rev: Int, deletedAt: String?) = copy(dirty = true, localRev = rev, deletedAt = deletedAt)
}

@Serializable
@Entity(tableName = "vendors", indices = [Index("projectId")])
data class Vendor(
    @PrimaryKey override val id: String,
    override val projectId: String,
    val name: String,
    val type: String = "supplier",
    val contactPerson: String? = null,
    val phone: String? = null,
    val email: String? = null,
    val address: String? = null,
    val taxId: String? = null,
    val contractAmount: Double? = null,
    val notes: String? = null,
    override val createdBy: String? = null,
    val updatedAt: String? = null,
    override val deletedAt: String? = null,
    override val serverSeq: Long = 0,
    @Transient override val dirty: Boolean = false,
    @Transient override val localRev: Int = 0,
) : SyncEntity {
    override fun withLocal(rev: Int, deletedAt: String?) = copy(dirty = true, localRev = rev, deletedAt = deletedAt)
}

@Serializable
@Entity(tableName = "materials", indices = [Index("projectId")])
data class Material(
    @PrimaryKey override val id: String,
    override val projectId: String,
    val name: String,
    val unit: String,
    val category: String = "other",
    val minStock: Double? = null,
    val estimatedQty: Double? = null,
    val notes: String? = null,
    override val createdBy: String? = null,
    val updatedAt: String? = null,
    override val deletedAt: String? = null,
    override val serverSeq: Long = 0,
    @Transient override val dirty: Boolean = false,
    @Transient override val localRev: Int = 0,
) : SyncEntity {
    override fun withLocal(rev: Int, deletedAt: String?) = copy(dirty = true, localRev = rev, deletedAt = deletedAt)
}

@Serializable
@Entity(tableName = "movements", indices = [Index("projectId"), Index("materialId")])
data class Movement(
    @PrimaryKey override val id: String,
    override val projectId: String,
    val materialId: String,
    val type: String,
    val quantity: Double,
    val rate: Double? = null,
    val date: String,
    val vendorId: String? = null,
    val phaseId: String? = null,
    val expenseId: String? = null,
    val notes: String? = null,
    override val createdBy: String? = null,
    val updatedAt: String? = null,
    override val deletedAt: String? = null,
    override val serverSeq: Long = 0,
    @Transient override val dirty: Boolean = false,
    @Transient override val localRev: Int = 0,
) : SyncEntity {
    override fun withLocal(rev: Int, deletedAt: String?) = copy(dirty = true, localRev = rev, deletedAt = deletedAt)
}

@Serializable
@Entity(tableName = "workers", indices = [Index("projectId")])
data class Worker(
    @PrimaryKey override val id: String,
    override val projectId: String,
    val name: String,
    val phone: String? = null,
    val trade: String = "helper",
    val dailyWage: Double = 0.0,
    val vendorId: String? = null,
    val active: Boolean = true,
    val notes: String? = null,
    override val createdBy: String? = null,
    val updatedAt: String? = null,
    override val deletedAt: String? = null,
    override val serverSeq: Long = 0,
    @Transient override val dirty: Boolean = false,
    @Transient override val localRev: Int = 0,
) : SyncEntity {
    override fun withLocal(rev: Int, deletedAt: String?) = copy(dirty = true, localRev = rev, deletedAt = deletedAt)
}

@Serializable
@Entity(tableName = "attendance", indices = [Index("projectId", "date"), Index("workerId")])
data class Attendance(
    @PrimaryKey override val id: String,
    override val projectId: String,
    val workerId: String,
    val date: String,
    val status: String,
    val overtimeHours: Double = 0.0,
    val notes: String? = null,
    override val createdBy: String? = null,
    val updatedAt: String? = null,
    override val deletedAt: String? = null,
    override val serverSeq: Long = 0,
    @Transient override val dirty: Boolean = false,
    @Transient override val localRev: Int = 0,
) : SyncEntity {
    override fun withLocal(rev: Int, deletedAt: String?) = copy(dirty = true, localRev = rev, deletedAt = deletedAt)
}

@Serializable
@Entity(tableName = "expenses", indices = [Index("projectId", "date"), Index("vendorId"), Index("workerId")])
data class Expense(
    @PrimaryKey override val id: String,
    override val projectId: String,
    val date: String,
    val title: String,
    val amount: Double,
    val categoryId: String? = null,
    val phaseId: String? = null,
    val vendorId: String? = null,
    val workerId: String? = null,
    val paymentMode: String = "cash",
    val status: String = "paid",
    val dueDate: String? = null,
    val reference: String? = null,
    val quantity: Double? = null,
    val unit: String? = null,
    val rate: Double? = null,
    val taxAmount: Double? = null,
    val paidBy: String? = null,
    val notes: String? = null,
    override val createdBy: String? = null,
    val updatedAt: String? = null,
    override val deletedAt: String? = null,
    override val serverSeq: Long = 0,
    @Transient override val dirty: Boolean = false,
    @Transient override val localRev: Int = 0,
) : SyncEntity {
    override fun withLocal(rev: Int, deletedAt: String?) = copy(dirty = true, localRev = rev, deletedAt = deletedAt)
}

@Serializable
@Entity(tableName = "tasks", indices = [Index("projectId")])
data class SiteTask(
    @PrimaryKey override val id: String,
    override val projectId: String,
    val title: String,
    val description: String? = null,
    val phaseId: String? = null,
    val status: String = "todo",
    val priority: String = "medium",
    val assignee: String? = null,
    val dueDate: String? = null,
    val completedAt: String? = null,
    override val createdBy: String? = null,
    val updatedAt: String? = null,
    override val deletedAt: String? = null,
    override val serverSeq: Long = 0,
    @Transient override val dirty: Boolean = false,
    @Transient override val localRev: Int = 0,
) : SyncEntity {
    override fun withLocal(rev: Int, deletedAt: String?) = copy(dirty = true, localRev = rev, deletedAt = deletedAt)
}

@Serializable
@Entity(tableName = "logs", indices = [Index("projectId", "date")])
data class DailyLog(
    @PrimaryKey override val id: String,
    override val projectId: String,
    val date: String,
    val weather: String? = null,
    val workDone: String,
    val labourCount: Int? = null,
    val issues: String? = null,
    val notes: String? = null,
    override val createdBy: String? = null,
    val updatedAt: String? = null,
    override val deletedAt: String? = null,
    override val serverSeq: Long = 0,
    @Transient override val dirty: Boolean = false,
    @Transient override val localRev: Int = 0,
) : SyncEntity {
    override fun withLocal(rev: Int, deletedAt: String?) = copy(dirty = true, localRev = rev, deletedAt = deletedAt)
}

@Serializable
@Entity(tableName = "funds", indices = [Index("projectId")])
data class Fund(
    @PrimaryKey override val id: String,
    override val projectId: String,
    val date: String,
    val source: String,
    val description: String? = null,
    val amount: Double,
    val reference: String? = null,
    val notes: String? = null,
    override val createdBy: String? = null,
    val updatedAt: String? = null,
    override val deletedAt: String? = null,
    override val serverSeq: Long = 0,
    @Transient override val dirty: Boolean = false,
    @Transient override val localRev: Int = 0,
) : SyncEntity {
    override fun withLocal(rev: Int, deletedAt: String?) = copy(dirty = true, localRev = rev, deletedAt = deletedAt)
}

@Serializable
@Entity(tableName = "issues", indices = [Index("projectId")])
data class Issue(
    @PrimaryKey override val id: String,
    override val projectId: String,
    val title: String,
    val description: String? = null,
    val severity: String = "medium",
    val status: String = "open",
    val phaseId: String? = null,
    val assignee: String? = null,
    val dueDate: String? = null,
    val resolvedAt: String? = null,
    override val createdBy: String? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    override val deletedAt: String? = null,
    override val serverSeq: Long = 0,
    @Transient override val dirty: Boolean = false,
    @Transient override val localRev: Int = 0,
) : SyncEntity {
    override fun withLocal(rev: Int, deletedAt: String?) = copy(dirty = true, localRev = rev, deletedAt = deletedAt)
}

@Serializable
@Entity(tableName = "files", indices = [Index("projectId"), Index("entityId")])
data class ProjectFile(
    @PrimaryKey override val id: String,
    override val projectId: String,
    val name: String,
    val fileName: String = "",
    val mimeType: String = "application/octet-stream",
    val sizeBytes: Long = 0,
    val category: String = "other",
    val entityType: String? = null,
    val entityId: String? = null,
    val expiresOn: String? = null,
    val notes: String? = null,
    override val createdBy: String? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    override val deletedAt: String? = null,
    override val serverSeq: Long = 0,
    @Transient override val dirty: Boolean = false,
    @Transient override val localRev: Int = 0,
) : SyncEntity {
    val isImage: Boolean get() = mimeType.startsWith("image/")
    override fun withLocal(rev: Int, deletedAt: String?) = copy(dirty = true, localRev = rev, deletedAt = deletedAt)
}
