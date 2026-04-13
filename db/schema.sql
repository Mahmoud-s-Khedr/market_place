-- Simple PostgreSQL schema for the Online Market project
-- Arabic-ready by default: store user/product text in UTF-8 text/varchar columns.
-- Storage model: signed URLs are for upload only; DB stores stable object keys.
-- Ensure your database was created with ENCODING 'UTF8'.

BEGIN;

-- ---------- Enums ----------
CREATE TYPE user_status AS ENUM ('active', 'paused', 'banned');
CREATE TYPE product_status AS ENUM ('available', 'sold', 'archived');
CREATE TYPE report_status AS ENUM ('open', 'reviewing', 'resolved', 'rejected');
CREATE TYPE file_status AS ENUM ('pending', 'uploaded', 'failed', 'deleted');
CREATE TYPE file_purpose AS ENUM ('avatar', 'product_image', 'chat_attachment', 'document');

-- ---------- Core user/account tables ----------
CREATE TABLE users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    ssn VARCHAR(32) NOT NULL UNIQUE,
    phone VARCHAR(32) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    -- New canonical relation to files table.
    avatar_file_id BIGINT,
    -- Legacy field kept temporarily for migration/backfill compatibility.
    avatar_object_key TEXT,
    status user_status NOT NULL DEFAULT 'active',
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    token_version INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_contacts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_type TEXT NOT NULL,
    value TEXT NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Optional unique partial index for emails.
CREATE UNIQUE INDEX user_contacts_unique_email
    ON user_contacts (LOWER(value))
    WHERE contact_type = 'email';

CREATE INDEX user_contacts_user_type_idx ON user_contacts (user_id, contact_type);
CREATE UNIQUE INDEX user_contacts_primary_per_type_idx
    ON user_contacts (user_id, contact_type)
    WHERE is_primary = TRUE;

CREATE TABLE auth_otps (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    phone VARCHAR(32) NOT NULL,
    code_hash TEXT NOT NULL,
    salt TEXT NOT NULL DEFAULT '',
    purpose TEXT NOT NULL CHECK (purpose IN ('registration', 'password_reset')),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX auth_otps_phone_purpose_created_idx
    ON auth_otps (phone, purpose, created_at DESC);

CREATE TABLE auth_otp_attempts (
    phone VARCHAR(32) NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('registration', 'password_reset')),
    attempts INTEGER NOT NULL CHECK (attempts >= 0),
    expires_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (phone, purpose)
);

CREATE INDEX auth_otp_attempts_expires_idx
    ON auth_otp_attempts (expires_at);

