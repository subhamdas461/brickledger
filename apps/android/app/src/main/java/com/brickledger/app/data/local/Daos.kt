package com.brickledger.app.data.local

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

/** Operations the sync engine needs from every synced table. */
interface SyncDao<T : SyncEntity> {
    @Upsert suspend fun upsert(item: T)
    @Upsert suspend fun upsertAll(items: List<T>)
    suspend fun get(id: String): T?
    suspend fun dirty(projectId: String): List<T>
    suspend fun dirtyIds(projectId: String): List<String>
    suspend fun rev(id: String): Int?
    suspend fun isDirty(id: String): Boolean?
    suspend fun markClean(id: String, rev: Int)
    suspend fun hardDelete(id: String)
    suspend fun clearProject(projectId: String)
    /** Live rows of a project (backups). */
    suspend fun allFor(projectId: String): List<T>
    /** Moves a project's rows to another project id and marks them for upload. */
    suspend fun rekey(from: String, to: String)
}

// ------------------------------------------------------------------ aggregate rows

data class ExpenseTotals(
    val paid: Double,
    val due: Double,
    val overdue: Double,
    val overdueCount: Int,
    val dueSoon: Double,
    val dueSoonCount: Int,
    val labourPaid: Double,
)

data class CategorySum(val categoryId: String?, val paid: Double, val due: Double)
data class MonthSum(val month: String, val amount: Double)
data class VendorSum(val vendorId: String, val paid: Double, val due: Double)
data class WorkerPaid(val workerId: String, val paid: Double)
data class StockRow(val materialId: String, val received: Double, val used: Double, val value: Double, val ratedQty: Double)
data class AttendanceAgg(val workerId: String, val present: Int, val half: Int, val overtime: Double)
data class Counts(val open: Int, val flagged: Int)
data class LocalProjectStats(val projectId: String, val spent: Double, val due: Double, val progress: Int, val openTasks: Int)

// ------------------------------------------------------------------ DAOs

@Dao
interface ProjectDao {
    @Query("SELECT * FROM projects ORDER BY name COLLATE NOCASE")
    fun observeAll(): Flow<List<ProjectEntity>>

    @Query("SELECT * FROM projects WHERE id = :id")
    fun observe(id: String): Flow<ProjectEntity?>

    @Query("SELECT * FROM projects WHERE id = :id")
    suspend fun get(id: String): ProjectEntity?

    @Query("SELECT * FROM projects")
    suspend fun all(): List<ProjectEntity>

    @Query("SELECT * FROM projects WHERE isLocal = 0")
    suspend fun cloud(): List<ProjectEntity>

    /** Card numbers for phone-only projects (the server sends them for cloud projects). Progress = average phase progress, as on the dashboard. */
    @Query(
        """SELECT p.id AS projectId,
           (SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE projectId = p.id AND deletedAt IS NULL AND status = 'paid') AS spent,
           (SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE projectId = p.id AND deletedAt IS NULL AND status = 'due') AS due,
           (SELECT COALESCE(SUM(progress) / COUNT(*), 0) FROM phases WHERE projectId = p.id AND deletedAt IS NULL) AS progress,
           (SELECT COUNT(*) FROM tasks WHERE projectId = p.id AND deletedAt IS NULL AND status != 'done') AS openTasks
           FROM projects p WHERE p.isLocal = 1""",
    )
    fun observeLocalStats(): Flow<List<LocalProjectStats>>

    @Upsert suspend fun upsert(p: ProjectEntity)
    @Upsert suspend fun upsertAll(p: List<ProjectEntity>)

    @Query("DELETE FROM projects WHERE isLocal = 0 AND id NOT IN (:keep)")
    suspend fun deleteExcept(keep: List<String>)

    @Query("DELETE FROM projects WHERE id = :id")
    suspend fun delete(id: String)
}

@Dao
interface SyncStateDao {
    @Query("SELECT * FROM sync_state WHERE projectId = :pid")
    suspend fun get(pid: String): SyncStateEntity?

    @Query("SELECT * FROM sync_state WHERE projectId = :pid")
    fun observe(pid: String): Flow<SyncStateEntity?>

    @Upsert suspend fun upsert(s: SyncStateEntity)

    @Query("DELETE FROM sync_state WHERE projectId = :pid")
    suspend fun delete(pid: String)
}

@Dao
interface UploadDao {
    @Query("SELECT * FROM pending_uploads WHERE projectId = :pid ORDER BY createdAt")
    suspend fun forProject(pid: String): List<PendingUpload>

