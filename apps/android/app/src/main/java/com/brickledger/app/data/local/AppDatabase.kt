package com.brickledger.app.data.local

import android.content.Context
import androidx.room.AutoMigration
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [
        ProjectEntity::class, SyncStateEntity::class, PendingUpload::class,
        Category::class, Phase::class, Vendor::class, Material::class, Movement::class, Worker::class,
        Attendance::class, Expense::class, SiteTask::class, DailyLog::class, Fund::class, Issue::class, ProjectFile::class,
    ],
    version = 2,
    exportSchema = true,
    // v2: projects.isLocal (offline mode). Auto-migrations keep data on app updates.
    autoMigrations = [AutoMigration(from = 1, to = 2)],
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun projects(): ProjectDao
    abstract fun syncState(): SyncStateDao
    abstract fun uploads(): UploadDao
    abstract fun pending(): PendingDao
    abstract fun categories(): CategoryDao
    abstract fun phases(): PhaseDao
    abstract fun vendors(): VendorDao
    abstract fun materials(): MaterialDao
    abstract fun movements(): MovementDao
    abstract fun workers(): WorkerDao
    abstract fun attendance(): AttendanceDao
    abstract fun expenses(): ExpenseDao
    abstract fun tasks(): TaskDao
    abstract fun logs(): LogDao
    abstract fun funds(): FundDao
    abstract fun issues(): IssueDao
    abstract fun files(): FileDao

    companion object {
        fun build(context: Context): AppDatabase =
            // No destructive fallback: offline-mode projects exist only on this phone, so every schema
            // change must ship a migration (Room fails loudly in testing if one is missing).
            Room.databaseBuilder(context, AppDatabase::class.java, "brickledger.db").build()
    }
}
