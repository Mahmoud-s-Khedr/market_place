#!/usr/bin/env bash
set -euo pipefail

echo "[startup] Running database migrations"
npm run db:migrate

echo "[startup] Starting application"
exec node dist/main.js