    @Query("SELECT * FROM pending_uploads WHERE entityId = :entityId ORDER BY createdAt")
    fun observeForEntity(entityId: String): Flow<List<PendingUpload>>

    @Query("SELECT COUNT(*) FROM pending_uploads WHERE projectId = :pid")
    fun observeCount(pid: String): Flow<Int>

    @Upsert suspend fun upsert(u: PendingUpload)

    @Query("DELETE FROM pending_uploads WHERE id = :id")
    suspend fun delete(id: String)

    @Query("SELECT * FROM pending_uploads WHERE entityId = :entityId")
    suspend fun forEntity(entityId: String): List<PendingUpload>

    @Query("SELECT * FROM pending_uploads WHERE projectId = :pid ORDER BY createdAt DESC")
    fun observeForProject(pid: String): Flow<List<PendingUpload>>

    @Query("UPDATE pending_uploads SET projectId = :to WHERE projectId = :from")
    suspend fun rekey(from: String, to: String)

    @Query("DELETE FROM pending_uploads WHERE projectId = :pid")
    suspend fun clearProject(pid: String)
}

/** Number of local changes waiting to be pushed, across every synced table. */
@Dao
interface PendingDao {
    @Query(
        """SELECT (SELECT COUNT(*) FROM categories WHERE projectId = :pid AND dirty = 1)
         + (SELECT COUNT(*) FROM phases WHERE projectId = :pid AND dirty = 1)
         + (SELECT COUNT(*) FROM vendors WHERE projectId = :pid AND dirty = 1)
         + (SELECT COUNT(*) FROM materials WHERE projectId = :pid AND dirty = 1)
         + (SELECT COUNT(*) FROM movements WHERE projectId = :pid AND dirty = 1)
         + (SELECT COUNT(*) FROM workers WHERE projectId = :pid AND dirty = 1)
         + (SELECT COUNT(*) FROM attendance WHERE projectId = :pid AND dirty = 1)
         + (SELECT COUNT(*) FROM expenses WHERE projectId = :pid AND dirty = 1)
         + (SELECT COUNT(*) FROM tasks WHERE projectId = :pid AND dirty = 1)
         + (SELECT COUNT(*) FROM logs WHERE projectId = :pid AND dirty = 1)
         + (SELECT COUNT(*) FROM funds WHERE projectId = :pid AND dirty = 1)
         + (SELECT COUNT(*) FROM issues WHERE projectId = :pid AND dirty = 1)
         + (SELECT COUNT(*) FROM files WHERE projectId = :pid AND dirty = 1)
         + (SELECT COUNT(*) FROM pending_uploads WHERE projectId = :pid)""",
    )
    fun observePending(pid: String): Flow<Int>
}

@Dao
interface CategoryDao : SyncDao<Category> {
    @Query("SELECT * FROM categories WHERE projectId = :pid AND deletedAt IS NULL ORDER BY sortOrder, name")
    fun observe(pid: String): Flow<List<Category>>
    @Query("SELECT * FROM categories WHERE id = :id") override suspend fun get(id: String): Category?
    @Query("SELECT * FROM categories WHERE projectId = :projectId AND dirty = 1") override suspend fun dirty(projectId: String): List<Category>
    @Query("SELECT id FROM categories WHERE projectId = :projectId AND dirty = 1") override suspend fun dirtyIds(projectId: String): List<String>
    @Query("SELECT localRev FROM categories WHERE id = :id") override suspend fun rev(id: String): Int?
    @Query("SELECT dirty FROM categories WHERE id = :id") override suspend fun isDirty(id: String): Boolean?
    @Query("UPDATE categories SET dirty = 0 WHERE id = :id AND localRev = :rev") override suspend fun markClean(id: String, rev: Int)
    @Query("DELETE FROM categories WHERE id = :id") override suspend fun hardDelete(id: String)
    @Query("DELETE FROM categories WHERE projectId = :projectId") override suspend fun clearProject(projectId: String)
    @Query("SELECT * FROM categories WHERE projectId = :projectId AND deletedAt IS NULL") override suspend fun allFor(projectId: String): List<Category>
    @Query("UPDATE categories SET projectId = :to, dirty = 1, localRev = localRev + 1 WHERE projectId = :from") override suspend fun rekey(from: String, to: String)
}

