#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if find src -type f \( -name '*.js' -o -name '*.d.ts' -o -name '*.js.map' \) | grep -q .; then
  echo 'Compiled artifacts found under src/. Keep generated files in dist/ only.'
  find src -type f \( -name '*.js' -o -name '*.d.ts' -o -name '*.js.map' \) -print
  exit 1
fi

echo 'No compiled artifacts found under src/.'
