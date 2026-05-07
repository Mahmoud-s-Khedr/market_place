# Admin Dashboard API/UI Gap Matrix (PM-Aligned V1)

Date: 2026-05-07  
Scope: PM-approved V1 only. In scope: User Management, Banned Users, Reports, Personal Account. Out of scope: Overview stats, Reviews/Ratings, Warnings workflow.

## 1) PM Scope Lock (V1)

- In scope:
  - Users list + user details
  - Ban / Unban only
  - User ads view-only (no delete/moderation)
  - User-specific reports view
  - All reports page (read-only)
  - Banned users page (Unban only)
  - Personal information/account settings
- Out of scope:
  - Overview KPIs/charts/cards
  - Reviews & ratings pages
  - Report status/type/workflow actions
  - Warnings section/actions

## 2) Screen Coverage Matrix

| UI Screen | UI Action / Data Need | Expected API Contract | Existing Endpoint | Status | Gap Details | Backend Change Needed | Priority |
|---|---|---|---|---|---|---|---|
| Login | Admin sign-in | `POST /auth/login` | `POST /auth/login` | Supported | Works for admin auth | None | P2 |
| Overview page | No statistics in V1 | N/A (section removed) | N/A | Out of Scope | PM removed dashboard stats entirely | Remove/hide overview stats UI in admin app | P0 |
| Users list | List users | `GET /admin/users` | `GET /admin/users?status&q&limit&offset` | Supported | Core listing exists | None | P2 |
| Users list | Ban user | `PATCH /admin/users/:id/status` with `banned` | `PATCH /admin/users/:id/status` | Supported | Exists | None | P2 |
| Users list | Unban user | `PATCH /admin/users/:id/status` with `active` | `PATCH /admin/users/:id/status` | Supported | Exists | None | P2 |
| Users list | Only Ban/Unban actions visible | Contract should not require pause/delete/warnings for V1 | Backend has extra actions (`paused`, `DELETE /admin/users/:id`, warnings) | Partial | Backend broader than PM scope | Enforce UI restriction: expose Ban/Unban only | P0 |
| User details | Full user profile details (name, phone, SSN, photo, ID...) | `GET /admin/users/:id` (detailed admin profile DTO) | None | Missing | No admin user detail read endpoint | Add `GET /admin/users/:id` with required identity fields | P0 |
| User details | View user ads/listings (read-only) | `GET /admin/users/:id/listings` or equivalent read endpoint | None dedicated in admin | Missing | Admin must view listings by user without edit/delete actions | Add read-only admin listings endpoint by user | P0 |
| User details | View reports against this specific user | `GET /admin/users/:id/reports` | None | Missing | Required by PM; currently only global reports list | Add user-scoped reports endpoint | P0 |
| User details | No warning action in V1 | N/A | `POST /admin/warnings` exists | Out of Scope | PM removed warnings for release | Hide/remove warning action from UI | P1 |
| Reports page (all reports) | List all reports, read-only | `GET /admin/reports` with minimal fields | `GET /admin/reports` | Partial | Endpoint exists but includes workflow-oriented fields/status model | Return/consume minimal projection: `id`, `description/reason`, `reporter`, `reported_user`, optional `created_at` | P0 |
| Reports page (all reports) | Report fields should exclude type/status/actions | Minimal report schema only | Current model includes `status`, `reviewed_by`, `reviewed_at` | Mismatch | PM explicitly rejected report workflow | Add V1-safe response projection (or client mapping that hides status/workflow) | P0 |
| Reports page (all reports) | No status change action | No update workflow endpoint needed in UI | `PATCH /admin/reports/:id` exists | Out of Scope | PM wants read-only report handling | Remove/disable report status actions in UI | P0 |
| Banned users | Show only banned users | `GET /admin/users?status=banned` or dedicated list | `GET /admin/users?status=banned` | Supported | Works today | None | P2 |
| Banned users | Single action: Unban | `PATCH /admin/users/:id/status` to `active` | `PATCH /admin/users/:id/status` | Supported | Works today | Restrict UI actions to Unban only | P0 |
| Reviews/Ratings | Entire section removed | N/A | N/A | Out of Scope | PM removed for V1 | Remove/hide menu/page | P0 |
| Personal info/account | View/update profile | `GET /me`, `PATCH /me` | `GET /me`, `PATCH /me` | Supported | Core account management exists | None | P2 |
| Personal info/account | Change password | `PATCH /me/password` | `PATCH /me/password` | Supported | Exists | None | P2 |
| Personal info/account | Logout | `POST /auth/logout` | `POST /auth/logout` | Supported | Exists | None | P2 |

## 3) Endpoint-Level Findings (PM V1 Interpretation)

### 3.1 Keep and use for V1

- `GET /admin/users`
- `PATCH /admin/users/:id/status` (Ban/Unban use only)
- `GET /admin/reports` (read-only consumption)
- `POST /auth/login`
- `GET /me`, `PATCH /me`, `PATCH /me/password`, `POST /auth/logout`

### 3.2 Required additions for V1

- `GET /admin/users/:id` (detailed admin user profile)
- `GET /admin/users/:id/reports` (reports against a user)
- `GET /admin/users/:id/listings` (view-only listings for that user)

### 3.3 Existing endpoints not used in PM V1 UI

- `POST /admin/warnings` (optional feature deferred)
- `PATCH /admin/reports/:id` (report workflow/action deferred)
- `DELETE /admin/users/:id` (not part of Ban/Unban-only action set)
- `GET/POST/DELETE /admin/admins*` (no admin-management UI in current PM scope)
- `POST/DELETE /admin/categories*` (not in current PM scope)

### 3.4 Contract mismatches to resolve immediately

- Reports payload currently carries workflow fields (`status`, `reviewed_by`, `reviewed_at`) that PM does not want in V1 UI.
- Users/reporting UI mockups previously included status/type/action concepts for complaints; PM scope is strictly read-only complaint viewing.
- Ads/listings statuses for admin user view should effectively be treated as `active` / `sold` only in UI (no “reported” semantics in V1).

## 4) Prioritized Execution Backlog

### P0 (must ship for PM-approved V1)

1. Implement `GET /admin/users/:id` with full user details required by PM.
2. Implement `GET /admin/users/:id/listings` as read-only listings view for admin.
3. Implement `GET /admin/users/:id/reports` for per-user complaint visibility.
4. Update reports read model for V1 UI to minimal display fields (`id`, `reason/description`, `reporter`, `reported_user`, optional `created_at`) and remove status-action UX.
5. Remove/hide from UI: Overview stats, Reviews/Ratings, Warnings, report workflow actions, extra banned-users actions.

### P1 (cleanup and scope hardening)

1. Add explicit frontend capability flags/route guards so out-of-scope sections stay hidden.
2. Document PM V1 constraints in admin frontend integration notes.

### P2 (post-V1 candidates)

1. Reintroduce warnings via notifications architecture.
2. Reintroduce reviews/ratings admin module.
3. Reintroduce overview analytics when KPI definitions are finalized.

## 5) Validation Checklist (Updated)

- Users page exposes only Ban/Unban for V1.
- Banned users page exposes only Unban action.
- Reports page is read-only with minimal fields, no status/type/workflow actions.
- User details page can show profile + listings (view-only) + reports against user.
- Overview stats, reviews/ratings, and warnings are hidden/removed in V1 build.
