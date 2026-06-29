# CyberKiller Local E2E Playbook

## Prerequisites

- Docker, Go 1.22+, WireGuard tools (`wg`)
- Linux host with `/dev/net/tun` (for full agent test)

## 0. Host forwarding (if nmap shows **filtered**)

When the agent runs on the same machine as Docker, target containers must send **return traffic via ck-control** (not the Docker bridge gateway). After `docker compose up` and agent connect:

```bash
sudo bash setup-host-forwarding.sh   # optional UFW helper on the host
curl -X POST http://127.0.0.1:8080/debug/reapply-dnat   # DNAT + route 10.66.0.0/16 via hub
```

Then `nmap -Pn -p 22,80 10.66.20.10` should show **open**.

## 1. Build

Hills only go **live** after the health gate passes (container up, SSH/HTTP, flags, player route, DNAT, TCP from control plane). Failed spins show in Admin → **Failed health checks** and never appear on the player radar.

```bash
cd /home/aaron/Projects/cyberkiller/local
bash setup-wireguard-keys.sh
bash generate-wg0-conf.sh
cd .. && bash local/build-binaries.sh
bash local/build-target-image.sh
cd local && docker compose up --build -d
```

Wait ~30s, then:

```bash
curl -s http://localhost:8080/health
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001
```

## 2. Seed player

```bash
bash seed-test-players.sh local-kali
```

## 3. Register agent

```bash
sudo ../build/cyberkiller-agent --token <TOKEN> --handle local-kali --api http://127.0.0.1:8080 --wg-endpoint 127.0.0.1:51820
```

## 4. Radar

Open http://localhost:3000/hub - expect targets and KOTH hills after health gate (~1 min).

## 5. Capture flags (KOTH hills)

Each hill has server-planted flags (never shown on the hub):

| Flag | Path on box | Points |
|------|-------------|--------|
| User | `/home/ckplayer/user.txt` | 150 |
| Root | `/root/root.txt` | 400 |
| KOTH throne | `/root/.koth_token` | crown only (rotates every 5 min) |

```bash
ssh ckplayer@10.66.20.x   # or root after privesc
cat /home/ckplayer/user.txt
./build/cyberkiller-agent submit flag --ip 10.66.20.x --value 'CK{user-...}'
cat /root/root.txt
./build/cyberkiller-agent submit flag --ip 10.66.20.x --value 'CK{root-...}'
```

Intel drops every 6h (600s locally). Arena wave rotation every 12h (300s locally):

```bash
curl -X POST http://127.0.0.1:8080/debug/intel-drop
curl -X POST http://127.0.0.1:8080/debug/arena-rotate
```

## 6. Reach a target (SSH / HTTP)

Arena IPs (`10.66.20.x`) only exist on the **WireGuard** path - not on your LAN. The browser must use the tunnel (agent connected); `http://10.66.20.x` will not work from a host route that bypasses WG.

Ping often fails (ICMP not forwarded). Use TCP:

```bash
nmap -Pn -p 22,80 10.66.20.10
curl -s http://10.66.20.10/    # after agent + DNAT
ssh root@10.66.20.10
```

Radar **open ports** are live-probed from the control plane after the fix; if nothing is listening you will see an empty port list (not fake “open” metadata).

If SSH/HTTP is **filtered** or the browser times out:

```bash
curl -X POST http://127.0.0.1:8080/debug/reapply-dnat
sudo bash local/setup-host-forwarding.sh   # once, with wg0 up
sudo bash local/fix-arena-routes.sh        # if targets were built without iproute2
```

Rebuild control after API changes: `cd local && docker compose build control && docker compose up -d control`

Ensure the agent tunnel is up (`sudo wg show wg0`). Traffic path: your `10.66.10.x` → hub → DNAT → Docker target.

Local dev password (from host):

```bash
docker exec $(docker ps --format '{{.Names}}' | grep '^ck-' | head -1) grep '^root:' /etc/shadow
```

## 7. Target kill (legacy, KOTH_ONLY=false only)

SSH to target arena IP (or use host DNAT), read `/etc/shadow` or use planted password from logs.

```bash
./build/cyberkiller-agent submit target --ip 10.66.20.x --value '<shadow-line-or-plaintext>'
```

## 8. Fake kill rejected

Submit without connecting - expect `no attack flow found`.

## 9. KOTH claim

```bash
ssh root@10.66.20.x cat /root/.koth_token
./build/cyberkiller-agent submit koth --ip 10.66.20.x --token 'KOTH-...'
```

## 10. Intel drop

```bash
curl -X POST http://localhost:8080/debug/intel-drop
```

## 11. Image submission

Hub → Contribute → submit → Admin http://localhost:3001/submissions → Approve

## 12. Chat

Hub sidebar - join with handle, verify seeded + live messages.
