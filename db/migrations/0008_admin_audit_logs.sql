BEGIN;

CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id BIGINT,
    payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_audit_logs_actor_idx
    ON admin_audit_logs (actor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_audit_logs_target_idx
    ON admin_audit_logs (target_type, target_id, created_at DESC);

COMMIT;
