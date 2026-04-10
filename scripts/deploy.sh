#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required"
  exit 1
fi

echo "1) Pull latest images"
docker compose pull

echo "2) Rebuild and start app stack"
docker compose up -d --build app nginx redis

echo "3) Run migrations"
docker compose exec -T app npm run db:migrate

echo "4) Health check"
curl -fsS http://localhost/health/live >/dev/null
curl -fsS http://localhost/health/ready >/dev/null

echo "Deployment completed"
