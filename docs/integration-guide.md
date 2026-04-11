# Market Place — Frontend & Mobile Integration Guide

> **Audience:** Web (React / Vue / Angular) and Mobile (React Native / Flutter) developers integrating with the Market Place backend.
>
> **Swagger UI (direct app):** `http://localhost:3000/api/docs`
>
> **Swagger UI (Docker + Nginx):** `http://localhost/api/docs`
>
> **Last verified:** `2026-04-11` against `openapi.json` and runtime sources in `src/` (controller/service behavior is authoritative).
>
> **Tip:** This guide documents every endpoint, payload shape, and validation rule derived directly from the source DTOs — use it as the single source of truth for client-side integration.

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

Every successful response contains at least `"success": true` plus a resource key:

```json
{ "success": true, "user": { ... } }
{ "success": true, "items": [ ... ] }
```

### Standard Error Envelope

All errors share this shape:

```json
{
  "success": false,
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

### Verification Matrix (2026-04-11)

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

---

## 2. Authentication

Access tokens expire in **15 minutes**. Refresh tokens expire in **30 days**. Use the refresh endpoint to obtain new tokens without re-authentication.

### TypeScript Interfaces

```typescript
interface AuthUser {
  id: number;
  phone: string;
}

interface TokenResponse {
  success: true;
  user?: AuthUser;       // present on register/verify and login
  accessToken: string;
  refreshToken: string;
}

interface OtpSentResponse {
  success: true;
  message: string;
  otp?: string;          // only when OTP_DEV_MODE=true on the server
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
{ "success": true, "message": "OTP sent" }
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
  "user": { "id": 1, "phone": "+201234567890" },
  "accessToken": "eyJ...",
  "refreshToken": "eyJ..."
}
```

Error `400`: Invalid or expired OTP.

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
  "accessToken": "eyJ...",
  "refreshToken": "eyJ..."
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
{ "success": true }
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

Response `201`: `OtpSentResponse`. If the phone is not found the server still returns `201` silently (security measure).

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
  "message": "Password reset successfully",
  "accessToken": "eyJ...",
  "refreshToken": "eyJ..."
}
```

Error `400`: Invalid or expired OTP.

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

All uploads follow a **3-step signed upload-intent pattern** — the file never passes through the API server.

```
Step 1: POST /files/upload-intent     → receive signed Cloudinary URL
Step 2: Use upload.method/url/fields  → upload file directly to Cloudinary
Step 3: PATCH /files/:id/mark-uploaded → confirm upload
```

Then use the returned `file.id` in subsequent API calls (e.g. `avatarFileId`, `imageFileIds`).

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
  file: UploadIntentFile;
  upload: UploadIntent;
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

Response `201`:

```json
{
  "success": true,
  "file": {
    "id": 42,
    "objectKey": "products/5/photo.jpg",
    "status": "pending"
  },
  "upload": {
    "method": "POST",
    "url": "https://api.cloudinary.com/v1_1/example/auto/upload",
    "expiresAt": "2026-03-28T12:15:00.000Z",
    "fields": {
      "api_key": "...",
      "public_id": "products/5/photo.jpg",
      "timestamp": "1711622400",
      "signature": "..."
    }
  }
}
```

---

### Step 2 — Upload to Cloudinary

Use `upload.method`, `upload.url`, `upload.headers`, and `upload.fields` from the Step 1 response.

```javascript
// Example (Cloudinary signed POST)
const form = new FormData();
for (const [key, value] of Object.entries(upload.fields ?? {})) {
  form.append(key, value);
}
form.append('file', fileBlob);

await fetch(upload.url, {
  method: upload.method,              // runtime currently 'POST'
  headers: upload.headers ?? {},
  body: form,
});
```

> The upload intent expires at `upload.expiresAt` (default ~10 minutes). Do not cache it.

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
  "file": { "id": 42, "objectKey": "products/5/photo.jpg", "status": "uploaded" }
}
```

---

### Get File Metadata

**`GET /files/:id`** — Requires Bearer token

Response `200`:

```json
{
  "success": true,
  "file": {
    "id": 42,
    "uploader_user_id": 5,
    "owner_type": "product",
    "owner_id": 5,
    "purpose": "product_image",
    "object_key": "products/5/photo.jpg",
    "mime_type": "image/jpeg",
    "file_size_bytes": 204800,
    "status": "uploaded",
    "created_at": "2026-03-28T12:00:00.000Z",
    "uploaded_at": "2026-03-28T12:05:00.000Z",
    "readUrl": "https://res.cloudinary.com/example/image/upload/products/5/photo.jpg"
  }
}
```

---

## 4. Users & Profile

All endpoints in this section require `Authorization: Bearer <accessToken>`.

### TypeScript Interfaces

```typescript
interface User {
  id: number;
  name: string;
  phone: string;
  status: 'active' | 'paused' | 'banned';
  rate: string;           // e.g. "4.50" — average seller rating
  avatar_url: string | null;
}

