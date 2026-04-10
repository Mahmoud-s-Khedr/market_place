#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS_DIR="$ROOT_DIR/db/migrations"
DRY_RUN=false

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required"
  exit 1
fi

if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  echo "No migrations directory found: $MIGRATIONS_DIR"
  exit 1
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
CREATE TABLE IF NOT EXISTS schema_migrations (
  id BIGSERIAL PRIMARY KEY,
  filename TEXT UNIQUE NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);"

shopt -s nullglob
files=("$MIGRATIONS_DIR"/*.sql)

if (( ${#files[@]} == 0 )); then
  echo "No migration files found"
  exit 0
fi

for file in "${files[@]}"; do
  filename="$(basename "$file")"
  applied="$(psql "$DATABASE_URL" -At -c "SELECT 1 FROM schema_migrations WHERE filename = '$filename' LIMIT 1;")"

  if [[ "$applied" == "1" ]]; then
    echo "Skipping already applied migration: $filename"
    continue
  fi

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[DRY-RUN] Would apply migration: $filename"
    continue
  fi

  echo "Applying migration: $filename"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$file"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "INSERT INTO schema_migrations(filename) VALUES('$filename');"
done

echo "Migration run completed"
