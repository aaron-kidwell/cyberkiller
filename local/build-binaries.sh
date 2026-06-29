#!/bin/bash
# Build the Go API binary. Needs Go installed locally; deploy.sh builds it in a
# container instead, so you only need this for local development.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/build"

echo "[build] API..."
(cd "$ROOT/api" && go build -o "$ROOT/build/cyberkiller-api" ./cmd/server)
echo "[build] Done: $ROOT/build/cyberkiller-api"
