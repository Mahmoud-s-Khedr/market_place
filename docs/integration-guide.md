# Market Place — Frontend & Mobile Integration Guide

> **Audience:** Web (React / Vue / Angular) and Mobile (React Native / Flutter) developers integrating with the Market Place backend.
>
> **Swagger UI (direct app):** `http://localhost:3000/api/docs`
>
> **Swagger UI (Docker + Nginx):** `http://localhost/api/docs`
>
> **Swagger JSON (direct app):** `http://localhost:3000/api/docs-json`
>
> **Swagger JSON (Docker + Nginx):** `http://localhost/api/docs-json`
>
> **Last verified:** `2026-04-28` against `openapi.json` and runtime sources in `src/` (controller/service behavior is authoritative).
>
> **Tip:** This guide documents every endpoint, payload shape, and validation rule derived directly from the source DTOs — use it as the single source of truth for client-side integration. `openapi.json` is regenerated from runtime routes during app startup.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Authentication](#2-authentication)
3. [File Uploads (Cloudinary)](#3-file-uploads-cloudinary)
4. [Users & Profile](#4-users--profile)
5. [Products](#5-products)
6. [Categories](#6-categories)
7. [Ratings](#7-ratings)
8. [Reports](#8-reports)
9. [Real-time Chat (Socket.io)](#9-real-time-chat-socketio)
10. [Admin (Privileged)](#10-admin-privileged)
11. [Error Reference](#11-error-reference)
12. [Health Checks](#12-health-checks)

---

## 1. Overview

### Base URL

```
http://<host>:<port>
```

No global API prefix is added. All routes are mounted at the root (e.g., `POST /auth/register`).

### Request Format

- All request bodies must use `Content-Type: application/json`.
- Query parameters are plain URL-encoded strings (numbers are automatically coerced).
- Maximum request body size: **1 MB**.

### Authorization Header

Authenticated endpoints require a Bearer token:

```
Authorization: Bearer <accessToken>
```

### Standard Success Envelope

Every successful REST response uses this envelope:

```json
{
  "success": true,
  "statusCode": 200,
  "data": {}
}
```

### Data Flattening Rule (Runtime)

`data` is flattened only when the controller/service payload has exactly one top-level key.
Flattening applies one level deep and does not recurse into nested objects.

- Example: `{ data: { users: [...] } }` -> `{ data: [...] }`
- Example: `{ data: { user: {...} } }` -> `{ data: {...} }`
- If payload has multiple top-level keys, shape is preserved (for example `{ user, products }`).

### Global FK Expansion (Runtime Behavior)

The API now expands foreign keys in REST responses to one-level embedded objects.

- Scalar FK fields are replaced by objects.
- `*_id` becomes the same key without `_id` (for example `category_id` -> `category`).
- Non-`*_id` FKs like `reviewed_by` are also expanded in-place.
- Expansion depth is one level only.
- Polymorphic `files.owner_id` is intentionally not expanded (depends on `owner_type`).

### Standard Error Envelope

All errors share this shape:

```json
{
  "success": false,
  "statusCode": 409,
  "data": null,
  "error": {
    "code": 409,
    "message": "Phone or SSN already exists",
    "timestamp": "2026-03-28T12:00:00.000Z",
    "path": "/auth/register"
  }
}
```

### Global Rate Limiting

The default limit is **120 requests per 60 seconds** per IP. Individual endpoints override this (see per-endpoint notes). On limit breach the server returns `429 Too Many Requests`.

### Verification Matrix (2026-04-28)

| Surface | Verified Against | What Was Checked |
|---------|------------------|------------------|
| REST routes | `openapi.json` + controllers in `src/` | Method/path coverage, auth guard expectation, status codes |
| DTO contracts | DTOs in `src/**/dto/*.ts` + service return payloads | Required fields, validation limits, response key names |
| WebSocket chat | `src/chat/chat.gateway.ts` + `src/chat/chat.service.ts` | Connect auth, `conversation.join`, `message.send`, `message.read`, broadcast/error behavior |
| Global behavior | `src/main.ts`, `src/app.module.ts`, exception filter | API prefix, request body limit, global/per-route throttling, error envelope |
| Admin flows | `src/admin/admin.controller.ts` + `src/admin/admin.service.ts` | Privileged route coverage, moderation/category operations, default pagination behavior |

### Runtime vs Swagger Notes (Current)

- `POST /auth/refresh`: Runtime accepts only `{ refreshToken }` in body and does not enforce access-token auth guard. Swagger currently marks bearer auth on this endpoint.
- `PATCH /me/password`: Runtime returns `400 Bad Request` for invalid `oldPassword`. Swagger annotation currently lists `401`.
- `GET /admin/users`: Runtime default `limit` is `50` when omitted (DTO docs mention `20`).
- `GET /chat/conversations`: Runtime accepts optional `scope` query (`all` | `buy` | `sell`). Swagger currently omits this query parameter.
- `GET /products/:id` and `GET /search/products`: runtime accepts optional Bearer auth for personalization (`is_favorite`, block-aware filtering), though they are still public routes.

---

## 2. Authentication

Access tokens expire in **15 minutes**. Refresh tokens expire in **30 days**. Use the refresh endpoint to obtain new tokens without re-authentication.

### TypeScript Interfaces

```typescript
interface AppUser {
  id: number;
  ssn: string | null;
  name: string;
  phone: string;
  profileState: 'active' | 'paused' | 'banned' | string | null;
}

interface TokenResponse {
  success: true;
  statusCode: number;
  data: {
    user?: AppUser;       // present on register/verify and login
    accessToken: string;
    refreshToken: string;
  };
}

interface OtpSentResponse {
  success: true;
  statusCode: number;
  data: {
    message: string;
    otp?: string;          // only when OTP_DEV_MODE=true on the server
  };
}
```

---

### 2.1 Registration Flow

Registration is a **3-step** process:

```
Step 1: POST /auth/register         → OTP sent to phone via SMS
Step 2: (user reads SMS)
Step 3: POST /auth/register/verify  → returns accessToken + refreshToken
```

#### Step 1 — Request OTP

**`POST /auth/register`** — Rate limit: 5 req/min

Request body:

```json
{
  "name":     "Ahmed Ali",
  "ssn":      "12345678",
  "phone":    "+201234567890",
  "password": "Secret123"
}
```

| Field      | Type   | Required | Constraints |
|------------|--------|----------|-------------|
| `name`     | string | yes      | 2–150 chars |
| `ssn`      | string | yes      | 8–32 chars (national ID) |
| `phone`    | string | yes      | E.164 format: `+?[1-9]\d{7,15}` |
| `password` | string | yes      | 8–64 chars, must contain letters AND digits |

Response `201`:

```json
{ "success": true, "statusCode": 201, "data": { "message": "OTP sent" } }
```

> In dev mode (`OTP_DEV_MODE=true`) with the console provider, the response also includes `"otp": "000000"`.

Error `409`: Phone or SSN already registered.

#### Step 1b — Resend OTP

**`POST /auth/register/resend-otp`** — Rate limit: 3 req/min

```json
{ "phone": "+201234567890" }
```

Error `404`: No pending registration found for this phone.

#### Step 3 — Verify OTP & Complete Registration

**`POST /auth/register/verify`**

```json
{
  "phone": "+201234567890",
  "otp":   "000000"
}
```

| Field   | Type   | Required | Constraints |
|---------|--------|----------|-------------|
| `phone` | string | yes      | E.164 format |
| `otp`   | string | yes      | 4–8 digit string |

Response `201`:

```json
{
  "success": true,
  "statusCode": 201,
  "data": {
    "user": {
      "id": 1,
      "ssn": "12345678",
      "name": "Ahmed Ali",
      "phone": "+201234567890",
      "profileState": "active"
    },
    "accessToken": "eyJ...",
    "refreshToken": "eyJ..."
  }
}
```

Error `400`: Invalid/expired OTP or registration session expired/not found.
Error `409`: Phone or SSN already registered.

---

### 2.2 Login

**`POST /auth/login`** — Rate limit: 10 req/min

```json
{
  "phone":    "+201234567890",
  "password": "Secret123"
}
```

| Field      | Type   | Required | Constraints |
|------------|--------|----------|-------------|
| `phone`    | string | yes      | E.164 format |
| `password` | string | yes      | 8–64 chars |

Response `201`: Same `TokenResponse` shape as above.

Error `401`: Invalid credentials.

---

### 2.3 Refresh Access Token

**`POST /auth/refresh`**

```json
{ "refreshToken": "eyJ..." }
```

Response `201`: New token pair:

```json
{
  "success": true,
  "statusCode": 201,
  "data": {
    "accessToken": "eyJ...",
    "refreshToken": "eyJ..."
  }
}
```

Rotate the stored refresh token on every successful refresh.

Error `401`: Refresh token invalid or revoked.

> **Swagger mismatch:** OpenAPI currently marks this endpoint with bearer auth, but runtime behavior validates only `refreshToken` in the request body.

---

### 2.4 Logout

**`POST /auth/logout`** — Requires Bearer token

```json
{ "refreshToken": "eyJ..." }
```

Response `201`:

```json
{ "success": true, "statusCode": 201, "data": {} }
```

---

### 2.5 Password Reset Flow

```
Step 1: POST /auth/password/request-otp  → OTP sent to phone
Step 2: POST /auth/password/reset        → new tokens
```

#### Step 1 — Request Reset OTP

**`POST /auth/password/request-otp`** — Rate limit: 5 req/min

```json
{ "phone": "+201234567890" }
```

Response `201`: `OtpSentResponse`. If the phone is not found the server still returns `201` with a generic message like `If this number is registered, an OTP has been sent` (security measure).

#### Step 2 — Reset Password

**`POST /auth/password/reset`** — Rate limit: 5 req/min

```json
{
  "phone":           "+201234567890",
  "otp":             "000000",
  "newPassword":     "NewSecret456",
  "confirmPassword": "NewSecret456"
}
```

| Field             | Type   | Required | Constraints |
|-------------------|--------|----------|-------------|
| `phone`           | string | yes      | E.164 format |
| `otp`             | string | yes      | 4–8 digit string |
| `newPassword`     | string | yes      | 8–64 chars, letters + digits |
| `confirmPassword` | string | yes      | 8–64 chars (must match `newPassword`) |

Response `201`:

```json
{
  "success": true,
  "statusCode": 201,
  "data": {
    "message": "Password reset successfully",
    "accessToken": "eyJ...",
    "refreshToken": "eyJ..."
  }
}
```

Error `400`: Invalid/expired OTP, passwords do not match, or user not found.
Error `401`: Account not active.

---

### 2.6 Token Storage Recommendations

| Platform   | Access Token    | Refresh Token |
|------------|-----------------|---------------|
| Web (SPA)  | JS memory / Redux | `httpOnly` cookie or `localStorage` (weigh XSS risk) |
| React Native | In-memory state | Expo SecureStore / Keychain |
| Flutter    | In-memory state | flutter_secure_storage |

Keep the access token in memory; persist only the refresh token.

---

## 3. File Uploads (Cloudinary)

### Unified Response Envelope (All REST Endpoints)

Success response shape:

```json
{
  "success": true,
  "statusCode": 200,
  "data": {}
}
```

Error response shape:

```json
{
  "success": false,
  "statusCode": 400,
  "data": null,
  "error": {
    "code": 400,
    "message": "Validation failed",
    "timestamp": "2026-03-28T12:00:00.000Z",
    "path": "/api/example"
  }
}
```

All uploads follow a **3-step signed upload-intent pattern** — the file never passes through the API server.

```
Step 1: POST /files/upload-intent     → receive signed Cloudinary URL
Step 2: Use data.upload.method/url/fields  → upload file directly to Cloudinary
Step 3: PATCH /files/:id/mark-uploaded → confirm upload
```

Then use the returned `data.file.id` in subsequent API calls (e.g. `avatarFileId`, `imageFileIds`).

### TypeScript Interfaces

```typescript
interface UploadIntentFile {
  id: number;
  objectKey: string;
  status: 'pending' | 'uploaded' | 'failed' | 'deleted';
}

interface UploadIntent {
  method: string;          // e.g. 'POST' or 'PUT'
  url: string;             // Cloudinary signed URL
  expiresAt: string;       // ISO 8601
  headers?: Record<string, string>;
  fields?: Record<string, string>;
}

interface UploadIntentResponse {
  success: true;
  statusCode: number;
  data: {
    file: UploadIntentFile;
    upload: UploadIntent;
  };
}
```

---

### Step 1 — Create Upload Intent

**`POST /files/upload-intent`** — Requires Bearer token

```json
{
  "ownerType":    "product",
  "ownerId":      5,
  "purpose":      "product_image",
  "filename":     "photo.jpg",
  "mimeType":     "image/jpeg",
  "fileSizeBytes": 204800
}
```

| Field           | Type   | Required | Constraints |
|-----------------|--------|----------|-------------|
| `ownerType`     | enum   | yes      | `user` \| `product` \| `message` |
| `ownerId`       | number | no       | ≥ 1 — omit when creating a new entity |
| `purpose`       | enum   | yes      | `avatar` \| `product_image` \| `chat_attachment` \| `document` |
| `filename`      | string | yes      | 1–255 chars, include extension |
| `mimeType`      | enum   | yes      | See supported types below |
| `fileSizeBytes` | number | no       | 0 – 52 428 800 (50 MB max) |

**Supported MIME types:**

| Category | Values |
|----------|--------|
| Images   | `image/jpeg`, `image/png`, `image/webp`, `image/gif` |
| Video    | `video/mp4`, `video/quicktime`, `video/webm`, `video/x-msvideo` |
| Audio    | `audio/mpeg`, `audio/wav`, `audio/ogg`, `audio/webm` |
| Docs     | `application/pdf`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/vnd.ms-excel`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/zip` |

**`ownerType` + `purpose` combinations:**

| Use case         | `ownerType` | `purpose`          |
|------------------|-------------|--------------------|
| User avatar      | `user`      | `avatar`           |
| Product images   | `product`   | `product_image`    |
| Chat attachment  | `message`   | `chat_attachment`  |
| Document upload  | `user`      | `document`         |

`objectKey` is generated by the server as `<ownerType>/<ownerId|temp>/<timestamp>-<random>-<filename>`. Treat it as opaque and do not attempt to precompute it client-side.

Response `201`:

```json
{
  "success": true,
  "statusCode": 201,
  "data": {
    "file": {
      "id": 42,
      "objectKey": "product/5/1711622400-ab12cd34-photo.jpg",
      "status": "pending"
    },
    "upload": {
      "method": "POST",
      "url": "https://api.cloudinary.com/v1_1/example/auto/upload",
      "expiresAt": "2026-03-28T12:15:00.000Z",
      "fields": {
        "api_key": "...",
        "public_id": "product/5/1711622400-ab12cd34-photo.jpg",
        "timestamp": "1711622400",
        "signature": "..."
      }
    }
  }
}
```

---

### Step 2 — Upload to Cloudinary

Use `data.upload.method`, `data.upload.url`, `data.upload.headers`, and `data.upload.fields` from the Step 1 response.

```javascript
// Example (Cloudinary signed POST)
const form = new FormData();
for (const [key, value] of Object.entries(data.upload.fields ?? {})) {
  form.append(key, value);
}
form.append('file', fileBlob);

await fetch(data.upload.url, {
  method: data.upload.method,              // runtime currently 'POST'
  headers: data.upload.headers ?? {},
  body: form,
});
```

> The upload intent expires at `data.upload.expiresAt` (default ~10 minutes). Do not cache it.

---

### Step 3 — Mark as Uploaded

**`PATCH /files/:id/mark-uploaded`** — Requires Bearer token

```json
{
  "checksumSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
}
```

| Field             | Type   | Required | Constraints |
|-------------------|--------|----------|-------------|
| `checksumSha256`  | string | no       | Exactly 64 hex chars (SHA-256 of file) |

Response `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "file": { "id": 42, "objectKey": "product/5/1711622400-ab12cd34-photo.jpg", "status": "uploaded" }
  }
}
```

---

### Get File Metadata

**`GET /files/:id`** — Requires Bearer token

Response `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "file": {
      "id": 42,
      "uploader_user": { "id": 5, "name": "Jana Ahmed", "avatar_url": null },
      "owner_type": "product",
      "owner_id": 5,
      "purpose": "product_image",
      "object_key": "product/5/1711622400-ab12cd34-photo.jpg",
      "mime_type": "image/jpeg",
      "file_size_bytes": 204800,
      "status": "uploaded",
      "created_at": "2026-03-28T12:00:00.000Z",
      "uploaded_at": "2026-03-28T12:05:00.000Z",
      "readUrl": "https://res.cloudinary.com/example/image/upload/product/5/1711622400-ab12cd34-photo.jpg"
    }
  }
}
```

---

## 4. Users & Profile

Most endpoints in this section require `Authorization: Bearer <accessToken>`.
Public profile lookup (`GET /users/:id`) is public, with optional auth for personalization flags.

### TypeScript Interfaces

```typescript
interface AppUser {
  id: number;
  ssn: string | null;
  name: string;
  phone: string;
  profileState: 'active' | 'paused' | 'banned' | string | null;
}

interface MeUser extends AppUser {
  rate: string;           // e.g. "4.50" — average seller rating
  avatar_url: string | null;
}

interface Contact {
  id: number;
  contact_type: 'phone' | 'email' | 'address';
  value: string;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

interface PublicUser extends AppUser {
  created_at: string;
  ads_count: number;
  rate: string;
  avatar_url: string | null;
  blocked_by_me?: boolean | null;
  blocked_me?: boolean | null;
}
```

---

### 4.1 Get Current User Profile

**`GET /me`**

Response `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "id": 1,
    "ssn": "12345678",
    "name": "Ahmed Ali",
    "phone": "+201234567890",
    "profileState": "active",
    "rate": "4.50",
    "avatar_url": "https://res.cloudinary.com/example/image/upload/avatar.jpg"
  }
}
```

---

### 4.2 Update Profile

**`PATCH /me`**

```json
{
  "name": "Ahmed Mohamed",
  "avatarFileId": 7
}
```

| Field          | Type   | Required | Constraints |
|----------------|--------|----------|-------------|
| `name`         | string | no       | 2–150 chars |
| `avatarFileId` | number | no       | File ID from Step 3 of upload flow (purpose=`avatar`) |

Response `200`: Updated `UserProfileResponse`.

---

### 4.3 Change Password

**`PATCH /me/password`**

```json
{
  "oldPassword": "OldSecret123",
  "newPassword": "NewSecret456"
}
```

| Field         | Type   | Required | Constraints |
|---------------|--------|----------|-------------|
| `oldPassword` | string | yes      | 8–64 chars |
| `newPassword` | string | yes      | 8–64 chars, letters + digits |

Response `200`:

```json
{ "success": true, "statusCode": 200, "data": { "message": "Password changed successfully" } }
```

Error `400`: Current password incorrect.

> **Swagger mismatch:** OpenAPI currently documents this as `401`, but runtime returns `400`.

---

### 4.4 List Contacts

**`GET /me/contacts`**

Response `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "contacts": [
      {
        "id": 1,
        "contact_type": "phone",
        "value": "+201234567890",
        "is_primary": true,
        "created_at": "2026-03-28T12:00:00.000Z",
        "updated_at": "2026-03-28T12:00:00.000Z"
      }
    ]
  }
}
```

---

### 4.5 Add Contact

**`POST /me/contacts`**

```json
{
  "contactType":"address",
  "value":     "15 Tahrir Square, Downtown Cairo",
  "isPrimary": true
}
```

| Field       | Type    | Required | Constraints |
|-------------|---------|----------|-------------|
| `contactType` | enum    | yes      | `phone` \| `email` \| `address` |
| `value`     | string  | yes      | 1–255 chars |
| `isPrimary` | boolean | no       | Set as primary contact of this type |

Response `201`: `ContactResponse`.

---

### 4.6 Update Contact

**`PATCH /me/contacts/:id`**

```json
{ "value": "+201111111111", "isPrimary": false }
```

All fields optional (same constraints as create). Response `200`: `ContactResponse`.

Error `404`: Contact not found or not owned by current user.

---

### 4.7 Delete Contact

**`DELETE /me/contacts/:id`**

Response `200`:

```json
{ "success": true, "statusCode": 200, "data": { "message": "Contact deleted" } }
```

---

### 4.8 Public User Profile

**`GET /users/:id`** — Public (optional Bearer token)

Query params:

| Parameter | Type | Default | Constraints |
|-----------|------|---------|-------------|
| `limit`   | number | 20 | 1–50 |
| `offset`  | number | 0  | ≥ 0 |

Response `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "user": {
      "id": 12,
      "ssn": "98765432",
      "name": "Jana Ahmed",
      "phone": "+201000000012",
      "profileState": "active",
      "created_at": "2025-02-22T10:00:00.000Z",
      "ads_count": 10,
      "rate": "4.50",
      "avatar_url": "https://res.cloudinary.com/example/image/upload/users/12/avatar.jpg",
      "blocked_by_me": false,
      "blocked_me": false
    },
    "products": [
      {
        "id": 91,
        "owner": { "id": 12, "name": "Jana Ahmed", "avatar_url": "https://res.cloudinary.com/example/image/upload/users/12/avatar.jpg" },
        "category": { "id": 3, "parent_id": 1, "name": "Phones", "created_at": "2026-03-28T12:00:00.000Z" },
        "name": "iPhone 13",
        "price": 600,
        "status": "available"
      }
    ]
  }
}
```

If either side has blocked the other, this endpoint returns `404` to hide profile interaction surfaces.

---

### 4.9 User Blocks (Hard Block)

All block endpoints require Bearer token.

#### Block User

**`POST /blocks/:userId`**

Response `201`:

```json
{ "success": true, "statusCode": 201, "data": { "message": "User blocked" } }
```

#### Unblock User

**`DELETE /blocks/:userId`**

Response `200`:

```json
{ "success": true, "statusCode": 200, "data": { "message": "User unblocked" } }
```

#### List Blocked Users

**`GET /blocks`**

Response `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "data": [
    { "id": 42, "name": "Blocked User", "phone": "+201000000042", "blocked_at": "2026-04-17T10:00:00.000Z" }
  ]
}
```

Block enforcement applies to conversation creation, message access/send, conversation listing, and public profile visibility.

---

## 5. Products

### TypeScript Interfaces

```typescript
interface ProductImage {
  id: number;
  file: { id: number; purpose: string; object_key: string; status: string } | null;
  sort_order: number;
  object_key: string;
  status: 'pending' | 'uploaded' | 'failed' | 'deleted';
}

interface Product {
  id: number;
  owner: { id: number; name: string; avatar_url: string | null } | null;
  category: { id: number; parent_id: number | null; name: string; created_at: string } | null;
  name: string;
  description: string | null;
  price: number;
  city: string;
  address_text: string | null;
  details: Record<string, unknown> | null;
  status: 'available' | 'sold' | 'archived';
  is_negotiable: boolean;
  preferred_contact_method: 'phone' | 'chat' | 'both';
  created_at: string;
  updated_at: string;
  seller_rate?: string | null;  // only in search results
  is_favorite?: boolean | null; // returned for authenticated contexts
  images?: ProductImage[];      // present in product detail and some user-profile surfaces
}
```

---

### 5.1 Create Product

**`POST /products`** — Requires Bearer token

```json
{
  "categoryId":   3,
  "name":         "iPhone 14 Pro Max",
  "description":  "Excellent condition, barely used.",
  "price":        1500.00,
  "city":         "Cairo",
  "addressText":  "15 Tahrir Square, Downtown",
  "details":      { "condition": "used", "storage": "256GB" },
  "isNegotiable": true,
  "preferredContactMethod": "both",
  "imageFileIds": [10, 11, 12]
}
```

| Field          | Type     | Required | Constraints |
|----------------|----------|----------|-------------|
| `categoryId`   | number   | yes      | ≥ 1, must be a valid leaf category |
| `name`         | string   | yes      | 1–255 chars |
| `description`  | string   | yes      | 1–5000 chars |
| `price`        | number   | yes      | 0 – 9 999 999 999.99 |
| `city`         | string   | yes      | 1–255 chars |
| `addressText`  | string   | yes      | 1–1000 chars |
| `details`      | object   | no       | Any valid JSON object |
| `isNegotiable` | boolean  | no       | Default `false` |
| `preferredContactMethod` | enum | no | `phone` \| `chat` \| `both` (default `both`) |
| `imageFileIds` | number[] | no       | Up to **10** pre-uploaded file IDs |

> **Image upload flow:** Upload each image via the Files API first (purpose = `product_image`), collect the returned `file.id` values, then pass them as `imageFileIds` here.

Response `201`: `ProductResponse`.

Error `400`: Invalid category or file references.

---

### 5.2 Get Product

**`GET /products/:id`** — Public. Rate limit: 120 req/min (optional Bearer token for favorite personalization)

Response `200`: `ProductResponse`.

Error `404`: Product not found.

---

### 5.3 Update Product

**`PATCH /products/:id`** — Requires Bearer token (must be owner)

All fields optional, same constraints as create (including `isNegotiable` and `preferredContactMethod`). Passing `imageFileIds` **replaces** the full image set.

Response `200`: `ProductResponse`.

Error `403`: Not the product owner. Error `404`: Not found.

---

### 5.4 Delete Product (Soft Delete)

**`DELETE /products/:id`** — Requires Bearer token (must be owner)

Response `200`:

```json
{ "success": true, "statusCode": 200, "data": { "message": "Product deleted" } }
```

---

### 5.5 Update Product Status

**`PATCH /products/:id/status`** — Requires Bearer token (must be owner)

```json
{ "status": "sold" }
```

`status` enum: `available` | `sold` | `archived`

Response `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "product": { "id": 1, "status": "sold", "updated_at": "2026-03-28T12:00:00.000Z" }
  }
}
```

---

### 5.6 Search Products

**`GET /search/products`** — Public. Rate limit: 60 req/min (optional Bearer token for `is_favorite` and block-aware filtering)

All query parameters are optional:

| Parameter     | Type    | Default | Constraints |
|---------------|---------|---------|-------------|
| `q`           | string  | —       | Full-text search across name + description |
| `categoryId`  | number  | —       | ≥ 1 |
| `minPrice`    | number  | —       | ≥ 0 |
| `maxPrice`    | number  | —       | ≥ 0 |
| `fromDate`    | string  | —       | ISO 8601 date |
| `toDate`      | string  | —       | ISO 8601 date, must be ≥ `fromDate` |
| `minRate`     | number  | —       | 0–5 (minimum seller average rating) |
| `city`        | string  | —       | Partial match (`ILIKE`) |
| `addressText` | string  | —       | Partial address match |
| `sortBy`      | enum    | —       | `price` \| `address` \| `rate` \| `created` |
| `sortDir`     | enum    | —       | `asc` \| `desc` |
| `limit`       | number  | 20      | 1–100 |
| `offset`      | number  | 0       | ≥ 0 |

Example: `GET /search/products?q=iPhone&city=Cairo&sortBy=price&sortDir=asc&limit=20&offset=0`

> `sortBy=address` currently sorts by `city`.

Response `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "items": [
      {
        "id": 1,
        "owner": { "id": 5, "name": "Alice Example", "avatar_url": null },
        "category": { "id": 3, "parent_id": 1, "name": "Phones", "created_at": "2026-03-28T12:00:00.000Z" },
        "name": "iPhone 14 Pro Max",
        "description": "Excellent condition.",
        "price": 1500,
        "city": "Cairo",
        "address_text": "15 Tahrir Square",
        "details": { "condition": "used" },
        "status": "available",
        "is_negotiable": true,
        "preferred_contact_method": "both",
        "created_at": "2026-03-28T12:00:00.000Z",
        "updated_at": "2026-03-28T12:00:00.000Z",
        "seller_rate": "4.50",
        "is_favorite": true
      }
    ]
  }
}
```

Notes:
- `seller_rate` is only included in search/list results, not in single-product GET.
- If the requester is authenticated, results exclude users involved in a block relation and include `is_favorite`.
- Search/list payloads do not include full `images` arrays.

---

### 5.7 List My Products

**`GET /my/products`** — Requires Bearer token

Accepts all the same query parameters as search, plus:

| Parameter | Type | Default | Constraints |
|-----------|------|---------|-------------|
| `status`  | enum | —       | `available` \| `sold` \| `archived` |

Response `200`: Same `ProductListResponse` shape as search.

UI mapping note: use `status=archived` for the "hidden" tab in My Ads.

---

### 5.8 Favorites

All favorites endpoints require Bearer token.

#### Add Favorite

**`POST /favorites/:productId`**

Response `201`:

```json
{ "success": true, "statusCode": 201, "data": { "message": "Product added to favorites" } }

Error `404`: Product not found.
Error `400`: Cannot favorite this product (blocked relationship).
```

#### Remove Favorite

**`DELETE /favorites/:productId`**

Response `200`:

```json
{ "success": true, "statusCode": 200, "data": { "message": "Product removed from favorites" } }
```

#### List Favorites

**`GET /favorites`**

Optional query parameters:

| Parameter | Type | Default | Constraints |
|-----------|------|---------|-------------|
| `sortBy`  | enum | `created` | `price` \| `created` |
| `sortDir` | enum | `desc` | `asc` \| `desc` |
| `limit`   | number | 20 | 1–100 |
| `offset`  | number | 0 | ≥ 0 |

Response `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "items": [
      {
        "id": 91,
        "owner": { "id": 12, "name": "Jana Ahmed", "avatar_url": "https://res.cloudinary.com/example/image/upload/users/12/avatar.jpg" },
        "category": { "id": 3, "parent_id": 1, "name": "Phones", "created_at": "2026-03-28T12:00:00.000Z" },
        "name": "iPhone 13",
        "description": "Excellent condition.",
        "price": 600,
        "city": "Cairo",
        "address_text": "15 Tahrir Square",
        "details": { "condition": "used" },
        "status": "available",
        "is_negotiable": true,
        "preferred_contact_method": "both",
        "created_at": "2026-03-28T12:00:00.000Z",
        "updated_at": "2026-03-28T12:00:00.000Z",
        "seller_rate": "4.50",
        "is_favorite": true
      }
    ]
  }
}
```

---

## 6. Categories

### 6.1 List All Categories

**`GET /categories`** — Public

Response `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "categories": [
      { "id": 1, "parent": null, "name": "Electronics", "created_at": "2026-03-28T12:00:00.000Z" },
      { "id": 2, "parent": { "id": 1, "parent_id": null, "name": "Electronics", "created_at": "2026-03-28T12:00:00.000Z" }, "name": "Phones", "created_at": "2026-03-28T12:00:00.000Z" },
      { "id": 3, "parent": { "id": 1, "parent_id": null, "name": "Electronics", "created_at": "2026-03-28T12:00:00.000Z" }, "name": "Laptops", "created_at": "2026-03-28T12:00:00.000Z" }
    ]
  }
}
```

The list is **flat**. Reconstruct the tree by grouping on `parent?.id` (`null` = root category). Use leaf category IDs (those with no children) when creating products.

### TypeScript Tree-Builder Snippet

```typescript
interface Category {
  id: number;
  parent: { id: number } | null;
  name: string;
  created_at: string;
}

interface CategoryNode extends Category {
  children: CategoryNode[];
}

function buildTree(flat: Category[]): CategoryNode[] {
  const map = new Map(flat.map(c => [c.id, { ...c, children: [] as CategoryNode[] }]));
  const roots: CategoryNode[] = [];
  for (const node of map.values()) {
    const parentId = node.parent?.id ?? null;
    if (parentId === null) roots.push(node);
    else map.get(parentId)?.children.push(node);
  }
  return roots;
}
```

---

## 7. Ratings

### TypeScript Interfaces

```typescript
interface Rating {
  id: number;
  rater: { id: number; name: string; avatar_url: string | null } | null;
  rated_user: { id: number; name: string; avatar_url: string | null } | null;
  rating_value: number;  // 1–5
  comment: string | null;
  created_at: string;
  updated_at: string;
}

interface RatingSummary {
  avg_rating: string;    // e.g. "4.50"
  ratings_count: number;
}
```

---

### 7.1 Rate a User

**`POST /ratings`** — Requires Bearer token

```json
{
  "ratedUserId":  15,
  "ratingValue":  4,
  "comment":      "Great seller, fast shipping!"
}
```

| Field         | Type   | Required | Constraints |
|---------------|--------|----------|-------------|
| `ratedUserId` | number | yes      | ≥ 1 — cannot be yourself |
| `ratingValue` | number | yes      | 1–5 (integer) |
| `comment`     | string | no       | 1–2000 chars |

Response `201`:

```json
{
  "success": true,
  "statusCode": 201,
  "data": {
    "rating": {
      "id": 1, "rater": { "id": 5, "name": "Bob Buyer", "avatar_url": null }, "rated_user": { "id": 15, "name": "Alice Seller", "avatar_url": null },
      "rating_value": 4, "comment": "Great seller, fast shipping!",
      "created_at": "...", "updated_at": "..."
    }
  }
}
```

> **Business rule:** If you have already rated this user, the existing rating is **updated** (upsert). There is only one rating per rater–ratee pair.

Error `400`: Attempting to rate yourself.

---

### 7.2 Get User Rating Summary

**`GET /ratings/:userId`** — Public

Response `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "summary": { "avg_rating": "4.50", "ratings_count": 12 },
    "ratings": [
      { "id": 1, "rater": { "id": 5, "name": "Bob Buyer", "avatar_url": null }, "rated_user": { "id": 15, "name": "Alice Seller", "avatar_url": null }, "rating_value": 4, "comment": "...", "created_at": "...", "updated_at": "..." }
    ]
  }
}
```

Error `404`: User not found.

Notes:
- The `ratings` array includes the most recent 20 ratings.

---

## 8. Reports

### TypeScript Interface

```typescript
interface Report {
  id: number;
  reporter: { id: number; name: string; avatar_url: string | null } | null;
  reported_user: { id: number; name: string; avatar_url: string | null } | null;
  reason: string;
  status: 'open' | 'reviewing' | 'resolved' | 'rejected';
  reviewed_by: { id: number; name: string; avatar_url: string | null } | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}
```

---

### 8.1 Submit Abuse Report

**`POST /reports`** — Requires Bearer token

```json
{
  "reportedUserId": 20,
  "reason": "This user posted fraudulent listings."
}
```

| Field            | Type   | Required | Constraints |
|------------------|--------|----------|-------------|
| `reportedUserId` | number | yes      | ≥ 1 |
| `reason`         | string | yes      | 5–3000 chars |

Response `201`: `ReportResponse`.

Error `400`: Attempting to report yourself.
Error `404`: Reported user not found.

---

### 8.2 List My Reports

**`GET /reports/me`** — Requires Bearer token

Response `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "reports": [
      {
        "id": 1, "reporter": { "id": 3, "name": "Reporter User", "avatar_url": null }, "reported_user": { "id": 20, "name": "Reported User", "avatar_url": null },
        "reason": "Fraudulent listings.", "status": "open",
        "reviewed_by": null, "reviewed_at": null,
        "created_at": "...", "updated_at": "..."
      }
    ]
  }
}
```

---

## 9. Real-time Chat (Socket.io)s

### Overview

| Item | Value |
|------|-------|
| Library | Socket.io v4 |
| Namespace | `/chat` |
| Transport | WebSocket (falls back to polling) |
| Authentication | JWT access token on connect |

---

### 9.1 Connecting

Pass the access token in the `auth` object (preferred) or the `Authorization` header:

```javascript
// JavaScript / React Native
import { io } from 'socket.io-client';

const socket = io('http://<host>:<port>/chat', {
  auth: { token: accessToken },          // preferred
  // headers: { Authorization: `Bearer ${accessToken}` },  // alternative
  transports: ['websocket'],
});

socket.on('connect', () => console.log('Connected:', socket.id));
socket.on('disconnect', (reason) => console.log('Disconnected:', reason));
socket.on('error', ({ event, message }) => console.error(`[${event}]`, message));
```

```dart
// Flutter (socket_io_client)
final socket = io('http://<host>:<port>/chat', OptionBuilder()
  .setTransports(['websocket'])
  .setAuth({'token': accessToken})
  .build());
```

> If the token is missing or invalid the server immediately disconnects the client.

---

### 9.2 WebSocket Event Reference

#### Client → Server Events

**`conversation.join`**

Join a conversation room before sending messages. Required once per conversation session.

```javascript
// Request
socket.emit('conversation.join', { conversationId: 1 });

// Response (acknowledgement)
// { success: true, room: 'conversation:1' }
// OR on error: server emits 'error' event
```

On success, the server emits `conversation.joined` to the other member(s) already in the room:

```json
{
  "success": true,
  "conversationId": 1,
  "room": "conversation:1",
  "joinedAt": "2026-04-28T00:00:00.000Z"
}
```

| Field            | Type   | Required | Constraints |
|------------------|--------|----------|-------------|
| `conversationId` | number | yes      | ≥ 1, must be a participant |

---

**`message.send`**

Send a message. You must have joined the conversation room first.

```javascript
socket.emit('message.send', { conversationId: 1, text: 'Hello, is this still available?' });
// Response: { success: true, message: { ...MessageDto } }
// The server also broadcasts 'message.received' to all room participants
```

| Field            | Type   | Required | Constraints |
|------------------|--------|----------|-------------|
| `conversationId` | number | yes      | ≥ 1 |
| `text`           | string | yes      | 1–4000 chars |

---

**`message.read`**

Mark a message as read.

```javascript
socket.emit('message.read', { messageId: 42 });
// Response: { success: true, message: { ...MessageDto with read_at set } }
// The server also broadcasts 'message.read' to all room participants
```

| Field       | Type   | Required | Constraints |
|-------------|--------|----------|-------------|
| `messageId` | number | yes      | ≥ 1 |

---

#### Server → Client Events

**`message.received`** — Broadcast to room after `message.send`

```typescript
interface MessageDto {
  id: number;
  conversation_id: number;
  sender_id: number;
  message_text: string;
  sent_at: string;       // ISO 8601
  read_at: string | null;
}
```

```javascript
socket.on('message.received', ({ success, message }: { success: boolean; message: MessageDto }) => {
  // Append to local message list
});
```

**`message.read`** — Broadcast to room after `message.read` event

Same envelope shape with `message: MessageDto` and `read_at` populated.

```javascript
socket.on('message.read', ({ success, message }: { success: boolean; message: MessageDto }) => {
  // Update read status in local state
});
```

**`conversation.joined`** — Emitted to other room members after a participant successfully joins

```typescript
{
  success: true;
  conversationId: number;
  room: string;
  joinedAt: string;
}
```

**`error`** — Emitted on any WebSocket operation failure

```typescript
{ event: string; message: string }
```

```javascript
socket.on('error', ({ event, message }) => {
  console.error(`WebSocket error in [${event}]: ${message}`);
});
```

---

### 9.3 REST Complement for Chat

All REST chat endpoints require Bearer token.
REST responses follow global FK expansion. WebSocket event payloads keep the original scalar FK fields.

#### Create / Get Conversation

**`POST /chat/conversations`**

```json
{ "participantId": 12, "productId": 91 }
```

Returns the existing conversation if one already exists between the two users, or creates a new one.
`productId` is optional and sets/maintains product context on the user-pair conversation.

Response `201`:

```json
{
  "success": true,
  "statusCode": 201,
  "data": {
    "id": 1,
    "product": { "id": 91, "name": "iPhone 13", "price": "600.00", "status": "available", "city": "Cairo", "created_at": "2026-03-28T12:00:00.000Z" },
    "created_at": "2026-03-28T12:00:00.000Z",
    "peer_user": {
      "id": 12,
      "ssn": "98765432",
      "name": "Jana Ahmed",
      "phone": "+201000000012",
      "profileState": "active",
      "avatar_url": "https://res.cloudinary.com/example/image/upload/users/12/avatar.jpg"
    },
    "unread_count": 0,
    "product_name": "iPhone 13",
    "product_price": 600,
    "product_image_object_key": "products/91/cover.jpg"
  }
}
```

---

#### List Conversations

**`GET /chat/conversations`**

Optional query parameter:

| Parameter | Type | Default | Constraints |
|-----------|------|---------|-------------|
| `scope` | enum | `all` | `all` \| `buy` \| `sell` |

Response `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "data": [
    {
      "id": 1,
      "product": { "id": 91, "name": "iPhone 13", "price": "600.00", "status": "available", "city": "Cairo", "created_at": "2026-03-28T12:00:00.000Z" },
      "created_at": "...",
      "last_message": { "id": 15, "message_text": "Hello, is this still available?", "sent_at": "2026-03-28T13:00:00.000Z", "read_at": null },
      "last_message_text": "Hello, is this still available?",
      "last_message_sent_at": "2026-03-28T13:00:00.000Z",
      "peer_user": { "id": 12, "ssn": "98765432", "name": "Jana Ahmed", "phone": "+201000000012", "profileState": "active", "avatar_url": "https://res.cloudinary.com/example/image/upload/users/12/avatar.jpg" },
      "unread_count": 2,
      "product_name": "iPhone 13",
      "product_price": 600,
      "product_image_object_key": "products/91/cover.jpg"
    }
  ]
}
```

---

#### Get One Conversation

**`GET /chat/conversations/:id`**

Response `200`: same `conversation` metadata shape as create/list item.

---

#### List Messages (Cursor-Paginated)

**`GET /chat/conversations/:id/messages`**

| Query Param | Type   | Default | Constraints |
|-------------|--------|---------|-------------|
| `limit`     | number | 20      | 1–100 |
| `before`    | string | —       | ISO 8601 timestamp — return messages sent **before** this cursor |

Response `200` (newest-first):

```json
{
  "success": true,
  "statusCode": 200,
  "data": [
    {
      "id": 15,
      "conversation": { "id": 1, "created_at": "2026-03-28T12:00:00.000Z" },
      "sender": { "id": 3, "ssn": "11111111", "name": "Bob Buyer", "phone": "+201000000003", "profileState": "active", "avatar_url": null },
      "message_text": "Hello, is this still available?",
      "sent_at": "2026-03-28T13:00:00.000Z",
      "read_at": "2026-03-28T13:01:00.000Z"
    }
  ]
}
```

**Pagination usage:**

```javascript
// First page
GET /chat/conversations/1/messages?limit=20

// Next page — use sent_at of the oldest message in previous response
const cursor = messages[messages.length - 1].sent_at;
GET /chat/conversations/1/messages?limit=20&before=<cursor>
```

Error `403`: Not a participant. Error `404`: Conversation not found.

Hard-block behavior:
- If either user blocked the other, conversation access/send/read/create operations return `403` or hidden-not-found semantics depending on endpoint.

---

### 9.4 Recommended Chat Flow

```
1. POST /chat/conversations  → get/create conversationId (optionally with `productId`)
2. socket.emit('conversation.join', { conversationId })
3. Wait for join ack `{ success: true, room }` from `conversation.join`
4. GET /chat/conversations?scope=all|buy|sell  → load conversation list tabs
5. GET /chat/conversations/:id/messages  → load history
6. socket.on('message.received', ...)    → listen for new messages
7. socket.on('conversation.joined', ...) → observe remote participant join
8. socket.emit('message.send', ...)      → send messages
9. socket.emit('message.read', ...)      → mark read when user views
```

---

## 10. Admin (Privileged)

All endpoints in this section require a JWT token from a user account with `users.is_admin = true`. Calling these as a non-admin returns `403 Forbidden`.

### 10.0 Bootstrap First Admin (One-Time)

Set these env vars and run the one-time seed command:

```bash
export ADMIN_PHONE=+201000000000
export ADMIN_PASSWORD=ChangeMe123
npm run seed:admin
```

Then authenticate normally via `POST /auth/login`.

### 10.1 List Users

**`GET /admin/users`**

Query parameters:

| Parameter | Type   | Constraints |
|-----------|--------|-------------|
| `status`  | enum   | `active` \| `paused` \| `banned` |
| `q`       | string | 1–100 chars — search by name or phone |
| `limit`   | number | 1–100, default 50 |
| `offset`  | number | 0–10 000, default 0 |

Response `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "data": [
    {
      "id": 1,
      "ssn": "12345678",
      "name": "Ahmed Ali",
      "phone": "+201234567890",
      "profileState": "active",
      "is_admin": false,
      "created_at": "...",
      "updated_at": "..."
    }
  ]
}
```

---

### 10.2 Update User Status

**`PATCH /admin/users/:id/status`**

```json
{ "status": "banned" }
```

`status` enum: `active` | `paused` | `banned`

Response `200`: `AdminUserResponse`.

Error `404`: User not found.

---

### 10.3 Issue Warning

**`POST /admin/warnings`**

```json
{
  "targetUserId": 42,
  "message": "Your listing violated our terms of service."
}
```

| Field          | Type   | Required | Constraints |
|----------------|--------|----------|-------------|
| `targetUserId` | number | yes      | ≥ 1 |
| `message`      | string | yes      | 2–2000 chars |

Response `201`:

```json
{
  "success": true,
  "statusCode": 201,
  "data": {
    "warning": {
      "id": 1, "admin": { "id": 2, "name": "Primary Admin", "avatar_url": null }, "target_user": { "id": 42, "name": "Target User", "avatar_url": null },
      "message": "Your listing violated our terms of service.",
      "created_at": "..."
    }
  }
}
```

---

### 10.4 List Admins

**`GET /admin/admins`**

Response `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "admins": [
      {
        "id": 2,
        "name": "Primary Admin",
        "phone": "+201000000000",
        "status": "active",
        "is_admin": true,
        "created_at": "...",
        "updated_at": "..."
      }
    ]
  }
}
```

---

### 10.5 Promote User to Admin

**`POST /admin/admins/:id`**

Response `200`: Updated user object with `is_admin: true`.

---

### 10.6 Demote Admin

**`DELETE /admin/admins/:id`**

Response `200`: Updated user object with `is_admin: false`.

Error `400`: Admin cannot demote self.

---

### 10.7 List Reports

**`GET /admin/reports`**

Optional query parameter: `status` (`open` | `reviewing` | `resolved` | `rejected`)

Response `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "reports": [
      {
        "id": 1, "reporter": { "id": 3, "name": "Reporter User", "avatar_url": null }, "reported_user": { "id": 7, "name": "Reported User", "avatar_url": null },
        "reason": "Selling fake products.", "status": "open",
        "reviewed_by": null, "reviewed_at": null,
        "created_at": "...", "updated_at": "..."
      }
    ]
  }
}
```

---

### 10.8 Update Report Status

**`PATCH /admin/reports/:id`**

```json
{ "status": "resolved" }
```

`status` enum: `open` | `reviewing` | `resolved` | `rejected`

Response `200`: `AdminReportResponse`.

---

### 10.9 Create Category (Admin)

**`POST /admin/categories`**

```json
{
  "name": "Electronics",
  "parentId": 1
}
```

| Field      | Type   | Required | Constraints |
|------------|--------|----------|-------------|
| `name`     | string | yes      | 1–100 chars |
| `parentId` | number | no       | ≥ 1; if provided, parent category must exist |

Response `201`:

```json
{
  "success": true,
  "statusCode": 201,
  "data": {
    "category": {
      "id": 10,
      "parent": { "id": 1, "parent_id": null, "name": "Root", "created_at": "2026-03-28T12:00:00.000Z" },
      "name": "Electronics",
      "created_at": "2026-03-28T12:00:00.000Z"
    }
  }
}
```

Error `404`: Parent category not found.
Error `409`: Duplicate category name under the same parent.

---

### 10.10 Delete Category (Admin)

**`DELETE /admin/categories/:id`**

Response `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "category": {
      "id": 10,
      "parent": { "id": 1, "parent_id": null, "name": "Root", "created_at": "2026-03-28T12:00:00.000Z" },
      "name": "Electronics",
      "created_at": "2026-03-28T12:00:00.000Z"
    }
  }
}
```

Error `404`: Category not found.
Error `409`: Category has child categories or referenced products.

---

## 11. Error Reference

### Error Envelope

```json
{
  "success": false,
  "statusCode": 409,
  "data": null,
  "error": {
    "code":      409,
    "message":   "Human-readable message",
    "timestamp": "2026-03-28T12:00:00.000Z",
    "path":      "/auth/register"
  }
}
```

### HTTP Status Codes

| Code | Meaning | Common Causes | Client Action |
|------|---------|---------------|---------------|
| `400` | Bad Request | Validation failure, invalid/expired OTP, self-rating, passwords do not match, wrong current password | Show field errors to user |
| `401` | Unauthorized | Missing/invalid/expired access token, wrong password | Redirect to login or refresh token |
| `403` | Forbidden | Endpoint requires admin, or user is not the resource owner | Show "access denied" |
| `404` | Not Found | Resource ID doesn't exist, no pending registration | Show "not found" |
| `409` | Conflict | Duplicate phone/SSN on register, duplicate category name, admin already/not admin | Show conflict message |
| `429` | Too Many Requests | Rate limit exceeded | Back off and retry after delay |
| `503` | Service Unavailable | Database connection failed | Show maintenance message |

### Validation Errors (400)

When the validation pipe rejects a request, `error.message` contains a human-readable summary. The `error.code` is `400`.

---

## 12. Health Checks

Use these endpoints for mobile app startup checks and uptime monitoring.

### Liveness

**`GET /health/live`** — Always `200`

```json
{ "success": true, "statusCode": 200, "data": { "status": "ok" } }
```

### Readiness

**`GET /health/ready`** — `200` when DB is reachable; `503` when not

```json
{ "success": true, "statusCode": 200, "data": { "status": "ok" } }
```

Use `/health/ready` to gate app initialization: if the backend is not ready, show a "connecting…" state rather than failing silently.
