package com.brickledger.app.data.remote

import com.brickledger.app.data.local.ProjectEntity
import com.brickledger.app.data.local.ProjectFile
import kotlinx.serialization.json.JsonObject
import okhttp3.MultipartBody
import okhttp3.ResponseBody
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Part
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Streaming

/** BrickLedger REST API (see apps/api). Host is applied per request by [HostInterceptor]. */
interface ApiService {
    @POST("api/v1/auth/login") suspend fun login(@Body body: LoginRequest): AuthResponse
    @POST("api/v1/auth/register") suspend fun register(@Body body: RegisterRequest): AuthResponse
    @POST("api/v1/auth/forgot-password") suspend fun forgotPassword(@Body body: EmailRequest): OkResponse
    @POST("api/v1/auth/logout") suspend fun logout(@Body body: RefreshRequest): OkResponse

    @GET("api/v1/me") suspend fun me(): MeResponse

    @GET("api/v1/projects") suspend fun projects(): List<ProjectEntity>
    @POST("api/v1/projects") suspend fun createProject(@Body body: CreateProjectRequest): ProjectEntity
    @POST("api/v1/projects/demo") suspend fun createDemo(@Body body: EmptyBody = EmptyBody()): ProjectEntity
    @PATCH("api/v1/projects/{id}") suspend fun updateProject(@Path("id") id: String, @Body body: JsonObject): ProjectEntity

    @GET("api/v1/projects/{id}/sync")
    suspend fun pull(@Path("id") projectId: String, @Query("since") since: Long, @Query("limit") limit: Int = 500): SyncPullResponse

    @POST("api/v1/projects/{id}/sync")
    suspend fun push(@Path("id") projectId: String, @Body body: SyncPushRequest): SyncPushResponse

    @Multipart
    @POST("api/v1/projects/{id}/files")
    suspend fun upload(@Path("id") projectId: String, @Part parts: List<MultipartBody.Part>): ProjectFile

    @GET("api/v1/projects/{id}/members") suspend fun members(@Path("id") projectId: String): MembersResponse
    @POST("api/v1/projects/{id}/invites") suspend fun invite(@Path("id") projectId: String, @Body body: InviteRequest): InviteResponse
    @POST("api/v1/invites/{token}/accept") suspend fun acceptInvite(@Path("token") token: String, @Body body: EmptyBody = EmptyBody()): AcceptInviteResponse

    @GET("api/v1/projects/{id}/activity")
    suspend fun activity(@Path("id") projectId: String, @Query("limit") limit: Int = 100): List<ActivityDto>

    @Streaming @GET("api/v1/projects/{id}/report.pdf")
    suspend fun reportPdf(@Path("id") projectId: String, @Query("today") today: String): ResponseBody

    @Streaming @GET("api/v1/projects/{id}/export/{key}")
    suspend fun export(@Path("id") projectId: String, @Path("key") key: String): ResponseBody
}
