#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost}"

echo "Checking health endpoints on $BASE_URL"
curl -fsS "$BASE_URL/health/live" >/dev/null
echo "- live: ok"
curl -fsS "$BASE_URL/health/ready" >/dev/null
echo "- ready: ok"

echo "Smoke tests passed"
