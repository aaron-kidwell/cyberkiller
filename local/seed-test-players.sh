#!/bin/bash
set -euo pipefail
HANDLE="${1:-local-kali}"
TOKEN="ck-local-$(openssl rand -hex 8)"
docker exec ck-db psql -U cyberkiller -d cyberkiller -c \
  "INSERT INTO players (handle, invite_token) VALUES ('$HANDLE', '$TOKEN')
   ON CONFLICT (handle) DO UPDATE SET invite_token = EXCLUDED.invite_token
   RETURNING handle, invite_token;" 2>/dev/null || \
PGPASSWORD=localdev psql -h localhost -p 5432 -U cyberkiller -d cyberkiller -c \
  "INSERT INTO players (handle, invite_token) VALUES ('$HANDLE', '$TOKEN')
   ON CONFLICT (handle) DO UPDATE SET invite_token = EXCLUDED.invite_token
   RETURNING handle, invite_token;" 2>/dev/null || true
echo ""
echo "Handle: $HANDLE"
echo "Invite token: $TOKEN"
echo ""
echo "sudo ../build/cyberkiller-agent --token $TOKEN --handle $HANDLE --api http://127.0.0.1:8080"
