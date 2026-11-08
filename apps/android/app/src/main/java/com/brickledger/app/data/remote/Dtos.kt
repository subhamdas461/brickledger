package com.brickledger.app.data.remote

import com.brickledger.app.data.local.ProjectEntity
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable
data class UserDto(val id: String, val email: String, val name: String, val phone: String? = null)

@Serializable
data class OrgSummaryDto(
    val id: String,
    val name: String,
    val role: String,
    val plan: String = "free",
    val planStatus: String = "active",
    val trialEndsAt: String? = null,
)

@Serializable
data class AuthResponse(
    val user: UserDto,
    val orgs: List<OrgSummaryDto> = emptyList(),
    val accessToken: String,
    val refreshToken: String,
    val expiresIn: Int = 900,
)

@Serializable
data class MeResponse(val user: UserDto, val orgs: List<OrgSummaryDto> = emptyList())

@Serializable data class LoginRequest(val email: String, val password: String)
@Serializable data class RegisterRequest(val name: String, val email: String, val password: String, val company: String? = null, val inviteToken: String? = null)
@Serializable data class EmailRequest(val email: String)
@Serializable data class RefreshRequest(val refreshToken: String)
@Serializable data class OkResponse(val ok: Boolean = true)
@Serializable class EmptyBody

@Serializable
data class CreateProjectRequest(
    val name: String,
    val address: String? = null,
    val city: String? = null,
    val status: String = "in_progress",
    val currency: String = "INR",
    val totalBudget: Double = 0.0,
    val builtUpArea: Double? = null,
    val areaUnit: String = "sqft",
    val floors: Int? = null,
    val startDate: String? = null,
    val targetEndDate: String? = null,
    val useTemplates: Boolean = true,
)

// ------------------------------------------------------------------ sync

@Serializable
data class SyncPullResponse(
    val cursor: Long,
    val hasMore: Boolean,
    val project: ProjectEntity,
    val changes: JsonObject = JsonObject(emptyMap()),
)

@Serializable
data class MutationDto(val entity: String, val op: String, val id: String, val data: JsonObject? = null)

@Serializable
data class SyncPushRequest(val mutations: List<MutationDto>)

@Serializable
data class PushResult(
    val id: String,
    val entity: String,
    val status: String,
    val canonicalId: String? = null,
    val error: String? = null,
    val retryable: Boolean? = null,
)

@Serializable
data class SyncPushResponse(val results: List<PushResult>)

// ------------------------------------------------------------------ team & activity

@Serializable
data class MemberDto(val userId: String, val name: String, val email: String, val role: String, val viaWorkspace: Boolean = false)

@Serializable
data class InviteDto(val id: String, val email: String, val role: String, val expiresAt: String)

@Serializable
data class MembersResponse(val members: List<MemberDto> = emptyList(), val invites: List<InviteDto> = emptyList())

@Serializable data class InviteRequest(val email: String, val role: String)
@Serializable data class InviteResponse(val inviteUrl: String)
@Serializable data class AcceptInviteResponse(val ok: Boolean = true, val projectId: String? = null)

@Serializable
data class ActivityUser(val id: String, val name: String)

@Serializable
data class ActivityDto(
    val id: Long,
    val action: String,
    val entityType: String,
    val summary: String,
    val createdAt: String,
    val user: ActivityUser? = null,
)

@Serializable
data class ApiErrorDto(val code: String = "INTERNAL", val message: String = "Something went wrong.")

@Serializable
data class ApiErrorBody(val error: ApiErrorDto = ApiErrorDto())