@Dao
interface PhaseDao : SyncDao<Phase> {
    @Query("SELECT * FROM phases WHERE projectId = :pid AND deletedAt IS NULL ORDER BY sortOrder, name")
    fun observe(pid: String): Flow<List<Phase>>
    @Query("SELECT * FROM phases WHERE id = :id") override suspend fun get(id: String): Phase?
    @Query("SELECT * FROM phases WHERE projectId = :projectId AND dirty = 1") override suspend fun dirty(projectId: String): List<Phase>
    @Query("SELECT id FROM phases WHERE projectId = :projectId AND dirty = 1") override suspend fun dirtyIds(projectId: String): List<String>
    @Query("SELECT localRev FROM phases WHERE id = :id") override suspend fun rev(id: String): Int?
    @Query("SELECT dirty FROM phases WHERE id = :id") override suspend fun isDirty(id: String): Boolean?
    @Query("UPDATE phases SET dirty = 0 WHERE id = :id AND localRev = :rev") override suspend fun markClean(id: String, rev: Int)
    @Query("DELETE FROM phases WHERE id = :id") override suspend fun hardDelete(id: String)
    @Query("DELETE FROM phases WHERE projectId = :projectId") override suspend fun clearProject(projectId: String)
    @Query("SELECT * FROM phases WHERE projectId = :projectId AND deletedAt IS NULL") override suspend fun allFor(projectId: String): List<Phase>
    @Query("UPDATE phases SET projectId = :to, dirty = 1, localRev = localRev + 1 WHERE projectId = :from") override suspend fun rekey(from: String, to: String)
}

@Dao
interface VendorDao : SyncDao<Vendor> {
    @Query("SELECT * FROM vendors WHERE projectId = :pid AND deletedAt IS NULL ORDER BY name COLLATE NOCASE")
    fun observe(pid: String): Flow<List<Vendor>>
    @Query("SELECT * FROM vendors WHERE id = :id") override suspend fun get(id: String): Vendor?
    @Query("SELECT * FROM vendors WHERE projectId = :projectId AND dirty = 1") override suspend fun dirty(projectId: String): List<Vendor>
    @Query("SELECT id FROM vendors WHERE projectId = :projectId AND dirty = 1") override suspend fun dirtyIds(projectId: String): List<String>
    @Query("SELECT localRev FROM vendors WHERE id = :id") override suspend fun rev(id: String): Int?
    @Query("SELECT dirty FROM vendors WHERE id = :id") override suspend fun isDirty(id: String): Boolean?
    @Query("UPDATE vendors SET dirty = 0 WHERE id = :id AND localRev = :rev") override suspend fun markClean(id: String, rev: Int)
    @Query("DELETE FROM vendors WHERE id = :id") override suspend fun hardDelete(id: String)
    @Query("DELETE FROM vendors WHERE projectId = :projectId") override suspend fun clearProject(projectId: String)
    @Query("SELECT * FROM vendors WHERE projectId = :projectId AND deletedAt IS NULL") override suspend fun allFor(projectId: String): List<Vendor>
    @Query("UPDATE vendors SET projectId = :to, dirty = 1, localRev = localRev + 1 WHERE projectId = :from") override suspend fun rekey(from: String, to: String)
}

@Dao
interface MaterialDao : SyncDao<Material> {
    @Query("SELECT * FROM materials WHERE projectId = :pid AND deletedAt IS NULL ORDER BY name COLLATE NOCASE")
    fun observe(pid: String): Flow<List<Material>>
    @Query("SELECT * FROM materials WHERE id = :id") fun observeOne(id: String): Flow<Material?>
    @Query("SELECT * FROM materials WHERE id = :id") override suspend fun get(id: String): Material?
    @Query("SELECT * FROM materials WHERE projectId = :projectId AND dirty = 1") override suspend fun dirty(projectId: String): List<Material>
    @Query("SELECT id FROM materials WHERE projectId = :projectId AND dirty = 1") override suspend fun dirtyIds(projectId: String): List<String>
    @Query("SELECT localRev FROM materials WHERE id = :id") override suspend fun rev(id: String): Int?
    @Query("SELECT dirty FROM materials WHERE id = :id") override suspend fun isDirty(id: String): Boolean?
    @Query("UPDATE materials SET dirty = 0 WHERE id = :id AND localRev = :rev") override suspend fun markClean(id: String, rev: Int)
    @Query("DELETE FROM materials WHERE id = :id") override suspend fun hardDelete(id: String)
    @Query("DELETE FROM materials WHERE projectId = :projectId") override suspend fun clearProject(projectId: String)
    @Query("SELECT * FROM materials WHERE projectId = :projectId AND deletedAt IS NULL") override suspend fun allFor(projectId: String): List<Material>
    @Query("UPDATE materials SET projectId = :to, dirty = 1, localRev = localRev + 1 WHERE projectId = :from") override suspend fun rekey(from: String, to: String)
}

