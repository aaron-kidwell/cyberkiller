#!/usr/bin/env bash
# CyberKiller daily backup.
#
# Dumps Postgres + critical filesystem state, rotates locally, optionally
# pushes off-host via rclone (Backblaze B2, S3, anything rclone supports).
#
# Setup:
#   1) Configure rclone remote once:    rclone config   # name it "ckbackup"
#   2) Add to crontab (root or aaron):  15 4 * * *  /home/aaron/Projects/cyberkiller/local/backup.sh
#   3) Test now:                        bash local/backup.sh
#
# If rclone isn't configured, backups still rotate locally.

set -euo pipefail

# ── Config ───────────────────────────────────────────────────────────────────
BACKUP_DIR="${BACKUP_DIR:-/var/backups/cyberkiller}"
KEEP_DAYS="${KEEP_DAYS:-14}"
RCLONE_REMOTE="${RCLONE_REMOTE:-ckbackup:cyberkiller-backups}"
DB_CONTAINER="${DB_CONTAINER:-ck-db}"
DB_USER="${DB_USER:-cyberkiller}"
DB_NAME="${DB_NAME:-cyberkiller}"
WG_KEYS_DIR="${WG_KEYS_DIR:-/home/aaron/Projects/cyberkiller/local/wg-keys}"
UPLOADS_VOL="${UPLOADS_VOL:-local_ck-uploads}"

STAMP="$(date -u +%Y-%m-%d_%H%M%S)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$BACKUP_DIR"

log() { echo "[backup $(date -u +%H:%M:%S)] $*"; }

# ── 1. Postgres dump ─────────────────────────────────────────────────────────
log "dumping postgres ($DB_NAME)..."
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -F c "$DB_NAME" > "$TMP/db.dump"
SIZE=$(du -h "$TMP/db.dump" | cut -f1)
log "  db.dump: $SIZE"

# ── 2. WireGuard keys (critical, no recreation possible) ────────────────────
if [ -d "$WG_KEYS_DIR" ]; then
  log "snapshotting wireguard keys..."
  tar -C "$(dirname "$WG_KEYS_DIR")" -czf "$TMP/wg-keys.tar.gz" "$(basename "$WG_KEYS_DIR")"
fi

# ── 3. Uploads volume (avatars, screenshots, profile bgs) ───────────────────
log "snapshotting uploads volume..."
docker run --rm \
  -v "$UPLOADS_VOL":/data:ro \
  -v "$TMP":/out \
  alpine sh -c 'tar -C /data -czf /out/uploads.tar.gz . 2>/dev/null || true'

# ── 4. Bundle ───────────────────────────────────────────────────────────────
BUNDLE="$BACKUP_DIR/ck-backup-$STAMP.tar"
tar -C "$TMP" -cf "$BUNDLE" db.dump wg-keys.tar.gz uploads.tar.gz 2>/dev/null || \
  tar -C "$TMP" -cf "$BUNDLE" db.dump
SIZE=$(du -h "$BUNDLE" | cut -f1)
log "bundle: $BUNDLE ($SIZE)"

# ── 5. Rotate locally (keep last KEEP_DAYS) ─────────────────────────────────
find "$BACKUP_DIR" -maxdepth 1 -name 'ck-backup-*.tar' -mtime +"$KEEP_DAYS" -delete
KEPT=$(ls -1 "$BACKUP_DIR"/ck-backup-*.tar 2>/dev/null | wc -l)
log "local backups kept: $KEPT (rotation: $KEEP_DAYS days)"

# ── 6. Off-host push (if rclone configured) ─────────────────────────────────
if command -v rclone >/dev/null 2>&1 && rclone listremotes 2>/dev/null | grep -q "^${RCLONE_REMOTE%%:*}:"; then
  log "pushing to $RCLONE_REMOTE..."
  rclone copy "$BUNDLE" "$RCLONE_REMOTE/" --quiet
  # Apply rotation off-host too - rclone delete files older than KEEP_DAYS days.
  rclone delete "$RCLONE_REMOTE/" --min-age "${KEEP_DAYS}d" --quiet 2>/dev/null || true
  log "off-host push complete"
else
  log "WARN: rclone not configured (remote '${RCLONE_REMOTE%%:*}' not found). Backup is LOCAL ONLY."
  log "      run 'rclone config' to set up off-host storage."
fi

log "done"
