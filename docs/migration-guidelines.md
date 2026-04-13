# Migration Guidelines

- Write migrations to be rerun-safe (idempotent) where practical.
- Prefer guarded schema changes for rename/type-conversion steps (`IF EXISTS` checks or `DO $$` guards).
- When changing view column order or inserting columns in the middle, use `DROP VIEW IF EXISTS ...` then `CREATE VIEW ...` instead of `CREATE OR REPLACE VIEW`.
- Keep destructive data resets (`docker compose down -v`) limited to local/dev environments only.
