# Deep Production-Readiness Review Report

Date: 2026-04-10
Project: `market_place_backend` (NestJS + PostgreSQL)
Scope: Application + DB + deploy artifacts

## Baseline Checks

- `npm run lint`: **failed**
  - ESLint parse errors on `src/admin/admin-seeder.d.ts` and `src/common/constants.d.ts`.
- `npm test`: **passed** (20 suites, 76 tests)
  - Warnings from `ts-jest` about `.js` files under `src/`.
- `npm run build`: **passed**

## Prioritized Findings

### 1) High - Auth security controls silently degrade when Redis is missing

**Evidence**
- Redis client is optional and methods become no-ops when no client exists: `src/redis/redis.service.ts:13-41`.
- `REDIS_URL` is optional in config: `src/config/configuration.ts:35`, `src/config/configuration.ts:144`.
- OTP attempt throttling depends on Redis (`get/set/del`): `src/auth/auth.service.ts:373-391`.
- Refresh token revocation/rotation depends on Redis JTI storage: `src/auth/auth.service.ts:424-425` and refresh validation earlier in same file.

**Impact**
- If Redis is misconfigured/unavailable, OTP attempt counters are not persisted, enabling effectively unlimited OTP guessing within OTP lifetime.
- Refresh flow behavior becomes inconsistent (revocation and rotation guarantees are lost or fail), reducing auth reliability and security posture.

**Recommended fix**
- Implement a Postgres-backed fallback for OTP attempts and refresh token state with equivalent TTL/expiry behavior.
- Keep Redis as an optional accelerator only; when Redis is unavailable, auth controls must continue in Postgres without weakening security.
- Add startup/readiness checks and explicit logs/metrics to show whether auth state is running in Redis mode or Postgres-fallback mode.

---

### 2) High - Admin privilege changes are not enforced immediately for active JWTs

**Evidence**
- Access token trusts embedded `isAdmin` claim from JWT payload: `src/auth/jwt.strategy.ts:22-24`.
- Admin guard only checks `request.user.isAdmin` (token claim), not current DB state: `src/common/guards/admin.guard.ts:6-14`.
- Demotion updates DB flag but does not invalidate existing access tokens: `src/admin/admin.service.ts:101-127`.

**Impact**
- A demoted admin can continue to call admin endpoints until their access token expires.
- This creates a privilege-revocation delay window that is unacceptable for sensitive moderation/admin actions.

**Recommended fix**
- For admin endpoints, re-check `users.is_admin` from DB (or cache with strict invalidation) on each request.
- Add token invalidation/versioning strategy for role changes (e.g., `token_version` or short TTL + forced rotation).
- Add regression tests for “demote then immediately access admin route”.

---

### 3) Medium - Avatar URL logic still contains legacy non-Cloudinary path

**Evidence**
- `UsersService.getMe` builds avatar URL from `STORAGE_PUBLIC_BASE_URL`: `src/users/users.service.ts:52-59`.
- File service builds Cloudinary URLs using `cloudName/resourceType/upload/objectKey`: `src/files/files.service.ts:168-179`.
- Config already enforces Cloudinary-only storage: `src/config/configuration.ts:78-80`.

**Impact**
- Legacy URL-building path can produce wrong avatar URLs because runtime storage is Cloudinary-only.
- Causes broken image rendering and support/debug overhead.

**Recommended fix**
- Keep a single Cloudinary URL builder as the only read URL path.
- Remove legacy/non-Cloudinary URL logic and config dependency (`STORAGE_PUBLIC_BASE_URL`) from avatar URL generation.
- In `UsersService`, generate avatar URLs using the same Cloudinary logic used by `FilesService`.

---

### 4) Medium - Repository contains generated artifacts under `src/` that break lint reliability

**Evidence**
- Generated build artifacts exist in source tree:
  - `src/admin/admin-seeder.js`
  - `src/admin/admin-seeder.d.ts`
  - `src/admin/admin-seeder.js.map`
  - `src/common/constants.js`
  - `src/common/constants.d.ts`
  - `src/common/constants.js.map`
- Lint fails against these artifacts, and tests warn about transpiling `.js` files from `src`.

**Impact**
- CI quality gate for lint is currently non-functional.
- Tooling noise hides real issues and increases risk of shipping regressions.

**Recommended fix**
- Remove generated JS/d.ts/map artifacts from `src/` and prevent reintroduction (build output only in `dist/`).
- Tighten lint/test include patterns or ignore generated artifacts explicitly.
- Add CI check ensuring clean working tree after build/test (or rule banning compiled files in `src`).

---

### 5) Medium - `updateMe` allows attaching files with `uploader_user_id = NULL`

**Evidence**
- Ownership check only rejects when `uploader_user_id` is truthy and different: `src/users/users.service.ts:77-79`.
- If `uploader_user_id` is `NULL`, the guard does not block assignment.

**Impact**
- Orphaned files (e.g., after uploader deletion) can potentially be attached by other users if file IDs are discoverable.
- Weakens ownership guarantees for profile media.

**Recommended fix**
- Require strict ownership for avatar assignment (`uploader_user_id === current user id`), unless explicitly allowing admin-only override.
- Optionally require file status/purpose checks (`uploaded`, `avatar`) before assignment.

---

## Suggested Immediate Actions (Top 5)

1. Enforce Redis availability for auth flows (or implement secure DB fallback) and add readiness checks.
2. Fix admin authorization model to revalidate role on protected endpoints and invalidate stale admin tokens.
3. Unify file read URL generation logic and patch `UsersService.getMe` for Cloudinary correctness.
4. Remove generated artifacts from `src/` and restore passing lint in CI.
5. Harden avatar assignment ownership checks (`uploader_user_id` must match current user).

## Residual Risk / Test Gaps

- No end-to-end tests currently verify admin demotion immediate effect on authorization.
- No explicit tests for Redis-down/misconfigured behavior of OTP attempt limits and refresh rotation.
- No tests currently assert profile avatar URL correctness for Cloudinary-only mode.