interface Contact {
  id: number;
  type: 'phone' | 'email' | 'address';
  value: string;
  city: string | null;    // populated for type='address'
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}
```

---

### 4.1 Get Current User Profile

**`GET /me`**

Response `200`:

```json
{
  "success": true,
  "user": {
    "id": 1,
    "name": "Ahmed Ali",
    "phone": "+201234567890",
    "status": "active",
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
{ "success": true, "message": "Password changed successfully" }
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
  "contacts": [
    {
      "id": 1,
      "type": "phone",
      "value": "+201234567890",
      "city": null,
      "is_primary": true,
      "created_at": "2026-03-28T12:00:00.000Z",
      "updated_at": "2026-03-28T12:00:00.000Z"
    }
  ]
}
```

---

### 4.5 Add Contact

**`POST /me/contacts`**

```json
{
  "type":      "address",
  "value":     "15 Tahrir Square, Downtown Cairo",
  "city":      "Cairo",
  "isPrimary": true
}
```

| Field       | Type    | Required | Constraints |
|-------------|---------|----------|-------------|
| `type`      | enum    | yes      | `phone` \| `email` \| `address` |
| `value`     | string  | yes      | 1–255 chars |
| `city`      | string  | no       | 1–255 chars — recommended when `type=address` |
| `isPrimary` | boolean | no       | Set as primary contact of this type |

Response `201`: `ContactResponse`.

---

### 4.6 Update Contact

**`PATCH /me/contacts/:id`**

```json
{ "value": "+201111111111", "city": "Alexandria", "isPrimary": false }
```

All fields optional (same constraints as create). Response `200`: `ContactResponse`.

Error `404`: Contact not found or not owned by current user.

---

### 4.7 Delete Contact

**`DELETE /me/contacts/:id`**

Response `200`:

```json
{ "success": true, "message": "Contact deleted" }
```

---

## 5. Products

### TypeScript Interfaces

```typescript
interface ProductImage {
  id: number;
  file_id: number;
  sort_order: number;
  object_key: string;
  status: 'pending' | 'uploaded' | 'failed' | 'deleted';
}

interface Product {
  id: number;
  owner_id: number;
  category_id: number;
  name: string;
  description: string | null;
  price: number;
  city: string;
  address_text: string | null;
  status: 'available' | 'sold' | 'archived';
  created_at: string;
  updated_at: string;
  seller_rate?: string | null;  // only in search results
  images: ProductImage[];
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
| `imageFileIds` | number[] | no       | Up to **10** pre-uploaded file IDs |

> **Image upload flow:** Upload each image via the Files API first (purpose = `product_image`), collect the returned `file.id` values, then pass them as `imageFileIds` here.

Response `201`: `ProductResponse`.

Error `400`: Invalid category or file references.

---

### 5.2 Get Product

**`GET /products/:id`** — Public. Rate limit: 120 req/min

Response `200`: `ProductResponse`.

Error `404`: Product not found.

---

### 5.3 Update Product

**`PATCH /products/:id`** — Requires Bearer token (must be owner)

All fields optional, same constraints as create. Passing `imageFileIds` **replaces** the full image set.

Response `200`: `ProductResponse`.

Error `403`: Not the product owner. Error `404`: Not found.

---

### 5.4 Delete Product (Soft Delete)

**`DELETE /products/:id`** — Requires Bearer token (must be owner)

Response `200`:

```json
{ "success": true, "message": "Product deleted" }
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
  "product": { "id": 1, "status": "sold", "updated_at": "2026-03-28T12:00:00.000Z" }
}
```

---

### 5.6 Search Products

**`GET /search/products`** — Public. Rate limit: 60 req/min

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
  "items": [
    {
      "id": 1,
      "owner_id": 5,
      "category_id": 3,
      "name": "iPhone 14 Pro Max",
      "description": "Excellent condition.",
      "price": 1500,
      "city": "Cairo",
      "address_text": "15 Tahrir Square",
      "status": "available",
      "created_at": "2026-03-28T12:00:00.000Z",
      "updated_at": "2026-03-28T12:00:00.000Z",
      "seller_rate": "4.50",
      "images": [{ "id": 1, "file_id": 10, "sort_order": 0, "object_key": "products/1/img.jpg", "status": "uploaded" }]
    }
  ]
}
```

> `seller_rate` is only included in search/list results, not in single-product GET.

---

### 5.7 List My Products

**`GET /my/products`** — Requires Bearer token

Accepts all the same query parameters as search, plus:

| Parameter | Type | Default | Constraints |
|-----------|------|---------|-------------|
| `status`  | enum | —       | `available` \| `sold` \| `archived` |

Response `200`: Same `ProductListResponse` shape as search.

---

## 6. Categories

### 6.1 List All Categories

**`GET /categories`** — Public

Response `200`:

```json
{
  "success": true,
  "categories": [
    { "id": 1, "parent_id": null, "name": "Electronics", "created_at": "2026-03-28T12:00:00.000Z" },
    { "id": 2, "parent_id": 1,    "name": "Phones",       "created_at": "2026-03-28T12:00:00.000Z" },
    { "id": 3, "parent_id": 1,    "name": "Laptops",      "created_at": "2026-03-28T12:00:00.000Z" }
  ]
}
```

The list is **flat**. Reconstruct the tree by grouping on `parent_id` (`null` = root category). Use leaf category IDs (those with no children) when creating products.

### TypeScript Tree-Builder Snippet

```typescript
interface Category {
  id: number;
  parent_id: number | null;
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
    if (node.parent_id === null) roots.push(node);
    else map.get(node.parent_id)?.children.push(node);
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
  rater_id: number;
  rated_user_id: number;
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
  "rating": {
    "id": 1, "rater_id": 5, "rated_user_id": 15,
    "rating_value": 4, "comment": "Great seller, fast shipping!",
    "created_at": "...", "updated_at": "..."
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
  "summary": { "avg_rating": "4.50", "ratings_count": 12 },
  "ratings": [
    { "id": 1, "rater_id": 5, "rated_user_id": 15, "rating_value": 4, "comment": "...", "created_at": "...", "updated_at": "..." }
  ]
}
```

Error `404`: User not found.

---

## 8. Reports

### TypeScript Interface

```typescript
interface Report {
  id: number;
  reporter_id: number;
  reported_user_id: number;
  reason: string;
  status: 'open' | 'reviewing' | 'resolved' | 'rejected';
  reviewed_by: number | null;
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

Error `409`: A report against this user has already been filed by you.
Error `400`: Attempting to report yourself.
Error `404`: Reported user not found.

---

### 8.2 List My Reports

**`GET /reports/me`** — Requires Bearer token

Response `200`:

```json
{
  "success": true,
  "reports": [
    {
      "id": 1, "reporter_id": 3, "reported_user_id": 20,
      "reason": "Fraudulent listings.", "status": "open",
      "reviewed_by": null, "reviewed_at": null,
      "created_at": "...", "updated_at": "..."
    }
  ]
}
```

---

## 9. Real-time Chat (Socket.io)

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
socket.on('message.received', (message: MessageDto) => {
  // Append to local message list
});
```

**`message.read`** — Broadcast to room after `message.read` event

Same `MessageDto` shape with `read_at` populated.

```javascript
socket.on('message.read', (message: MessageDto) => {
  // Update read status in local state
});
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

#### Create / Get Conversation

**`POST /chat/conversations`**

```json
{ "participantId": 12 }
```

Returns the existing conversation if one already exists between the two users, or creates a new one.

Response `201`:

```json
{
  "success": true,
  "conversation": {
    "id": 1,
    "user_a_id": 3,
    "user_b_id": 12,
    "created_at": "2026-03-28T12:00:00.000Z"
  }
}
```

---

#### List Conversations

**`GET /chat/conversations`**

Response `200`:

```json
{
  "success": true,
  "conversations": [
    {
      "id": 1,
      "user_a_id": 3,
      "user_b_id": 12,
      "created_at": "...",
      "last_message_id": 15,
      "last_message_text": "Hello, is this still available?",
      "last_message_sent_at": "2026-03-28T13:00:00.000Z"
    }
  ]
}
```

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
  "messages": [
    {
      "id": 15,
      "conversation_id": 1,
      "sender_id": 3,
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

---

### 9.4 Recommended Chat Flow

```
1. POST /chat/conversations  → get/create conversationId
2. socket.emit('conversation.join', { conversationId })
3. GET /chat/conversations/:id/messages  → load history
4. socket.on('message.received', ...)    → listen for new messages
5. socket.emit('message.send', ...)      → send messages
6. socket.emit('message.read', ...)      → mark read when user views
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
  "users": [
    {
      "id": 1,
      "name": "Ahmed Ali",
      "phone": "+201234567890",
      "status": "active",
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
  "warning": {
    "id": 1, "admin_id": 2, "target_user_id": 42,
    "message": "Your listing violated our terms of service.",
    "created_at": "..."
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
  "reports": [
    {
      "id": 1, "reporter_id": 3, "reported_user_id": 7,
      "reason": "Selling fake products.", "status": "open",
      "reviewed_by": null, "reviewed_at": null,
      "created_at": "...", "updated_at": "..."
    }
  ]
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
  "category": {
    "id": 10,
    "parent_id": 1,
    "name": "Electronics",
    "created_at": "2026-03-28T12:00:00.000Z"
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
  "category": {
    "id": 10,
    "parent_id": 1,
    "name": "Electronics",
    "created_at": "2026-03-28T12:00:00.000Z"
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
| `400` | Bad Request | Validation failure, invalid/expired OTP, self-rating, wrong current password | Show field errors to user |
| `401` | Unauthorized | Missing/invalid/expired access token, wrong password | Redirect to login or refresh token |
| `403` | Forbidden | Endpoint requires admin, or user is not the resource owner | Show "access denied" |
| `404` | Not Found | Resource ID doesn't exist, no pending registration | Show "not found" |
| `409` | Conflict | Duplicate phone/SSN on register, duplicate report | Show conflict message |
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
{ "status": "ok" }
```

### Readiness

**`GET /health/ready`** — `200` when DB is reachable; `503` when not

```json
{ "status": "ok" }
```

Use `/health/ready` to gate app initialization: if the backend is not ready, show a "connecting…" state rather than failing silently.
