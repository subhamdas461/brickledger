# BrickLedger REST API

Base path: `/api/v1`. JSON in and out. Authenticated routes need `Authorization: Bearer <accessToken>`.
Errors always look like:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "amount: Must be greater than 0", "details": { "issues": [...] } } }
```

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Input failed validation (`details.issues[]` has `path` + `message`) |
| `UNAUTHORIZED` | 401 | Missing/expired access token - refresh and retry |
| `FORBIDDEN` | 403 | Your project role doesn't allow this |
| `NOT_FOUND` | 404 | Doesn't exist, or you can't see it |
| `CONFLICT` | 409 | Duplicate (e.g. email already registered) |
| `PLAN_LIMIT` | 402 | The workspace plan doesn't include this (upgrade) |
| `RATE_LIMITED` | 429 | Slow down |

## Auth

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/register` | `{ name, email, password, company?, inviteToken? }` → tokens + profile. Creates a workspace with a 14-day Pro trial |
| POST | `/auth/login` | `{ email, password }` |
| POST | `/auth/refresh` | `{ refreshToken }` (mobile) or the `bl_rt` httpOnly cookie (web). Rotates the refresh token; replaying an old one revokes the session family |
| POST | `/auth/logout` | `{ refreshToken? }` |
| POST | `/auth/forgot-password` | `{ email }` - always 200 |
| POST | `/auth/reset-password` | `{ token, password }` - signs out other sessions |

## Account & workspace

| Method | Path | Notes |
|---|---|---|
| GET/PATCH | `/me` | Profile + workspaces with effective plan |
| POST | `/me/password` | `{ currentPassword, newPassword }` → new tokens |
| DELETE | `/me` | `{ password }` - deletes the account and owned workspaces |
| GET/PATCH | `/orgs/:orgId` | Plan, usage, limits, features |
| GET | `/orgs/:orgId/members` | Owners/admins only |
| PATCH/DELETE | `/orgs/:orgId/members/:userId` | Change role (`admin`/`member`) / remove |
| GET | `/billing/plans` | Public plan catalogue |
| POST | `/orgs/:orgId/billing/checkout` | `{ plan: pro|business, interval: month|year }` → `{ url }` to redirect to |
| POST | `/orgs/:orgId/billing/portal` | Stripe customer portal URL |
| POST | `/orgs/:orgId/billing/cancel` | Cancel at period end |
| POST | `/billing/webhooks/stripe` · `/billing/webhooks/razorpay` | Signature-verified, idempotent |

## Projects

