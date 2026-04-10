# Database Schema (PostgreSQL, Arabic-Ready)

This document defines the v1 database implementation for the Online Market system.

## 1) Scope

The schema covers the full SRS:
- Auth: registration/login/password reset (OTP support)
- Profile and contact info
- Products and search/filter/sort
- Chat
- Ratings and reports
- Admin user moderation and warnings

## 2) Arabic + Storage Support

- Database target: PostgreSQL with `UTF8` encoding.
- Text fields use `text`/`varchar` and accept Arabic or English values in the same column.
- No split `ar/en` columns in v1.
- Address model remains simple: `city` + `address_text`.
- Storage model: signed URLs are used for uploads only.
  - Canonical upload metadata lives in `files`.
  - Current app reads should resolve media from `users.avatar_file_id` and `product_images.file_id`.
  - Legacy key columns are kept temporarily for migration/backfill compatibility.

## 3) Files

- Main schema: `db/schema.sql`
- Validation checks: `db/validate.sql`

## 4) How To Apply

```bash
# 1) create utf8 database (example)
createdb market_place_db --encoding=UTF8

# 2) apply schema
psql -d market_place_db -f db/schema.sql

# 3) run validation script
psql -d market_place_db -f db/validate.sql
```

## 5) Implemented Entities

- Enums:
  - `user_status`, `product_status`, `report_status`, `contact_type`
  - `file_status`, `file_purpose`
- Tables:
  - `users`
  - `user_contacts`
  - `auth_otps`
  - `files`
  - `categories`
  - `products`
  - `product_images`
  - `conversations`
  - `messages`
  - `user_ratings`
  - `user_reports`
  - `admin_warnings`
- View: `product_listing_view` (includes computed `seller_rate`)

## 6) Key Constraints and Indexes

- Uniques:
  - `users.phone` (unique)
  - `users.ssn` (unique)
  - `(user_a_id, user_b_id)` in `conversations`
  - `(rater_id, rated_user_id)` in `user_ratings`
  - partial unique email index on `user_contacts` (`type='email'`)
  - sibling category name unique (case-insensitive): `(COALESCE(parent_id,0), LOWER(name))`
  - file object key scope unique: `(storage_provider, COALESCE(bucket,''), object_key)`
- Checks:
  - `user_ratings.rating_value` in `1..5`
  - `products.price >= 0`
  - `conversations.user_a_id < user_b_id`
  - `categories.parent_id <> id` (no self-parent)
  - `files.file_size_bytes >= 0` when provided
  - `files.owner_id > 0` when provided
  - `files.object_key` must be non-empty
  - status timestamp checks (`uploaded_at` for `uploaded`, etc.)
- Trigger rule:
  - products must reference a leaf category (`trg_products_leaf_category`)
- Filter/search indexes:
  - `products(category_id, status, created_at)`
  - `products(price)`
  - `products(city)`
  - `messages(conversation_id, sent_at)`
  - `user_reports(status, created_at)`
  - `categories(parent_id)`
  - `files(owner_type, owner_id, purpose)`
  - `files(uploader_user_id, created_at)`
  - `files(status, created_at)`
  - GIN text-search index on product name + description

## 7) Table Attributes

### 7.1 `users`

SRS mapping: AUTH registration/login/reset, profile display/edit, admin account status control.

| column_name | data_type | nullable | default | key/constraint | description |
|---|---|---|---|---|---|
| id | BIGINT | No | identity | PK | Internal user identifier. |
| name | VARCHAR(150) | No | - | - | Display name; supports Arabic/English text in one field. |
| ssn | VARCHAR(32) | No | - | UNIQUE | National ID/SSN for user verification. |
| phone | VARCHAR(32) | No | - | UNIQUE | Primary login identity (phone number). |
| password_hash | TEXT | No | - | - | Hashed password only (never plain text). |
| avatar_file_id | BIGINT | Yes | NULL | FK -> `files.id` (`ON DELETE SET NULL`) | Canonical avatar file reference. |
| avatar_object_key | TEXT | Yes | NULL | Legacy | Legacy object key retained during migration. |
| status | `user_status` | No | `active` | ENUM (`active`,`paused`,`banned`) | Account moderation status. |
| created_at | TIMESTAMPTZ | No | `now()` | - | Account creation time. |
| updated_at | TIMESTAMPTZ | No | `now()` | - | Last update timestamp (app-managed). |

