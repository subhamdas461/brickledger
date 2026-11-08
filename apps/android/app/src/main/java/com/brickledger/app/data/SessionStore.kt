package com.brickledger.app.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStoreFile
import com.brickledger.app.BuildConfig
import com.brickledger.app.core.AppJson
import com.brickledger.app.data.remote.AuthResponse
import com.brickledger.app.data.remote.MeResponse
import com.brickledger.app.data.remote.OrgSummaryDto
import com.brickledger.app.data.remote.UserDto
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.serialization.Serializable

/** AES-256-GCM with a non-exportable Android Keystore key. Tokens never hit disk in plain text. */
class TokenCipher {
    private val alias = "brickledger_session"

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        return Base64.encodeToString(cipher.iv + cipher.doFinal(plain.toByteArray()), Base64.NO_WRAP)
    }

    fun decrypt(encoded: String): String? = runCatching {
        val all = Base64.decode(encoded, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, all, 0, 12))
        String(cipher.doFinal(all, 12, all.size - 12))
    }.getOrNull()
}

@Serializable
data class Profile(val user: UserDto, val orgs: List<OrgSummaryDto>)

/**
 * Session + app preferences. Tokens are cached in memory (for OkHttp threads) and
 * persisted encrypted in DataStore.
 */
class SessionStore(context: Context) {
    private val store = PreferenceDataStoreFactory.create { context.preferencesDataStoreFile("session") }
    private val cipher = TokenCipher()

    private object Keys {
        val access = stringPreferencesKey("access")
        val refresh = stringPreferencesKey("refresh")
        val profile = stringPreferencesKey("profile")
        val baseUrl = stringPreferencesKey("base_url")
        val theme = stringPreferencesKey("theme")
        val lastProject = stringPreferencesKey("last_project")
        val pendingInvite = stringPreferencesKey("pending_invite")
        val offlineMode = stringPreferencesKey("offline_mode")
        val localName = stringPreferencesKey("local_name")
        val lastUserId = stringPreferencesKey("last_user_id")
    }

    @Volatile var accessToken: String? = null
        private set
    @Volatile var refreshToken: String? = null
        private set
    @Volatile var baseUrl: String = BuildConfig.DEFAULT_API_URL
        private set

    private val _profile = MutableStateFlow<Profile?>(null)
    val profile: StateFlow<Profile?> = _profile.asStateFlow()

    private val _theme = MutableStateFlow("system")
    val theme: StateFlow<String> = _theme.asStateFlow()

    private val _loaded = MutableStateFlow(false)
    val loaded: StateFlow<Boolean> = _loaded.asStateFlow()

    var lastProjectId: String? = null
        private set
    var pendingInvite: String? = null
        private set

    /** Offline mode: the app is used on this phone without a cloud account (can be combined with one later). */
    private val _offlineMode = MutableStateFlow(false)
    val offlineMode: StateFlow<Boolean> = _offlineMode.asStateFlow()
    var localName: String = ""
        private set
    /** Cloud user whose data is cached on this phone (protects it if someone else signs in). */
    var lastUserId: String? = null
        private set

    val isLoggedIn: Boolean get() = refreshToken != null && _profile.value != null

    /** Signed in to the cloud, or using offline mode - either way the app is usable. */
    val isActive: Boolean get() = isLoggedIn || _offlineMode.value

    val displayName: String get() = _profile.value?.user?.name ?: localName

    suspend fun load() {
        val prefs = store.data.first()
        accessToken = prefs[Keys.access]?.let(cipher::decrypt)
        refreshToken = prefs[Keys.refresh]?.let(cipher::decrypt)
        baseUrl = prefs[Keys.baseUrl] ?: BuildConfig.DEFAULT_API_URL
        _theme.value = prefs[Keys.theme] ?: "system"
        lastProjectId = prefs[Keys.lastProject]
        pendingInvite = prefs[Keys.pendingInvite]
        _offlineMode.value = prefs[Keys.offlineMode] == "true"
        localName = prefs[Keys.localName].orEmpty()
        lastUserId = prefs[Keys.lastUserId]
        _profile.value = if (refreshToken != null) prefs[Keys.profile]?.let { runCatching { AppJson.decodeFromString(Profile.serializer(), it) }.getOrNull() } else null
        _loaded.value = true
    }

    suspend fun saveAuth(auth: AuthResponse) {
        accessToken = auth.accessToken
        refreshToken = auth.refreshToken
        val profile = Profile(auth.user, auth.orgs)
        _profile.value = profile
        lastUserId = auth.user.id
        store.edit {
            it[Keys.access] = cipher.encrypt(auth.accessToken)
            it[Keys.refresh] = cipher.encrypt(auth.refreshToken)
            it[Keys.profile] = AppJson.encodeToString(Profile.serializer(), profile)
            it[Keys.lastUserId] = auth.user.id
        }
    }

    suspend fun enterOfflineMode(name: String) {
        _offlineMode.value = true
        localName = name.trim()
        store.edit {
            it[Keys.offlineMode] = "true"
            it[Keys.localName] = name.trim()
        }
    }

    /**
     * The cloud session ended (refresh token revoked or expired). Tokens are dropped but cached
     * data is kept, so nothing typed offline is lost - it syncs after the same user signs in again.
     */
    suspend fun expireSession() {
        accessToken = null
        refreshToken = null
        _profile.value = null
        store.edit {
            it.remove(Keys.access)
            it.remove(Keys.refresh)
            it.remove(Keys.profile)
        }
    }

    suspend fun saveProfile(me: MeResponse) {
        val profile = Profile(me.user, me.orgs)
        _profile.value = profile
        store.edit { it[Keys.profile] = AppJson.encodeToString(Profile.serializer(), profile) }
    }

    /** Full cloud sign-out (offline-mode settings and local projects are kept). */
    suspend fun clear() {
        accessToken = null
        refreshToken = null
        _profile.value = null
        lastProjectId = null
        lastUserId = null
        store.edit {
            it.remove(Keys.access)
            it.remove(Keys.refresh)
            it.remove(Keys.profile)
            it.remove(Keys.lastProject)
            it.remove(Keys.lastUserId)
        }
    }

    suspend fun setBaseUrl(url: String) {
        val normalized = url.trim().let { if (it.endsWith("/")) it else "$it/" }
        baseUrl = normalized
        store.edit { it[Keys.baseUrl] = normalized }
    }

    suspend fun setTheme(value: String) {
        _theme.value = value
        store.edit { it[Keys.theme] = value }
    }

    suspend fun setLastProject(id: String?) {
        lastProjectId = id
        store.edit { if (id == null) it.remove(Keys.lastProject) else it[Keys.lastProject] = id }
    }

    suspend fun setPendingInvite(token: String?) {
        pendingInvite = token
        store.edit { if (token == null) it.remove(Keys.pendingInvite) else it[Keys.pendingInvite] = token }
    }
}
