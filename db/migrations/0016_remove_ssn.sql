BEGIN;

DROP INDEX IF EXISTS pending_registrations_ssn_unique_idx;

ALTER TABLE pending_registrations
    DROP COLUMN IF EXISTS ssn;

ALTER TABLE users
    DROP COLUMN IF EXISTS ssn;

COMMIT;