@Dao
interface MovementDao : SyncDao<Movement> {
    @Query("SELECT * FROM movements WHERE materialId = :materialId AND deletedAt IS NULL ORDER BY date DESC, updatedAt DESC")
    fun observeForMaterial(materialId: String): Flow<List<Movement>>

    @Query(
        """SELECT materialId,
           COALESCE(SUM(CASE WHEN type = 'in' THEN quantity ELSE 0 END), 0) AS received,
           COALESCE(SUM(CASE WHEN type = 'out' THEN quantity ELSE 0 END), 0) AS used,
           COALESCE(SUM(CASE WHEN type = 'in' AND rate IS NOT NULL THEN quantity * rate ELSE 0 END), 0) AS value,
           COALESCE(SUM(CASE WHEN type = 'in' AND rate IS NOT NULL THEN quantity ELSE 0 END), 0) AS ratedQty
           FROM movements WHERE projectId = :pid AND deletedAt IS NULL GROUP BY materialId""",
    )
    fun observeStock(pid: String): Flow<List<StockRow>>

    @Query(
        """SELECT materialId,
           COALESCE(SUM(CASE WHEN type = 'in' THEN quantity ELSE 0 END), 0) AS received,
           COALESCE(SUM(CASE WHEN type = 'out' THEN quantity ELSE 0 END), 0) AS used,
           0.0 AS value, 0.0 AS ratedQty
           FROM movements WHERE projectId = :pid AND deletedAt IS NULL GROUP BY materialId""",
    )
    suspend fun stockNow(pid: String): List<StockRow>

    @Query("SELECT * FROM movements WHERE id = :id") override suspend fun get(id: String): Movement?
    @Query("SELECT * FROM movements WHERE projectId = :projectId AND dirty = 1") override suspend fun dirty(projectId: String): List<Movement>
    @Query("SELECT id FROM movements WHERE projectId = :projectId AND dirty = 1") override suspend fun dirtyIds(projectId: String): List<String>
    @Query("SELECT localRev FROM movements WHERE id = :id") override suspend fun rev(id: String): Int?
    @Query("SELECT dirty FROM movements WHERE id = :id") override suspend fun isDirty(id: String): Boolean?
    @Query("UPDATE movements SET dirty = 0 WHERE id = :id AND localRev = :rev") override suspend fun markClean(id: String, rev: Int)
    @Query("DELETE FROM movements WHERE id = :id") override suspend fun hardDelete(id: String)
    @Query("DELETE FROM movements WHERE projectId = :projectId") override suspend fun clearProject(projectId: String)
    @Query("SELECT * FROM movements WHERE projectId = :projectId AND deletedAt IS NULL") override suspend fun allFor(projectId: String): List<Movement>
    @Query("UPDATE movements SET projectId = :to, dirty = 1, localRev = localRev + 1 WHERE projectId = :from") override suspend fun rekey(from: String, to: String)
}

@Dao
interface WorkerDao : SyncDao<Worker> {
    @Query("SELECT * FROM workers WHERE projectId = :pid AND deletedAt IS NULL ORDER BY active DESC, name COLLATE NOCASE")
    fun observe(pid: String): Flow<List<Worker>>
    @Query("SELECT * FROM workers WHERE id = :id") override suspend fun get(id: String): Worker?
    @Query("SELECT * FROM workers WHERE projectId = :projectId AND dirty = 1") override suspend fun dirty(projectId: String): List<Worker>
    @Query("SELECT id FROM workers WHERE projectId = :projectId AND dirty = 1") override suspend fun dirtyIds(projectId: String): List<String>
    @Query("SELECT localRev FROM workers WHERE id = :id") override suspend fun rev(id: String): Int?
    @Query("SELECT dirty FROM workers WHERE id = :id") override suspend fun isDirty(id: String): Boolean?
    @Query("UPDATE workers SET dirty = 0 WHERE id = :id AND localRev = :rev") override suspend fun markClean(id: String, rev: Int)
    @Query("DELETE FROM workers WHERE id = :id") override suspend fun hardDelete(id: String)
    @Query("DELETE FROM workers WHERE projectId = :projectId") override suspend fun clearProject(projectId: String)
    @Query("SELECT * FROM workers WHERE projectId = :projectId AND deletedAt IS NULL") override suspend fun allFor(projectId: String): List<Worker>
    @Query("UPDATE workers SET projectId = :to, dirty = 1, localRev = localRev + 1 WHERE projectId = :from") override suspend fun rekey(from: String, to: String)
}

