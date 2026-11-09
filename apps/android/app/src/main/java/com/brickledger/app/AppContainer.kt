package com.brickledger.app

import android.app.Application
import com.brickledger.app.data.AppUpdates
import com.brickledger.app.data.BackupInbox
import com.brickledger.app.data.LocalReports
import com.brickledger.app.data.Repository
import com.brickledger.app.data.SessionStore
import com.brickledger.app.data.SyncEngine
import com.brickledger.app.data.SyncManager
import com.brickledger.app.data.SyncRegistry
import com.brickledger.app.data.local.AppDatabase
import com.brickledger.app.data.remote.Network
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/** Manual dependency injection: one instance of each service for the whole app. */
class AppContainer(app: Application) {
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val session = SessionStore(app)
    val db: AppDatabase = AppDatabase.build(app)
    // A rejected refresh token ends the cloud session but keeps every record on the phone.
    val okHttp = Network.okHttp(session) { appScope.launch { session.expireSession() } }
    val api = Network.api(okHttp)
    val registry = SyncRegistry(db)
    val syncEngine = SyncEngine(db, api, registry)
    val sync = SyncManager(app, syncEngine, appScope)
    val repo: Repository by lazy { Repository(app, db, api, session, registry, sync, syncEngine, okHttp) }
    val reports: LocalReports by lazy { LocalReports(app, repo) }
    val backupInbox: BackupInbox by lazy { BackupInbox(repo, session) }
    val updates: AppUpdates by lazy { AppUpdates(app, session, okHttp, appScope) }
}