### 7.2 `user_contacts`

SRS mapping: profile contact info management (phone/email/address).

| column_name | data_type | nullable | default | key/constraint | description |
|---|---|---|---|---|---|
| id | BIGINT | No | identity | PK | Contact record identifier. |
| user_id | BIGINT | No | - | FK -> `users.id` (`ON DELETE CASCADE`) | Owner user id. |
| type | `contact_type` | No | - | ENUM (`phone`,`email`,`address`) | Contact channel type. |
| value | TEXT | No | - | Partial UNIQUE for email (`LOWER(value)`) when `type='email'` | Actual contact value; supports Arabic/English. |
| city | TEXT | Yes | NULL | - | Optional city for address/contact context; Arabic-friendly free text. |
| is_primary | BOOLEAN | No | `false` | UNIQUE partial (`user_id`,`type`) when true | Marks one primary contact per user and type. |
| created_at | TIMESTAMPTZ | No | `now()` | - | Creation time. |
| updated_at | TIMESTAMPTZ | No | `now()` | - | Last update time. |

### 7.3 `auth_otps`

SRS mapping: OTP during registration and forget-password/reset.

| column_name | data_type | nullable | default | key/constraint | description |
|---|---|---|---|---|---|
| id | BIGINT | No | identity | PK | OTP row identifier. |
| user_id | BIGINT | Yes | NULL | FK -> `users.id` (`ON DELETE SET NULL`) | Linked user when known; NULL allowed for pre-registration/reset starts. |
| phone | VARCHAR(32) | No | - | Indexed with purpose/time | Target phone for OTP. |
| code_hash | TEXT | No | - | - | Hashed OTP code. |
| purpose | TEXT | No | - | CHECK in (`registration`,`password_reset`) | OTP use case. |
| expires_at | TIMESTAMPTZ | No | - | - | Expiration timestamp. |
| used_at | TIMESTAMPTZ | Yes | NULL | - | When OTP was consumed. |
| created_at | TIMESTAMPTZ | No | `now()` | - | OTP creation time. |

### 7.4 `files`

SRS mapping: upload metadata, storage object registry, upload lifecycle tracking.

| column_name | data_type | nullable | default | key/constraint | description |
|---|---|---|---|---|---|
| id | BIGINT | No | identity | PK | File identifier. |
| uploader_user_id | BIGINT | Yes | NULL | FK -> `users.id` (`ON DELETE SET NULL`) | User who initiated upload. |
| owner_type | TEXT | No | - | CHECK in (`user`,`product`,`message`) | Owning domain entity type. |
| owner_id | BIGINT | Yes | NULL | CHECK `owner_id > 0` when set | Owning entity identifier. |
| purpose | `file_purpose` | No | - | ENUM (`avatar`,`product_image`,`chat_attachment`,`document`) | File business purpose. |
| storage_provider | TEXT | No | `r2` | - | Storage backend identifier. |
| bucket | TEXT | Yes | NULL | - | Storage bucket/container name. |
| object_key | TEXT | No | - | UNIQUE scope with provider/bucket, non-empty CHECK | Stable object key used for upload/read flow. |
| original_filename | TEXT | Yes | NULL | - | Original client filename. |
| mime_type | TEXT | Yes | NULL | - | Content type (`image/jpeg`, etc.). |
| file_size_bytes | BIGINT | Yes | NULL | CHECK `>= 0` when set | File size in bytes. |
| checksum_sha256 | TEXT | Yes | NULL | - | Optional integrity checksum. |
| status | `file_status` | No | `pending` | ENUM (`pending`,`uploaded`,`failed`,`deleted`) | Upload lifecycle status. |
| uploaded_at | TIMESTAMPTZ | Yes | NULL | CHECK required when `status='uploaded'` | Upload completion timestamp. |
| failed_at | TIMESTAMPTZ | Yes | NULL | CHECK required when `status='failed'` | Upload failure timestamp. |
| deleted_at | TIMESTAMPTZ | Yes | NULL | CHECK required when `status='deleted'` | Logical deletion timestamp. |
| created_at | TIMESTAMPTZ | No | `now()` | Indexed | Creation timestamp. |
| updated_at | TIMESTAMPTZ | No | `now()` | - | Last update timestamp (app-managed). |