@Dao
interface AttendanceDao : SyncDao<Attendance> {
    @Query("SELECT * FROM attendance WHERE projectId = :pid AND date = :date AND deletedAt IS NULL")
    fun observeDay(pid: String, date: String): Flow<List<Attendance>>

    @Query(
        """SELECT workerId,
           COALESCE(SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END), 0) AS present,
           COALESCE(SUM(CASE WHEN status = 'half' THEN 1 ELSE 0 END), 0) AS half,
           COALESCE(SUM(overtimeHours), 0) AS overtime
           FROM attendance WHERE projectId = :pid AND deletedAt IS NULL GROUP BY workerId""",
    )
    fun observeAgg(pid: String): Flow<List<AttendanceAgg>>

    @Query("SELECT COUNT(*) FROM attendance WHERE projectId = :pid AND date = :date AND deletedAt IS NULL AND status IN ('present', 'half')")
    fun observePresent(pid: String, date: String): Flow<Int>

    @Query("SELECT * FROM attendance WHERE projectId = :pid AND workerId = :workerId AND date = :date AND deletedAt IS NULL LIMIT 1")
    suspend fun find(pid: String, workerId: String, date: String): Attendance?

    /** After the server merges two devices' records for the same worker/day, drop the losing local copy. */
    @Query("DELETE FROM attendance WHERE workerId = :workerId AND date = :date AND id != :keepId AND dirty = 0")
    suspend fun deleteDuplicates(workerId: String, date: String, keepId: String)

    @Query("SELECT * FROM attendance WHERE id = :id") override suspend fun get(id: String): Attendance?
    @Query("SELECT * FROM attendance WHERE projectId = :projectId AND dirty = 1") override suspend fun dirty(projectId: String): List<Attendance>
    @Query("SELECT id FROM attendance WHERE projectId = :projectId AND dirty = 1") override suspend fun dirtyIds(projectId: String): List<String>
    @Query("SELECT localRev FROM attendance WHERE id = :id") override suspend fun rev(id: String): Int?
    @Query("SELECT dirty FROM attendance WHERE id = :id") override suspend fun isDirty(id: String): Boolean?
    @Query("UPDATE attendance SET dirty = 0 WHERE id = :id AND localRev = :rev") override suspend fun markClean(id: String, rev: Int)
    @Query("DELETE FROM attendance WHERE id = :id") override suspend fun hardDelete(id: String)
    @Query("DELETE FROM attendance WHERE projectId = :projectId") override suspend fun clearProject(projectId: String)
    @Query("SELECT * FROM attendance WHERE projectId = :projectId AND deletedAt IS NULL") override suspend fun allFor(projectId: String): List<Attendance>
    @Query("UPDATE attendance SET projectId = :to, dirty = 1, localRev = localRev + 1 WHERE projectId = :from") override suspend fun rekey(from: String, to: String)
}

@Dao
interface ExpenseDao : SyncDao<Expense> {
    @Query("SELECT * FROM expenses WHERE projectId = :pid AND deletedAt IS NULL ORDER BY date DESC, updatedAt DESC")
    fun observe(pid: String): Flow<List<Expense>>

    @Query("SELECT * FROM expenses WHERE projectId = :pid AND deletedAt IS NULL ORDER BY date DESC, updatedAt DESC LIMIT :limit")
    fun observeRecent(pid: String, limit: Int): Flow<List<Expense>>

    @Query("SELECT * FROM expenses WHERE vendorId = :vendorId AND deletedAt IS NULL ORDER BY date DESC")
    fun observeForVendor(vendorId: String): Flow<List<Expense>>

    @Query(
        """SELECT COALESCE(SUM(CASE WHEN status = 'paid' THEN amount END), 0) AS paid,
           COALESCE(SUM(CASE WHEN status = 'due' THEN amount END), 0) AS due,
           COALESCE(SUM(CASE WHEN status = 'due' AND dueDate < :today THEN amount END), 0) AS overdue,
           COALESCE(SUM(CASE WHEN status = 'due' AND dueDate < :today THEN 1 ELSE 0 END), 0) AS overdueCount,
           COALESCE(SUM(CASE WHEN status = 'due' AND dueDate >= :today AND dueDate <= :soon THEN amount END), 0) AS dueSoon,
           COALESCE(SUM(CASE WHEN status = 'due' AND dueDate >= :today AND dueDate <= :soon THEN 1 ELSE 0 END), 0) AS dueSoonCount,
           COALESCE(SUM(CASE WHEN status = 'paid' AND workerId IS NOT NULL THEN amount END), 0) AS labourPaid
           FROM expenses WHERE projectId = :pid AND deletedAt IS NULL""",
    )
    fun observeTotals(pid: String, today: String, soon: String): Flow<ExpenseTotals>