CREATE TABLE auth_refresh_tokens (
    jti TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX auth_refresh_tokens_user_idx
    ON auth_refresh_tokens (user_id, created_at DESC);
CREATE INDEX auth_refresh_tokens_expires_idx
    ON auth_refresh_tokens (expires_at);

-- Staging table for registrations awaiting OTP verification.
-- Rows are promoted to users on verify, or swept by cleanup task on expiry.
CREATE TABLE pending_registrations (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    phone         VARCHAR(32)  NOT NULL,
    ssn           VARCHAR(32)  NOT NULL,
    name          VARCHAR(150) NOT NULL,
    password_hash TEXT         NOT NULL,
    expires_at    TIMESTAMPTZ  NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX pending_registrations_phone_idx
    ON pending_registrations (phone, expires_at DESC);

CREATE UNIQUE INDEX pending_registrations_phone_unique_idx
    ON pending_registrations (phone);

CREATE UNIQUE INDEX pending_registrations_ssn_unique_idx
    ON pending_registrations (ssn);

-- Central files table (source of truth for uploaded media metadata).
CREATE TABLE files (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uploader_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    owner_type TEXT NOT NULL CHECK (owner_type IN ('user', 'product', 'message')),
    owner_id BIGINT,
    purpose file_purpose NOT NULL,
    storage_provider TEXT NOT NULL DEFAULT 'r2',
    bucket TEXT,
    object_key TEXT NOT NULL,
    original_filename TEXT,
    mime_type TEXT,
    file_size_bytes BIGINT CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
    checksum_sha256 TEXT,
    status file_status NOT NULL DEFAULT 'pending',
    uploaded_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (LENGTH(BTRIM(object_key)) > 0),
    CHECK (owner_id IS NULL OR owner_id > 0),
    CHECK (status <> 'uploaded' OR uploaded_at IS NOT NULL),
    CHECK (status <> 'failed' OR failed_at IS NOT NULL),
    CHECK (status <> 'deleted' OR deleted_at IS NOT NULL)
);

CREATE UNIQUE INDEX files_provider_bucket_object_key_unique_idx
    ON files (storage_provider, COALESCE(bucket, ''), object_key);
CREATE INDEX files_owner_lookup_idx ON files (owner_type, owner_id, purpose);
CREATE INDEX files_uploader_created_idx ON files (uploader_user_id, created_at DESC);
CREATE INDEX files_status_created_idx ON files (status, created_at DESC);

ALTER TABLE users
    ADD CONSTRAINT users_avatar_file_id_fkey
    FOREIGN KEY (avatar_file_id) REFERENCES files(id) ON DELETE SET NULL;

-- ---------- Product/catalog tables ----------
CREATE TABLE categories (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    parent_id BIGINT REFERENCES categories(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (parent_id IS NULL OR parent_id <> id)
);

-- Unique category name among siblings (case-insensitive).
CREATE UNIQUE INDEX categories_sibling_name_unique_idx
    ON categories (COALESCE(parent_id, 0), LOWER(name));
CREATE INDEX categories_parent_id_idx ON categories (parent_id);

CREATE TABLE products (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id BIGINT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
    city TEXT NOT NULL,
    address_text TEXT NOT NULL,
    details JSONB,
    status product_status NOT NULL DEFAULT 'available',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE TABLE product_images (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    file_id BIGINT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    -- Legacy field kept temporarily for migration/backfill compatibility.
    object_key TEXT NOT NULL,
    mime_type TEXT,
    file_size_bytes BIGINT CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
    sort_order INT NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (product_id, sort_order)
);

CREATE INDEX product_images_product_id_idx ON product_images (product_id, sort_order);

-- Enforce that products can only reference leaf categories.
CREATE OR REPLACE FUNCTION enforce_leaf_category_for_product()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM categories c
        WHERE c.parent_id = NEW.category_id
        LIMIT 1
    ) THEN
        RAISE EXCEPTION 'Product category_id % must reference a leaf category', NEW.category_id;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_products_leaf_category
BEFORE INSERT OR UPDATE OF category_id ON products
FOR EACH ROW
EXECUTE FUNCTION enforce_leaf_category_for_product();

-- Search/filter indexes.
CREATE INDEX products_category_status_created_idx
    ON products (category_id, status, created_at DESC);
CREATE INDEX products_price_idx ON products (price);
CREATE INDEX products_city_idx ON products (city);

-- Optional text-search index (language-agnostic simple dictionary).
CREATE INDEX products_search_tsv_idx
    ON products
    USING GIN (to_tsvector('simple', COALESCE(name, '') || ' ' || COALESCE(description, '')));

-- ---------- Chat tables ----------
CREATE TABLE conversations (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_a_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_message_id BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (user_a_id < user_b_id),
    UNIQUE (user_a_id, user_b_id)
);

CREATE TABLE messages (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_text TEXT NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_at TIMESTAMPTZ,
    CHECK (LENGTH(BTRIM(message_text)) > 0)
);

CREATE INDEX messages_conversation_sent_idx
    ON messages (conversation_id, sent_at DESC);

ALTER TABLE conversations
    ADD CONSTRAINT conversations_last_message_id_fkey
    FOREIGN KEY (last_message_id) REFERENCES messages(id) ON DELETE SET NULL;

-- ---------- Rating/report/admin tables ----------
CREATE TABLE user_ratings (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rater_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rated_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating_value SMALLINT NOT NULL CHECK (rating_value BETWEEN 1 AND 5),
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (rater_id <> rated_user_id),
    UNIQUE (rater_id, rated_user_id)
);

CREATE INDEX user_ratings_rated_user_idx ON user_ratings (rated_user_id);

CREATE TABLE user_reports (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    reporter_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reported_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    status report_status NOT NULL DEFAULT 'open',
    reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (reporter_id <> reported_user_id)
);

CREATE INDEX user_reports_status_created_idx
    ON user_reports (status, created_at DESC);

CREATE TABLE admin_warnings (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    admin_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    target_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX admin_warnings_target_user_idx ON admin_warnings (target_user_id, created_at DESC);

CREATE TABLE admin_audit_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id BIGINT,
    payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX admin_audit_logs_actor_idx ON admin_audit_logs (actor_id, created_at DESC);
CREATE INDEX admin_audit_logs_target_idx ON admin_audit_logs (target_type, target_id, created_at DESC);

-- Helper view for product listing/search sorting by seller rate.
CREATE VIEW product_listing_view AS
SELECT
    p.id,
    p.owner_id,
    p.category_id,
    p.name,
    p.description,
    p.price,
    p.city,
    p.address_text,
    p.details,
    p.status,
    p.created_at,
    p.updated_at,
    COALESCE(ROUND(AVG(ur.rating_value)::NUMERIC, 2), 0.00) AS seller_rate
FROM products p
LEFT JOIN user_ratings ur ON ur.rated_user_id = p.owner_id
WHERE p.deleted_at IS NULL
GROUP BY p.id;

COMMIT;
