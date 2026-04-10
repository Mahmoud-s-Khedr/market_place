ALTER TABLE users
  ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS auth_otp_attempts (
  phone VARCHAR(32) NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('registration', 'password_reset')),
  attempts INTEGER NOT NULL CHECK (attempts >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (phone, purpose)
);

CREATE INDEX IF NOT EXISTS auth_otp_attempts_expires_idx
  ON auth_otp_attempts (expires_at);

CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  jti TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS auth_refresh_tokens_user_idx
  ON auth_refresh_tokens (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS auth_refresh_tokens_expires_idx
  ON auth_refresh_tokens (expires_at);