    @Query(
        """SELECT COALESCE(SUM(CASE WHEN status = 'paid' THEN amount END), 0) AS paid,
           COALESCE(SUM(CASE WHEN status = 'due' THEN amount END), 0) AS due,
           COALESCE(SUM(CASE WHEN status = 'due' AND dueDate < :today THEN amount END), 0) AS overdue,
           COALESCE(SUM(CASE WHEN status = 'due' AND dueDate < :today THEN 1 ELSE 0 END), 0) AS overdueCount,
           COALESCE(SUM(CASE WHEN status = 'due' AND dueDate >= :today AND dueDate <= :soon THEN amount END), 0) AS dueSoon,
           COALESCE(SUM(CASE WHEN status = 'due' AND dueDate >= :today AND dueDate <= :soon THEN 1 ELSE 0 END), 0) AS dueSoonCount,
           0.0 AS labourPaid
           FROM expenses WHERE projectId = :pid AND deletedAt IS NULL""",
    )
    suspend fun totalsNow(pid: String, today: String, soon: String): ExpenseTotals

    @Query(
        """SELECT categoryId, COALESCE(SUM(CASE WHEN status = 'paid' THEN amount END), 0) AS paid,
           COALESCE(SUM(CASE WHEN status = 'due' THEN amount END), 0) AS due
           FROM expenses WHERE projectId = :pid AND deletedAt IS NULL GROUP BY categoryId""",
    )
    fun observeByCategory(pid: String): Flow<List<CategorySum>>

    @Query(
        """SELECT substr(date, 1, 7) AS month, SUM(amount) AS amount FROM expenses
           WHERE projectId = :pid AND deletedAt IS NULL AND status = 'paid' GROUP BY month ORDER BY month""",
    )
    fun observeMonthly(pid: String): Flow<List<MonthSum>>

    @Query(
        """SELECT vendorId, COALESCE(SUM(CASE WHEN status = 'paid' THEN amount END), 0) AS paid,
           COALESCE(SUM(CASE WHEN status = 'due' THEN amount END), 0) AS due
           FROM expenses WHERE projectId = :pid AND deletedAt IS NULL AND vendorId IS NOT NULL GROUP BY vendorId""",
    )
    fun observeByVendor(pid: String): Flow<List<VendorSum>>

    @Query(
        """SELECT workerId, SUM(amount) AS paid FROM expenses
           WHERE projectId = :pid AND deletedAt IS NULL AND status = 'paid' AND workerId IS NOT NULL GROUP BY workerId""",
    )
    fun observeWorkerPaid(pid: String): Flow<List<WorkerPaid>>

    @Query("SELECT * FROM expenses WHERE id = :id") override suspend fun get(id: String): Expense?
    @Query("SELECT * FROM expenses WHERE projectId = :projectId AND dirty = 1") override suspend fun dirty(projectId: String): List<Expense>
    @Query("SELECT id FROM expenses WHERE projectId = :projectId AND dirty = 1") override suspend fun dirtyIds(projectId: String): List<String>
    @Query("SELECT localRev FROM expenses WHERE id = :id") override suspend fun rev(id: String): Int?
    @Query("SELECT dirty FROM expenses WHERE id = :id") override suspend fun isDirty(id: String): Boolean?
    @Query("UPDATE expenses SET dirty = 0 WHERE id = :id AND localRev = :rev") override suspend fun markClean(id: String, rev: Int)
    @Query("DELETE FROM expenses WHERE id = :id") override suspend fun hardDelete(id: String)
    @Query("DELETE FROM expenses WHERE projectId = :projectId") override suspend fun clearProject(projectId: String)
    @Query("SELECT * FROM expenses WHERE projectId = :projectId AND deletedAt IS NULL") override suspend fun allFor(projectId: String): List<Expense>
    @Query("UPDATE expenses SET projectId = :to, dirty = 1, localRev = localRev + 1 WHERE projectId = :from") override suspend fun rekey(from: String, to: String)
}

@Dao
interface TaskDao : SyncDao<SiteTask> {
    @Query("SELECT * FROM tasks WHERE projectId = :pid AND deletedAt IS NULL ORDER BY CASE WHEN dueDate IS NULL THEN 1 ELSE 0 END, dueDate")
    fun observe(pid: String): Flow<List<SiteTask>>

