#!/usr/bin/env bash
# CyberKiller uptime monitor.
#
# Pings /health every minute. If three checks fail in a row, posts to a Discord
# webhook (or emails, or logs only). Recovers cleanly - posts a "back up" note
# when health returns.
#
# State file tracks consecutive failures so a single blip doesn't page.
#
# Run as a systemd service (see monitor.service below) or via cron-every-minute:
#   * * * * *  /home/aaron/Projects/cyberkiller/local/monitor.sh
#
# Discord webhook setup:
#   1. In your Discord server: Server Settings → Integrations → Webhooks → New
#   2. Copy the URL into CK_ALERT_WEBHOOK below or as an env var.
#   3. Test:  CK_ALERT_WEBHOOK=https://discord.com/api/webhooks/...  bash local/monitor.sh --test

set -euo pipefail

URL="${CK_HEALTH_URL:-https://cyberkiller.net/api/health}"
WEBHOOK="${CK_ALERT_WEBHOOK:-}"
STATE_FILE="${CK_MONITOR_STATE:-/var/tmp/ck-monitor.state}"
FAIL_THRESHOLD=3

if [ "${1:-}" = "--test" ]; then
  if [ -z "$WEBHOOK" ]; then
    echo "set CK_ALERT_WEBHOOK first"; exit 1
  fi
  curl -fsS -H "Content-Type: application/json" -X POST "$WEBHOOK" \
    -d '{"content":"🟢 CyberKiller monitor test - alerts are wired up."}'
  echo "test alert sent"
  exit 0
fi

# Read previous state (consecutive failures, last alerted state)
PREV_FAILS=0
LAST_STATE="up"
if [ -f "$STATE_FILE" ]; then
  read -r PREV_FAILS LAST_STATE < "$STATE_FILE" 2>/dev/null || true
fi

# Ping health
HTTP_CODE=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 8 "$URL" 2>/dev/null || echo "000")

post_alert() {
  local msg="$1"
  echo "[monitor] $msg"
  if [ -n "$WEBHOOK" ]; then
    curl -fsS -H "Content-Type: application/json" -X POST "$WEBHOOK" \
      -d "{\"content\":$(printf '%s' "$msg" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')}" \
      >/dev/null 2>&1 || true
  fi
}

if [ "$HTTP_CODE" = "200" ]; then
  # Healthy
  if [ "$LAST_STATE" = "down" ]; then
    post_alert "🟢 **CyberKiller is back UP** (HTTP 200 on $URL)"
  fi
  echo "0 up" > "$STATE_FILE"
else
  # Unhealthy
  FAILS=$((PREV_FAILS + 1))
  echo "$FAILS down" > "$STATE_FILE"
  if [ "$FAILS" -eq "$FAIL_THRESHOLD" ]; then
    post_alert "🔴 **CyberKiller DOWN** - $URL returned HTTP $HTTP_CODE for $FAIL_THRESHOLD consecutive checks ($((FAIL_THRESHOLD)) min). Investigate."
  elif [ "$FAILS" -gt "$FAIL_THRESHOLD" ] && [ $((FAILS % 30)) -eq 0 ]; then
    # Re-ping every 30 min while still down
    post_alert "🔴 STILL DOWN: $URL → HTTP $HTTP_CODE (failing for ${FAILS} min)"
  fi
fi