### 7.5 `categories`

SRS mapping: product category assignment, subcategories, and search filtering.

| column_name | data_type | nullable | default | key/constraint | description |
|---|---|---|---|---|---|
| id | BIGINT | No | identity | PK | Category identifier. |
| parent_id | BIGINT | Yes | NULL | FK -> `categories.id` (`ON DELETE RESTRICT`), CHECK `parent_id <> id` | Parent category id; NULL means root category. |
| name | TEXT | No | - | Unique among siblings (case-insensitive) | Category display name; supports Arabic/English. |
| created_at | TIMESTAMPTZ | No | `now()` | - | Creation timestamp. |

### 7.6 `products`

SRS mapping: add/update/delete product, mark sold/available, my products, search and filters.

| column_name | data_type | nullable | default | key/constraint | description |
|---|---|---|---|---|---|
| id | BIGINT | No | identity | PK | Product identifier. |
| owner_id | BIGINT | No | - | FK -> `users.id` (`ON DELETE CASCADE`) | Seller/owner id. |
| category_id | BIGINT | No | - | FK -> `categories.id` (`ON DELETE RESTRICT`), trigger-enforced leaf | Selected leaf category id. |
| name | TEXT | No | - | Full-text indexed | Product name; supports Arabic/English in one field. |
| description | TEXT | No | - | Full-text indexed | Product description; supports Arabic/English in one field. |
| price | NUMERIC(12,2) | No | - | CHECK `price >= 0` | Listed price. |
| city | TEXT | No | - | Indexed | User-entered city (Arabic-friendly). |
| address_text | TEXT | No | - | - | Simple free-form delivery/address text (Arabic-friendly). |
| status | `product_status` | No | `available` | ENUM (`available`,`sold`,`archived`) | Product lifecycle state. |
| created_at | TIMESTAMPTZ | No | `now()` | Indexed in composite | Creation timestamp. |
| updated_at | TIMESTAMPTZ | No | `now()` | - | Last update timestamp (app-managed). |

### 7.7 `product_images`

SRS mapping: product image ordering linked to canonical file records.

| column_name | data_type | nullable | default | key/constraint | description |
|---|---|---|---|---|---|
| id | BIGINT | No | identity | PK | Product image row id. |
| product_id | BIGINT | No | - | FK -> `products.id` (`ON DELETE CASCADE`) | Related product id. |
| file_id | BIGINT | No | - | FK -> `files.id` (`ON DELETE CASCADE`) | Canonical file reference for this image. |
| object_key | TEXT | No | - | Legacy | Legacy object key retained during migration. |
| mime_type | TEXT | Yes | NULL | - | Optional media content type. |
| file_size_bytes | BIGINT | Yes | NULL | CHECK `>= 0` when set | Optional file size metadata. |
| sort_order | INT | No | `0` | CHECK `sort_order >= 0`, UNIQUE (`product_id`,`sort_order`) | Display order per product. |
| created_at | TIMESTAMPTZ | No | `now()` | - | Creation timestamp. |

### 7.8 `conversations`

SRS mapping: chat threads between two users.

| column_name | data_type | nullable | default | key/constraint | description |
|---|---|---|---|---|---|
| id | BIGINT | No | identity | PK | Conversation identifier. |
| user_a_id | BIGINT | No | - | FK -> `users.id` (`ON DELETE CASCADE`) | First participant id. |
| user_b_id | BIGINT | No | - | FK -> `users.id` (`ON DELETE CASCADE`) | Second participant id. |
| created_at | TIMESTAMPTZ | No | `now()` | - | Conversation creation time. |

### 7.9 `messages`

