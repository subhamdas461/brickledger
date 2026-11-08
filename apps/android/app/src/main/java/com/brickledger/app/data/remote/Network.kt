package com.brickledger.app.data.remote

import com.brickledger.app.BuildConfig
import com.brickledger.app.core.AppJson
import com.brickledger.app.data.SessionStore
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import okhttp3.Authenticator
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.Route
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.HttpException
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

private val JSON = "application/json".toMediaType()

/** Points every request at the server chosen in settings (lets one build talk to any deployment). */
class HostInterceptor(private val session: SessionStore) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val req = chain.request()
        val base = session.baseUrl.toHttpUrlOrNull() ?: return chain.proceed(req)
        val url = req.url.newBuilder().scheme(base.scheme).host(base.host).port(base.port).build()
        return chain.proceed(req.newBuilder().url(url).build())
    }
}

class AuthInterceptor(private val session: SessionStore) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val req = chain.request()
        val token = session.accessToken
        if (token == null || req.header("Authorization") != null || req.url.encodedPath.contains("/auth/")) return chain.proceed(req)
        return chain.proceed(req.newBuilder().header("Authorization", "Bearer $token").build())
    }
}

/**
 * On 401, refreshes the access token once (single-flight across threads) and retries.
 * Rotated refresh tokens are persisted; a rejected refresh signs the user out.
 */
class TokenAuthenticator(
    private val session: SessionStore,
    private val refreshClient: OkHttpClient,
    private val onSignedOut: () -> Unit,
) : Authenticator {
    private val lock = Any()

    override fun authenticate(route: Route?, response: Response): Request? {
        if (response.request.url.encodedPath.contains("/auth/")) return null
        if (response.priorResponse != null) return null
        synchronized(lock) {
            val sent = response.request.header("Authorization")?.removePrefix("Bearer ")
            val current = session.accessToken
            if (current != null && current != sent) {
                return response.request.newBuilder().header("Authorization", "Bearer $current").build()
            }
            val refresh = session.refreshToken ?: return null
            val base = session.baseUrl.toHttpUrlOrNull() ?: return null
            val call = Request.Builder()
                .url(base.newBuilder().addPathSegments("api/v1/auth/refresh").build())
                .post(AppJson.encodeToString(RefreshRequest.serializer(), RefreshRequest(refresh)).toRequestBody(JSON))
                .build()
            val result = try {
                refreshClient.newCall(call).execute()
            } catch (e: IOException) {
                return null // offline: keep the session, fail this request
            }
            result.use { res ->
                if (!res.isSuccessful) {
                    if (res.code == 401) onSignedOut()
                    return null
                }
                val auth = AppJson.decodeFromString(AuthResponse.serializer(), res.body?.string().orEmpty())
                runBlocking { session.saveAuth(auth) }
                return response.request.newBuilder().header("Authorization", "Bearer ${auth.accessToken}").build()
            }
        }
    }
}

object Network {
    fun okHttp(session: SessionStore, onSignedOut: () -> Unit): OkHttpClient {
        val logging = HttpLoggingInterceptor().apply {
            level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BASIC else HttpLoggingInterceptor.Level.NONE
        }
        val refreshClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build()
        return OkHttpClient.Builder()
            .addInterceptor(HostInterceptor(session))
            .addInterceptor(AuthInterceptor(session))
            .addInterceptor(logging)
            .authenticator(TokenAuthenticator(session, refreshClient, onSignedOut))
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .build()
    }

    fun api(client: OkHttpClient): ApiService =
        Retrofit.Builder()
            // Placeholder: HostInterceptor rewrites scheme/host/port per request.
            .baseUrl("http://localhost/")
            .client(client)
            .addConverterFactory(AppJson.asConverterFactory(JSON))
            .build()
            .create(ApiService::class.java)
}

/** Converts network/HTTP failures into a message a site user can act on. */
fun Throwable.userMessage(): String = when (this) {
    is HttpException -> {
        val body = runCatching { response()?.errorBody()?.string() }.getOrNull()
        body?.let { runCatching { AppJson.decodeFromString(ApiErrorBody.serializer(), it).error.message }.getOrNull() }
            ?: "Server error (${code()})."
    }
    is IOException -> "Can’t reach the server. Check your connection and try again."
    else -> message ?: "Something went wrong."
}

val Throwable.httpCode: Int? get() = (this as? HttpException)?.code()