    @Query(
        """SELECT COALESCE(SUM(CASE WHEN status != 'done' THEN 1 ELSE 0 END), 0) AS open,
           COALESCE(SUM(CASE WHEN status != 'done' AND dueDate < :today THEN 1 ELSE 0 END), 0) AS flagged
           FROM tasks WHERE projectId = :pid AND deletedAt IS NULL""",
    )
    fun observeCounts(pid: String, today: String): Flow<Counts>

    @Query("SELECT * FROM tasks WHERE id = :id") override suspend fun get(id: String): SiteTask?
    @Query("SELECT * FROM tasks WHERE projectId = :projectId AND dirty = 1") override suspend fun dirty(projectId: String): List<SiteTask>
    @Query("SELECT id FROM tasks WHERE projectId = :projectId AND dirty = 1") override suspend fun dirtyIds(projectId: String): List<String>
    @Query("SELECT localRev FROM tasks WHERE id = :id") override suspend fun rev(id: String): Int?
    @Query("SELECT dirty FROM tasks WHERE id = :id") override suspend fun isDirty(id: String): Boolean?
    @Query("UPDATE tasks SET dirty = 0 WHERE id = :id AND localRev = :rev") override suspend fun markClean(id: String, rev: Int)
    @Query("DELETE FROM tasks WHERE id = :id") override suspend fun hardDelete(id: String)
    @Query("DELETE FROM tasks WHERE projectId = :projectId") override suspend fun clearProject(projectId: String)
    @Query("SELECT * FROM tasks WHERE projectId = :projectId AND deletedAt IS NULL") override suspend fun allFor(projectId: String): List<SiteTask>
    @Query("UPDATE tasks SET projectId = :to, dirty = 1, localRev = localRev + 1 WHERE projectId = :from") override suspend fun rekey(from: String, to: String)
}

@Dao
interface LogDao : SyncDao<DailyLog> {
    @Query("SELECT * FROM logs WHERE projectId = :pid AND deletedAt IS NULL ORDER BY date DESC, updatedAt DESC")
    fun observe(pid: String): Flow<List<DailyLog>>
    @Query("SELECT * FROM logs WHERE id = :id") override suspend fun get(id: String): DailyLog?
    @Query("SELECT * FROM logs WHERE projectId = :projectId AND dirty = 1") override suspend fun dirty(projectId: String): List<DailyLog>
    @Query("SELECT id FROM logs WHERE projectId = :projectId AND dirty = 1") override suspend fun dirtyIds(projectId: String): List<String>
    @Query("SELECT localRev FROM logs WHERE id = :id") override suspend fun rev(id: String): Int?
    @Query("SELECT dirty FROM logs WHERE id = :id") override suspend fun isDirty(id: String): Boolean?
    @Query("UPDATE logs SET dirty = 0 WHERE id = :id AND localRev = :rev") override suspend fun markClean(id: String, rev: Int)
    @Query("DELETE FROM logs WHERE id = :id") override suspend fun hardDelete(id: String)
    @Query("DELETE FROM logs WHERE projectId = :projectId") override suspend fun clearProject(projectId: String)
    @Query("SELECT * FROM logs WHERE projectId = :projectId AND deletedAt IS NULL") override suspend fun allFor(projectId: String): List<DailyLog>
    @Query("UPDATE logs SET projectId = :to, dirty = 1, localRev = localRev + 1 WHERE projectId = :from") override suspend fun rekey(from: String, to: String)
}

@Dao
interface FundDao : SyncDao<Fund> {
    @Query("SELECT * FROM funds WHERE projectId = :pid AND deletedAt IS NULL ORDER BY date DESC")
    fun observe(pid: String): Flow<List<Fund>>
    @Query("SELECT COALESCE(SUM(amount), 0) FROM funds WHERE projectId = :pid AND deletedAt IS NULL")
    fun observeTotal(pid: String): Flow<Double>
    @Query("SELECT * FROM funds WHERE id = :id") override suspend fun get(id: String): Fund?
    @Query("SELECT * FROM funds WHERE projectId = :projectId AND dirty = 1") override suspend fun dirty(projectId: String): List<Fund>
    @Query("SELECT id FROM funds WHERE projectId = :projectId AND dirty = 1") override suspend fun dirtyIds(projectId: String): List<String>
    @Query("SELECT localRev FROM funds WHERE id = :id") override suspend fun rev(id: String): Int?
    @Query("SELECT dirty FROM funds WHERE id = :id") override suspend fun isDirty(id: String): Boolean?
    @Query("UPDATE funds SET dirty = 0 WHERE id = :id AND localRev = :rev") override suspend fun markClean(id: String, rev: Int)
    @Query("DELETE FROM funds WHERE id = :id") override suspend fun hardDelete(id: String)
    @Query("DELETE FROM funds WHERE projectId = :projectId") override suspend fun clearProject(projectId: String)
    @Query("SELECT * FROM funds WHERE projectId = :projectId AND deletedAt IS NULL") override suspend fun allFor(projectId: String): List<Fund>
    @Query("UPDATE funds SET projectId = :to, dirty = 1, localRev = localRev + 1 WHERE projectId = :from") override suspend fun rekey(from: String, to: String)
}