SRS mapping: real-time user messages.

| column_name | data_type | nullable | default | key/constraint | description |
|---|---|---|---|---|---|
| id | BIGINT | No | identity | PK | Message identifier. |
| conversation_id | BIGINT | No | - | FK -> `conversations.id` (`ON DELETE CASCADE`) | Parent conversation id. |
| sender_id | BIGINT | No | - | FK -> `users.id` (`ON DELETE CASCADE`) | User who sent the message. |
| message_text | TEXT | No | - | CHECK `length(btrim(message_text)) > 0` | Message body; supports Arabic/English text. |
| sent_at | TIMESTAMPTZ | No | `now()` | Indexed with conversation_id | Send timestamp. |
| read_at | TIMESTAMPTZ | Yes | NULL | - | Read receipt time (optional). |

### 7.10 `user_ratings`

SRS mapping: user-to-user rating with comment.

| column_name | data_type | nullable | default | key/constraint | description |
|---|---|---|---|---|---|
| id | BIGINT | No | identity | PK | Rating row id. |
| rater_id | BIGINT | No | - | FK -> `users.id` (`ON DELETE CASCADE`) | User giving rating. |
| rated_user_id | BIGINT | No | - | FK -> `users.id` (`ON DELETE CASCADE`) | User receiving rating. |
| rating_value | SMALLINT | No | - | CHECK `BETWEEN 1 AND 5` | Rating score 1..5. |
| comment | TEXT | Yes | NULL | - | Optional rating comment; Arabic/English allowed. |
| created_at | TIMESTAMPTZ | No | `now()` | - | Creation timestamp. |
| updated_at | TIMESTAMPTZ | No | `now()` | - | Last update timestamp (app-managed). |

### 7.11 `user_reports`

SRS mapping: report users to admins and reports review workflow.

| column_name | data_type | nullable | default | key/constraint | description |
|---|---|---|---|---|---|
| id | BIGINT | No | identity | PK | Report id. |
| reporter_id | BIGINT | No | - | FK -> `users.id` (`ON DELETE CASCADE`) | User submitting report. |
| reported_user_id | BIGINT | No | - | FK -> `users.id` (`ON DELETE CASCADE`) | User being reported. |
| reason | TEXT | No | - | - | Report reason text; Arabic/English allowed. |
| status | `report_status` | No | `open` | ENUM (`open`,`reviewing`,`resolved`,`rejected`) | Review state. |
| reviewed_by | BIGINT | Yes | NULL | FK -> `users.id` (`ON DELETE SET NULL`) | Admin reviewer user id. |
| reviewed_at | TIMESTAMPTZ | Yes | NULL | - | Review completion/update time. |
| created_at | TIMESTAMPTZ | No | `now()` | Indexed with status | Creation time. |
| updated_at | TIMESTAMPTZ | No | `now()` | - | Last update time (app-managed). |

### 7.12 `admin_warnings`

SRS mapping: admin warnings to users.

| column_name | data_type | nullable | default | key/constraint | description |
|---|---|---|---|---|---|
| id | BIGINT | No | identity | PK | Warning id. |
| admin_id | BIGINT | Yes | NULL | FK -> `users.id` (`ON DELETE SET NULL`) | Admin who issued warning. |
| target_user_id | BIGINT | Yes | NULL | FK -> `users.id` (`ON DELETE SET NULL`) | User who received warning. |
| message | TEXT | No | - | - | Warning message text; Arabic/English allowed. |
| created_at | TIMESTAMPTZ | No | `now()` | Indexed with target_user_id | Warning creation timestamp. |

## 8) Notes

- `updated_at` fields default to `now()`; automatic update triggers are intentionally not included to keep v1 simple.
- Category hierarchy supports deep nesting, and products must select a leaf category.
- Signed URLs are upload-only and should be generated at application/service layer.
- Migration strategy for media:
  1. Backfill `files` rows from legacy keys.
  2. Populate `users.avatar_file_id` and `product_images.file_id`.
  3. Switch reads to file-based joins.
  4. Drop legacy `*_object_key` columns in a follow-up migration.
