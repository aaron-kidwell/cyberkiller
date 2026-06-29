# CyberKiller Guide

A complete walkthrough: deploy the range, run it as an instructor, and play it as
a competitor. CyberKiller is a self-hosted, competitive hacking arena - you stand
up real vulnerable Docker boxes, players attack them, capture flags or fight to
**hold the throne King-of-the-Hill style**, and climb a live leaderboard. Two
scoring modes: automated KOTH (the platform tracks who holds each box) and
instructor-awarded user/root flags - mix them per box.

> **Safety first.** These are deliberately vulnerable systems. Run the range only
> on a network you control and are authorized to test. Never expose the targets to
> the internet. See [../SECURITY.md](../SECURITY.md).

---

## 1. Deploy the range

### Requirements
- A **Linux host** with **Docker** + the **Docker Compose plugin**.
- A user in the `docker` group (or root).
- ~10 GB free disk, a couple of cores, ~4 GB RAM for the bundled MERIDIAN scenario.
- Outbound internet on first run (to pull base images). You do **not** need Go or
  Node installed - the API is built in a container.

### Bring it up
```bash
git clone https://github.com/aaron-kidwell/cyberkiller && cd cyberkiller
./deploy.sh
```
`deploy.sh` generates `.env` (random secrets + this host's LAN IP), builds the API
and all target images, starts the stack, and prints the hub URL, the admin login,
and an invite code. The bundled **MERIDIAN** scenario (10 Linux boxes) comes up
automatically.

### What's listening

| Port | Service | Who uses it |
|------|---------|-------------|
| `3000` | Player hub | players (browser) |
| `8080` | API | the hub + admin |
| `3001` | Admin panel | instructor only - **localhost**, reach via SSH tunnel |
| target IPs | the targets, on the arena network (LAN IPs in `lan` mode, `10.66.20.50-59` in `bridge` mode) | players' attack tools |

The admin panel binds to `127.0.0.1` on purpose. Reach it from your machine with:
```bash
ssh -L 3001:127.0.0.1:3001 <host>      # then open http://localhost:3001
```

### Configuration
Everything lives in `.env` (see [../.env.example](../.env.example)). Notable knobs:
- `API_URL` / `CORS_ORIGINS` - where players reach the API. Default is this host's
  LAN IP over HTTP. For a domain + HTTPS, set these to your `https://` URL and put a
  reverse proxy (e.g. Caddy, see `local/Caddyfile`) in front.
- `SIGNUP_OPEN` / `SIGNUP_INVITE_CODE` - open signup with a shared code, or close it.
- `CORP_ORCHESTRATION` - set `false` to skip the MERIDIAN example and run a bare
  modular range.
- `ADMIN_USER` / `ADMIN_PASS` - admin panel login.

### Managing the range
```bash
./deploy.sh            # bring up / reconcile (idempotent)
./deploy.sh update     # pull latest, rebuild, restart - keeps players + scores
./deploy.sh teardown   # stop everything, keep data + images
./deploy.sh delete     # remove everything: containers, target images, volumes (DB)
```

### Making targets reachable
There are two network modes (`ARENA_MODE` in `.env`; `deploy.sh` picks one for you):

- **`lan` (default when a LAN is detected)** - targets attach to your physical
  network via ipvlan and each box gets a **real LAN IP** (e.g. `192.168.1.200-223`).
  **Any machine on the LAN reaches them directly** - `nmap 192.168.1.200-223` from a
  player's laptop just works, **no VPN and no routes**. Works on wired and WiFi.
- **`bridge`** - targets sit on a private Docker bridge (`10.66.20.50-59`) reachable
  from the **host** only. Good for a single host (operator + VMs on one machine) or a
  cloud VPS where ipvlan isn't allowed.

The radar shows each box's IP either way. The arena network is isolated from the
control plane in both modes, so a rooted target reaches only the other targets
(which is what lets the MERIDIAN breach chain pivot box-to-box) - never the API or
database.

---

## 2. Run it (instructor / admin side)

Open the admin panel (`http://localhost:3001` over your SSH tunnel) and log in.

### Add a target - **Targets** page
Two ways to add any Docker image as a scorable target:
1. **By registry reference** - enter a name, a Docker image (e.g.
   `vulhub/struts2:s2-045`, your own image, any CTF box), difficulty, and optionally
   the login password. The image is pulled and registered.
2. **By upload** - upload a `docker save` tarball for air-gapped or custom images.

Tick **Inject flags** if the image doesn't ship the CyberKiller entrypoint - the
platform writes the two flags to the paths you set (**User flag path** / **Root
flag path**, default `/home/ckplayer/user.txt` and `/root/root.txt`) over
`docker exec` - the box's own vulnerability is the foothold. Tick
**King of the Hill** to make it an automated KOTH box (see
below). Then hit **Spin**. The box comes up on the range at a real arena IP with a
planted user flag and root flag.

### King of the Hill (automated scoring)
Any box can be a KOTH box - tick **King of the Hill** when you add it. Then scoring is
automatic, no awarding needed:
- Each KOTH box has a throne file at `/root/king.txt`. Whoever writes their hub handle
  there holds the hill - and writing it needs **root**, so claiming the throne *is* the
  challenge.
- The control plane reads the throne server-side every tick (default 60s) and gives the
  current holder points (default 10/tick). Players install **nothing** - unlike THM's
  KOTH there's no `koth` client to run.
- Stealing the throne is just overwriting the file with your own handle. The hub shows
  the live king, how long they've held, and announces every steal.

Tune the cadence with the `koth_tick_seconds` and `koth_points_per_tick` settings. Use
KOTH mode for a fight-over-one-box match; leave it off for CTF/flag-report boxes (the
manual award flow below still applies to those).

### Scoring - automatic
Scoring is **automatic** - you don't award captures by hand. A player proves a
capture by writing their hub handle into the box's flag file (`user.txt` / `root.txt`,
or `/root/king.txt` for KOTH hold); the control plane reads it server-side and awards
them, with first blood for the first capture of each flag. Points hit the leaderboard
within a tick (default 60s; `koth_tick_seconds`).

