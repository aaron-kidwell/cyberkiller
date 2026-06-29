#!/bin/bash
# Build all 10 MERIDIAN corporate-network scenario images (Scenario #2).
# Four layer on already-built CVE target images; six build fresh from
# debian:bookworm-slim. See docker/corp/CHAIN.md for the breach chain.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Generate the scenario's throwaway SSH keypairs if absent. These are CTF
# artifacts (db01 plants jdev's private key -> ws01 trusts its public key;
# app01 plants itadmin's deploy key -> ws02 trusts its public key). They are
# gitignored and regenerated per environment so no private key is committed.
KEYS="$ROOT/docker/corp/keys"
mkdir -p "$KEYS"
[ -f "$KEYS/jdev_id_rsa" ]  || ssh-keygen -t ed25519 -N "" -C "jdev@meridian.corp"    -f "$KEYS/jdev_id_rsa"  >/dev/null
[ -f "$KEYS/itadmin.key" ]  || ssh-keygen -t ed25519 -N "" -C "itadmin@meridian.corp" -f "$KEYS/itadmin.key"  >/dev/null

# Reuse-based boxes depend on the CVE target images existing first.
NEED=(cyberkiller/target-apache-rce:latest cyberkiller/target-struts-ognl:latest \
      cyberkiller/target-jenkins-rce:latest cyberkiller/target-log4shell:latest)
for img in "${NEED[@]}"; do
  if ! docker image inspect "$img" >/dev/null 2>&1; then
    echo "[ck] missing base image $img - run local/build-all-target-images.sh first" >&2
    exit 1
  fi
done

# Fat base for the bookworm boxes (full Linux toolset + staff users) - build first.
echo "[ck] Building cyberkiller/corp-base (fat Debian base)..."
docker build --network=host --pull=false -t cyberkiller/corp-base:latest -f docker/corp/base/Dockerfile "$ROOT" >/dev/null
echo "     built ✓"

BOXES=(mer-web01 mer-web02 mer-db01 mer-db02 mer-app01 mer-ws01 mer-ws02 mer-fs01 mer-log01 mer-ipa01)

echo "[ck] Building ${#BOXES[@]} MERIDIAN corp images..."
for b in "${BOXES[@]}"; do
  tag="cyberkiller/corp-${b}:latest"
  echo "  -> $tag"
  docker build --pull=false -t "$tag" -f "docker/corp/${b}/Dockerfile" "$ROOT" >/dev/null
  echo "     built ✓"
done

echo "[ck] Done. 10 corp images ready (cyberkiller/corp-mer-*:latest)."
