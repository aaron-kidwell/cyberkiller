# Arena target images

## Where images come from

| Source | What |
|--------|------|
| **This repo** | `docker/targets/` - 10 `cyberkiller/target-*` images built by `local/build-all-target-images.sh` |
| **Postgres `target_images`** | Registry the KOTH scheduler uses (`ORDER BY RANDOM()` for hills) |
| **Volunteer pipeline** | Hub **Contribute** → admin approve → row added to `target_images` |

There is **no** external pull of Metasploitable/DVWA yet - those are listed as future/community images. Today everything is built locally from `Dockerfile.scenario` + `scenarios/*/`.

## The 10 stock images

| ID | Docker tag | Tier | Focus |
|----|------------|------|--------|
| `neon-dvwa` | `cyberkiller/target-neon-dvwa:latest` | neon | SQLi-style login (also tagged `target-neon`) |
| `sqli-login` | `cyberkiller/target-sqli-login:latest` | neon | Classic auth bypass |
| `xss-reflected` | `cyberkiller/target-xss-reflected:latest` | neon | Reflected XSS |
| `cmd-ping` | `cyberkiller/target-cmd-ping:latest` | neon | Command injection |
| `upload-unsafe` | `cyberkiller/target-upload-unsafe:latest` | neon | Unsafe upload stub |
| `lfi-include` | `cyberkiller/target-lfi-include:latest` | shadow | LFI-style include |
| `creds-leak` | `cyberkiller/target-creds-leak:latest` | shadow | Exposed config backup |
| `shadow-suid` | `cyberkiller/target-shadow-suid:latest` | shadow | Privesc hint (SUID) |
| `sudo-misconfig` | `cyberkiller/target-sudo-misconfig:latest` | citadel | sudo misconfiguration hint |
| `citadel-chain` | `cyberkiller/target-citadel-chain:latest` | citadel | Chained web vulns |

Each image: **OpenSSH on 22**, **Apache/PHP on 80**. Flag slots at `/home/ckplayer/user.txt` and `/root/root.txt` - players write their **arena handle**; the control plane auto-detects and scores (no manual flag submit).

## Build

```bash
bash local/build-all-target-images.sh
```

## Register in DB (existing volume)

```bash
docker exec -i ck-db psql -U cyberkiller -d cyberkiller < local/seed-target-images.sql
```