The **Targets** page still has **+User / +Root** (and **−U / −R**) as a manual
override - use it only to correct or adjudicate a capture, not as the normal path.

### Reset / stop targets
- **Reset** respawns a box from its image (fresh flags + loot, wipes captures).
- **Stop** tears a box down and frees its slot.
- The **MERIDIAN Example** page manages all 10 bundled boxes at once.

### Other admin controls (Dashboard)
- Player management (ban, kick, reset score, set password).
- Chat moderation (slowmode, emote-only, timeouts, operator messages).
- Signup mode + invite code, ticker / sitrep broadcasts, known issues.

---

## 3. Play it (player side)

### Get in
1. Open the hub (`http://<host>:3000`).
2. **Register** with the invite code your instructor gave you, or **log in**.
3. You land on the hub - no agent, no VPN, nothing to install on your account.

### Attack from your own VM
Use a dedicated attack VM (Kali, Parrot, etc.). The **Radar** tab lists every live
target by IP. Scan and attack them directly - the IPs shown are the IPs you hit:
```bash
nmap <radar-range>           # e.g. nmap 192.168.1.200-223  (LAN mode)
nmap -sV <box-ip>            # enumerate a box, then exploit your way in
curl http://<box-ip>/
```
In the default **LAN mode** these are real addresses on your network, so this works
from any machine with no setup. (In **bridge mode** the targets are host-local - run
your attack VM on the host, or switch the operator to LAN mode.)

### Capture flags
Every box has two flags - a **user** flag (foothold) and a **root** flag (root only).
Find `user.txt` / `root.txt` on the box (the path varies per box). You capture a flag
by **writing your hub handle into the flag file** - the platform reads it server-side
and awards you automatically. No submission box, no instructor in the loop:
```bash
echo "yourhandle" > /path/to/user.txt   # after foothold  -> user flag
echo "yourhandle" > /root/root.txt       # after privesc   -> root flag
```
Scoring is by **kills** (root captures) first, points as the tiebreaker; the first
capture of each flag on a box is **first blood**.

### Hold the hill (KOTH boxes)
A box marked **King of the Hill** on the radar scores automatically - no reporting. Get
root, then claim the throne:
```bash
echo YOURHANDLE > /root/king.txt
```
You earn points every tick for as long as your handle is in that file. Anyone who gets
root can overwrite it to steal the crown, so defend your access - kill their shells,
patch the way in, set persistence. The hub shows the live king and how long they've held.

### The MERIDIAN scenario
If your instructor enabled it, MERIDIAN is a 10-box corporate Linux network with a
designed breach chain: only the DMZ web box is the entry point; every internal box
is reached with creds or keys looted from an earlier hop, then privesc'd to root.
Full map (instructors): [../docker/corp/CHAIN.md](../docker/corp/CHAIN.md).

---

## 4. The gameplay loop

```
Instructor adds + spins targets  ->  players attack from their VMs  ->
players capture user/root flags  ->  players report values  ->
players write their handle into the flag files  ->  platform auto-awards  ->
leaderboard updates  ->  reset / add more
```

It plays like a CTF or a king-of-the-hill match: everyone hits the same boxes,
races for first blood, and climbs the board. Targets stay up until you stop or
reset them - there are no rounds or rotation.

---

## 5. Troubleshooting

- **Hub won't load / SSL error** - you're on `https://` for a plain-HTTP deploy.
  Use `http://<host>:3000` (or front the stack with a TLS reverse proxy).
- **Admin panel is empty** - your browser cached an old admin login. Log out of the
  panel and log back in with the `ADMIN_USER`/`ADMIN_PASS` from `.env`.
- **A target shows "spinning" forever** - check `docker logs ck-control`; the image
  may not expose the port you set, or failed its health check. Reset it.
- **Players can't reach a target** - check the mode with `docker network inspect
  ck-arena`. In **lan** mode the boxes have LAN IPs reachable from any machine; if a
  box's IP collides with something on your LAN, set `ARENA_IP_PREFIX`/`ARENA_BOX_BASE`
  in `.env` to a free block and redeploy. In **bridge** mode targets are host-local
  (run the attack VM on the host, or set `ARENA_MODE=lan`). Targets are never exposed
  to the internet by design.
- **Reset the whole range** - `./deploy.sh delete` then `./deploy.sh` for a clean
  slate (this wipes the database too).