| Method | Path | Notes |
|---|---|---|
| GET | `/projects` | All projects you can access, with spend/progress stats |
| POST | `/projects` | `{ name, totalBudget, currency, startDate, targetEndDate, useTemplates, ... }` - seeds 14 budget heads, 14 phases and common materials |
| POST | `/projects/demo` | Realistic sample project (doesn't count toward plan limits) |
| GET/PATCH/DELETE | `/projects/:id` | PATCH: managers. DELETE: workspace owners/admins |
| GET | `/projects/:id/dashboard?today=yyyy-mm-dd` | Totals, categories, monthly spend, phases, alerts, counts |
| GET | `/projects/:id/report` | Full report JSON (vendors, stock, labour, payment modes, funds) |
| GET | `/projects/:id/report.pdf` | PDF (Pro/Business) |
| GET | `/projects/:id/export/:key.csv` | `expenses, budget, vendors, materials, stock, labour, attendance, funds, tasks, issues, logs` |
| GET | `/projects/:id/activity?before=&limit=` | Audit trail |
| GET | `/projects/:id/members` | Members (+ pending invites for managers) |
| POST | `/projects/:id/invites` | `{ email, role }` → `{ invite, inviteUrl }` (shareable link) |
| PATCH/DELETE | `/projects/:id/members/:userId` | Change role / remove |
| GET · POST | `/invites/:token` · `/invites/:token/accept` | Preview (public) · accept (signed in) |

## Tracked resources

Every resource supports the same five routes:

```
GET    /projects/:id/<resource>?q=&from=&to=&limit=&offset=&<filters>   → { items, total, sum }
GET    /projects/:id/<resource>/:rid
POST   /projects/:id/<resource>              (client may supply its own UUID `id`)
PATCH  /projects/:id/<resource>/:rid         (partial update)
DELETE /projects/:id/<resource>/:rid         (soft delete → sync tombstone)
```

| Resource | Filters | Notes |
|---|---|---|
| `categories` | - | Budget heads (`plannedAmount`). Write: managers |
| `phases` | `status` | Schedule; progress/status/actual dates are kept consistent |
| `vendors` | `type` | `contractAmount` drives "balance to pay" |
| `materials` | `category` | `minStock` drives low-stock alerts |
| `movements` | `materialId, type, vendorId` | Stock in/out; `expenseId` links a purchase |
| `workers` | `trade, active, vendorId` | `dailyWage` |
| `attendance` | `workerId, date, status` | One record per worker per day (merged automatically) |
| `expenses` | `categoryId, vendorId, phaseId, workerId, status, paymentMode` | `status: paid|due`, `dueDate` |
| `tasks` | `status, priority, phaseId` | `completedAt` set automatically |
| `logs` | date range | Site diary |
| `funds` | `source` | Money in (savings, loans, family, client) |
| `issues` | `status, severity, phaseId` | `resolvedAt` set automatically |
| `files` | `category, entityType, entityId` | Create via upload (below); responses include a signed `url` |

Bulk attendance: `POST /projects/:id/attendance/bulk { date, entries: [{ workerId, status, overtimeHours }] }`.

Uploads: `POST /projects/:id/files` as `multipart/form-data` with `file` and optional `id, name, category, entityType, entityId, expiresOn, notes`. Images, PDFs, Office files and drawings up to `MAX_UPLOAD_MB`. File bytes: `GET /files/:fileId/content` with a bearer token or the signed URL.

## Offline sync (used by the Android app)

```
GET  /projects/:id/sync?since=<cursor>&limit=500
  → { cursor, hasMore, project, changes: { expenses: [...], vendors: [...], ... } }   (rows with deletedAt are tombstones)

POST /projects/:id/sync
  { mutations: [{ entity: "expenses", op: "upsert" | "delete", id: "<uuid>", data: {...} }] }
  → { results: [{ id, entity, status: "ok" | "error", canonicalId?, error?, retryable? }] }
```

- Every write takes a value from a global sequence (`server_seq`), so `since` gives a total order of changes.
- Mutations are applied in dependency order and are idempotent (client UUIDs). Last write received wins; a record deleted on the server stays deleted.
- `canonicalId` means the server merged the record into an existing one (two phones marking the same worker on the same day).
- `retryable: false` means the change can never succeed (validation/permission) - drop it and re-pull.

## Public analytics

No sign-in. Rate limited. Used by the website and the Android app; see the README's "Admin panel" section for what is and isn't stored.

| Method | Path | Body / query |
|---|---|---|
| POST | `/public/track` | `{ type: "view", path, referrer? }` or `{ type: "engaged", seconds }`. Replies 204 |
| POST | `/public/app-ping` | `{ installId, versionName, versionCode }`. Replies 204 |
| GET | `/public/download/android` | `?source=web\|update&v=1.0.3`. Counts it, then redirects to `/apk/brickledger.apk` |

## Admin

Needs a super admin's token (`npm run admin -- grant <email>`); anyone else gets 404. Every change is written to the audit log.

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/overview` | Totals and 30-day series |
| GET | `/admin/engagement` | `?days=7\|30\|90` |
| GET | `/admin/app-stats` | Downloads, installs, versions |
| GET | `/admin/users` | `?q=&status=all\|active\|banned\|admin&sort=newest\|lastSeen\|name&limit=&offset=` |
| GET | `/admin/users/export.csv` | Same filters |
| GET, PATCH | `/admin/users/:id` | PATCH `{ name?, email? }` |
| POST | `/admin/users/:id/ban` | `{ reason }`. Not for yourself or another super admin |
| POST | `/admin/users/:id/unban` | |
| POST | `/admin/users/:id/sign-out` | Ends every session |
| POST | `/admin/users/:id/reset-link` | Returns a one-hour link |
| DELETE | `/admin/users/:id` | `{ confirmEmail }`. Not for yourself or another super admin |
| GET | `/admin/workspaces` | `?q=&plan=all\|free\|pro\|business&limit=&offset=` |
| PATCH | `/admin/workspaces/:id/plan` | `{ plan }`. Not for workspaces with a paid subscription |
| POST | `/admin/workspaces/:id/extend-trial` | `{ days }` |
| GET | `/admin/audit` | `?q=&limit=&offset=` |
| GET | `/admin/system` | Status of database, storage, email and payments |
