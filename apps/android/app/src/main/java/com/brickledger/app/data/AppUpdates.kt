package com.brickledger.app.data

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.FileProvider
import com.brickledger.app.BuildConfig
import com.brickledger.app.core.AppJson
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import okhttp3.Authenticator
import okhttp3.CacheControl
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request

/** The site's `/apk/android.json`, written by `npm run release:android`. */
@Serializable
data class AndroidRelease(
    val versionName: String,
    val versionCode: Int,
    val size: Long = 0,
    val sha256: String = "",
    val url: String = "/apk/brickledger.apk",
    val notes: String? = null,
)

/**
 * In-app updates for the APK published on the website: compares the site's latest release with this
 * build, downloads it on request (verifying its checksum) and hands it to Android's installer. Android
 * itself refuses an update that isn't signed with the same key or has a lower version.
 *
 * Checks fail silently: an offline phone simply isn't told about updates.
 */
class AppUpdates(
    private val context: Context,
    private val session: SessionStore,
    baseClient: OkHttpClient,
    private val scope: CoroutineScope,
) {
    sealed interface State {
        data object None : State
        /** [prompt]: ask now. False once the user chose "Later" (Settings still offers the update). */
        data class Available(val release: AndroidRelease, val prompt: Boolean) : State
        data class Downloading(val release: AndroidRelease, val progress: Float?) : State
        data class Ready(val release: AndroidRelease, val file: File) : State
        data class Failed(val release: AndroidRelease, val message: String) : State
    }

    enum class CheckResult { UpToDate, UpdateAvailable, Failed }

    private val _state = MutableStateFlow<State>(State.None)
    val state: StateFlow<State> = _state.asStateFlow()

    // Plain client: no account token on these requests, and always the latest manifest.
    private val client = baseClient.newBuilder()
        .apply {
            interceptors().clear()
            networkInterceptors().clear()
        }
        .authenticator(Authenticator.NONE)
        .build()

    private var lastCheck = 0L
    private var download: Job? = null

    private val updatesDir get() = File(context.cacheDir, "updates")
    private val site: HttpUrl get() = session.baseUrl.toHttpUrl()
    val downloadPageUrl: String get() = site.resolve("download")?.toString() ?: session.baseUrl

    /** Called whenever the app comes to the foreground; checks at most every few hours. */
    fun checkIfDue() {
        if (System.currentTimeMillis() - lastCheck < CHECK_INTERVAL_MS) return
        lastCheck = System.currentTimeMillis()
        scope.launch {
            session.loaded.first { it } // the server address is read from saved settings
            check(manual = false)
        }
    }

    suspend fun check(manual: Boolean): CheckResult {
        lastCheck = System.currentTimeMillis()
        val busy = _state.value is State.Downloading || _state.value is State.Ready
        val release = runCatching { fetchLatest() }
            .onFailure { Log.i("AppUpdates", "Update check failed", it) } // expected when offline
            .getOrNull() ?: return CheckResult.Failed
        if (release.versionCode <= BuildConfig.VERSION_CODE) {
            // Up to date (also straight after installing an update): drop any leftover download.
            withContext(Dispatchers.IO) { updatesDir.deleteRecursively() }
            _state.value = State.None
            return CheckResult.UpToDate
        }
        if (!busy) _state.value = State.Available(release, prompt = manual || !isSnoozed(release))
        return CheckResult.UpdateAvailable
    }

    /** "Later": stop asking about this version for a day; a newer version asks straight away. */
    fun later() {
        val release = currentRelease() ?: return
        download?.cancel()
        _state.value = State.Available(release, prompt = false) // also set by the download when it stops
        scope.launch { session.snoozeUpdate(release.versionCode, System.currentTimeMillis() + SNOOZE_MS) }
    }

    fun startDownload() {
        val release = currentRelease() ?: return
        if (_state.value is State.Downloading) return
        _state.value = State.Downloading(release, 0f)
        download = scope.launch(Dispatchers.IO) {
            try {
                val file = fetchApk(release)
                _state.value = State.Ready(release, file)
                install()
            } catch (e: CancellationException) {
                updatesDir.deleteRecursively()
                _state.value = State.Available(release, prompt = false)
                throw e
            } catch (e: IOException) {
                _state.value = State.Failed(release, "The download didn’t finish. Check your connection and try again.")
            } catch (e: Exception) {
                _state.value = State.Failed(release, e.message ?: "The update couldn’t be downloaded.")
            }
        }
    }

    /** Opens Android's installer. It asks once for permission to install from this app, then for confirmation. */
    fun install() {
        val ready = _state.value as? State.Ready ?: return
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", ready.file)
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            _state.value = State.Failed(ready.release, "This phone can’t open the installer. Download the update from the website instead.")
        }
    }

    private fun currentRelease(): AndroidRelease? = when (val s = _state.value) {
        is State.Available -> s.release
        is State.Downloading -> s.release
        is State.Ready -> s.release
        is State.Failed -> s.release
        State.None -> null
    }

    private fun isSnoozed(release: AndroidRelease): Boolean {
        val (version, until) = session.updateSnooze ?: return false
        return version == release.versionCode && System.currentTimeMillis() < until
    }

    private suspend fun fetchLatest(): AndroidRelease = withContext(Dispatchers.IO) {
        val request = Request.Builder().url(site.resolve("apk/android.json")!!).cacheControl(CacheControl.FORCE_NETWORK).build()
        client.newCall(request).execute().use { res ->
            if (!res.isSuccessful) throw IOException("HTTP ${res.code}")
            AppJson.decodeFromString(AndroidRelease.serializer(), res.body?.string().orEmpty())
        }
    }

    private suspend fun fetchApk(release: AndroidRelease): File = withContext(Dispatchers.IO) {
        val dir = updatesDir.apply {
            deleteRecursively()
            mkdirs()
        }
        val file = File(dir, "BrickLedger-${release.versionName}.apk")
        val digest = MessageDigest.getInstance("SHA-256")
        val request = Request.Builder().url(site.resolve(release.url)!!).cacheControl(CacheControl.FORCE_NETWORK).build()
        client.newCall(request).execute().use { res ->
            if (!res.isSuccessful) throw IOException("HTTP ${res.code}")
            val body = res.body ?: throw IOException("Empty response")
            val total = body.contentLength().takeIf { it > 0 } ?: release.size
            var done = 0L
            var shownPercent = -1
            body.byteStream().use { input ->
                file.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        ensureActive() // "Cancel" stops the download
                        val read = input.read(buffer)
                        if (read < 0) break
                        output.write(buffer, 0, read)
                        digest.update(buffer, 0, read)
                        done += read
                        if (total > 0) {
                            val percent = (done * 100 / total).toInt().coerceAtMost(100)
                            if (percent != shownPercent) {
                                shownPercent = percent
                                _state.value = State.Downloading(release, percent / 100f)
                            }
                        }
                    }
                }
            }
        }
        val actual = digest.digest().joinToString("") { "%02x".format(it) }
        if (release.sha256.isNotBlank() && !actual.equals(release.sha256, ignoreCase = true)) {
            file.delete()
            throw IllegalStateException("The downloaded file was damaged. Please try again.")
        }
        file
    }

    private companion object {
        const val CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000L
        const val SNOOZE_MS = 24 * 60 * 60 * 1000L
    }
}
