BEGIN;

-- Fix: 0001_init.sql omitted the `salt` column on auth_otps.
-- schema.sql and the application code both expect it.
ALTER TABLE auth_otps
    ADD COLUMN IF NOT EXISTS salt TEXT NOT NULL DEFAULT '';

-- Staging table for registrations awaiting OTP verification.
-- Rows live here between POST /auth/register and POST /auth/register/verify.
-- Promoted to users on success, swept by cleanup task on expiry.
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

COMMIT;
