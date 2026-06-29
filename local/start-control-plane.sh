#!/bin/bash
set -euo pipefail
echo "[ck] Control plane starting..."

if [ -f /opt/cyberkiller/.env ]; then
  set -a
  # shellcheck disable=SC1091
  source /opt/cyberkiller/.env
  set +a
fi

PGHOST="${PGHOST:-db}"

# Forwarding is needed so the DNAT that maps arena IPs (10.66.20.x) to target
# container bridge IPs works.
sysctl -w net.ipv4.ip_forward=1 2>/dev/null || true

echo "[ck] Waiting for Postgres at ${PGHOST}..."
for i in $(seq 1 60); do
  if PGPASSWORD="${DB_PASSWORD:-localdev}" pg_isready -h "$PGHOST" -U cyberkiller -q 2>/dev/null; then
    break
  fi
  sleep 1
done

PGPASSWORD="${DB_PASSWORD:-localdev}" psql -h "$PGHOST" -U cyberkiller -d cyberkiller -f /opt/cyberkiller/schema.sql 2>/dev/null || true

# Arena bridge for target containers.
if [ -S /var/run/docker.sock ]; then
  docker network inspect ck-arena >/dev/null 2>&1 || docker network create --subnet=172.28.0.0/16 ck-arena || true
fi

exec /opt/cyberkiller/cyberkiller-api