@Dao
interface IssueDao : SyncDao<Issue> {
    @Query("SELECT * FROM issues WHERE projectId = :pid AND deletedAt IS NULL ORDER BY CASE WHEN status = 'resolved' THEN 1 ELSE 0 END, updatedAt DESC")
    fun observe(pid: String): Flow<List<Issue>>
    @Query(
        """SELECT COALESCE(SUM(CASE WHEN status != 'resolved' THEN 1 ELSE 0 END), 0) AS open,
           COALESCE(SUM(CASE WHEN status != 'resolved' AND severity = 'critical' THEN 1 ELSE 0 END), 0) AS flagged
           FROM issues WHERE projectId = :pid AND deletedAt IS NULL""",
    )
    fun observeCounts(pid: String): Flow<Counts>
    @Query("SELECT * FROM issues WHERE id = :id") override suspend fun get(id: String): Issue?
    @Query("SELECT * FROM issues WHERE projectId = :projectId AND dirty = 1") override suspend fun dirty(projectId: String): List<Issue>
    @Query("SELECT id FROM issues WHERE projectId = :projectId AND dirty = 1") override suspend fun dirtyIds(projectId: String): List<String>
    @Query("SELECT localRev FROM issues WHERE id = :id") override suspend fun rev(id: String): Int?
    @Query("SELECT dirty FROM issues WHERE id = :id") override suspend fun isDirty(id: String): Boolean?
    @Query("UPDATE issues SET dirty = 0 WHERE id = :id AND localRev = :rev") override suspend fun markClean(id: String, rev: Int)
    @Query("DELETE FROM issues WHERE id = :id") override suspend fun hardDelete(id: String)
    @Query("DELETE FROM issues WHERE projectId = :projectId") override suspend fun clearProject(projectId: String)
    @Query("SELECT * FROM issues WHERE projectId = :projectId AND deletedAt IS NULL") override suspend fun allFor(projectId: String): List<Issue>
    @Query("UPDATE issues SET projectId = :to, dirty = 1, localRev = localRev + 1 WHERE projectId = :from") override suspend fun rekey(from: String, to: String)
}

@Dao
interface FileDao : SyncDao<ProjectFile> {
    @Query("SELECT * FROM files WHERE projectId = :pid AND deletedAt IS NULL ORDER BY createdAt DESC")
    fun observe(pid: String): Flow<List<ProjectFile>>
    @Query("SELECT * FROM files WHERE entityId = :entityId AND deletedAt IS NULL ORDER BY createdAt")
    fun observeForEntity(entityId: String): Flow<List<ProjectFile>>
    @Query("SELECT * FROM files WHERE id = :id") override suspend fun get(id: String): ProjectFile?
    @Query("SELECT * FROM files WHERE projectId = :projectId AND dirty = 1") override suspend fun dirty(projectId: String): List<ProjectFile>
    @Query("SELECT id FROM files WHERE projectId = :projectId AND dirty = 1") override suspend fun dirtyIds(projectId: String): List<String>
    @Query("SELECT localRev FROM files WHERE id = :id") override suspend fun rev(id: String): Int?
    @Query("SELECT dirty FROM files WHERE id = :id") override suspend fun isDirty(id: String): Boolean?
    @Query("UPDATE files SET dirty = 0 WHERE id = :id AND localRev = :rev") override suspend fun markClean(id: String, rev: Int)
    @Query("DELETE FROM files WHERE id = :id") override suspend fun hardDelete(id: String)
    @Query("DELETE FROM files WHERE projectId = :projectId") override suspend fun clearProject(projectId: String)
    @Query("SELECT * FROM files WHERE projectId = :projectId AND deletedAt IS NULL") override suspend fun allFor(projectId: String): List<ProjectFile>
    @Query("UPDATE files SET projectId = :to, dirty = 1, localRev = localRev + 1 WHERE projectId = :from") override suspend fun rekey(from: String, to: String)
}
