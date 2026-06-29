#!/bin/bash
# Builds all 10 stock images (alias: target-neon -> target-neon-dvwa).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
exec bash "$DIR/build-all-target-images.sh"
