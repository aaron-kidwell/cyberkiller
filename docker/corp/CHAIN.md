# MERIDIAN - Corporate Linux Network (Scenario #2)

Source-of-truth for the breach chain. Every planted credential / key on one box
must match the real account on the next box. Keep this file in sync with the
`ck-init.sh` scripts - if you change a password here, change it in both boxes.

Theme: **Meridian Logistics**, a fictional freight/logistics megacorp. Internal
DNS suffix `meridian.corp`. Arena band `10.66.20.50–59` (only one scenario is live
at a time, so this never collides with GOAD or the random KOTH pool).

All boxes: SSH on 22, a status page on 80 (so the health gate passes), plus the
real service port for that role. Flags are the standard handle-based
`/home/ckplayer/user.txt` (user) + `/root/root.txt` (root), scored by the existing
KOTH flag scanner. "Loot" is what a player finds that unlocks the next hop.

> Container-reality note: a few classic Linux privescs (NFS `no_root_squash`,
> PwnKit/polkit, kernel exploits) don't work reliably inside unprivileged
> containers. Where the *role* calls for those, we substitute a
> container-reliable equivalent (SUID binary, sudo/GTFOBins, writable cron,
> capability) that teaches the same tradecraft. The narrative role is unchanged.

---

## Topology & entry

```
            players (WireGuard)
                  │  (only .50 answers from the player subnet - Phase D)
                  ▼
   .50 mer-web01  DMZ web app  ── pivot ──┐
                                          ▼
   .51 web02   .52 db01   .53 db02   .54 app01   .55 ws01
                                          │
                                          ▼
   .56 ws02 (IT)  ── .57 fs01 ── .58 log01 (SIEM) ── .59 ipa01 (central auth = objective)
```

Entry: **only mer-web01 is reachable from players**. Everything else is reached by
looting creds/keys from an already-compromised box.

---

## Machines & credential map

| IP | Host | Service port(s) | Entry | Privesc (container-reliable) | Loot planted → unlocks |
|----|------|-----------------|-------|------------------------------|------------------------|
| .50 | mer-web01 | 80 (Apache 2.4.49) | CVE-2021-41773 path-traversal CGI RCE → `daemon` | `daemon`→`ckplayer` (sudo) → root (SUID python) | `/var/www/html/inc/db.php` → **db01** creds `meridian_app` / `Fr3ight-Db-2024!` |
| .51 | mer-web02 | 80 (Struts2 2.3.30) | CVE-2017-5638 OGNL RCE → `ckplayer` | SUID `/usr/bin/env` (GTFOBins) → root | `/var/backups/intranet.bak` notes → names **log01** SIEM + dev user `jdev` |
| .52 | mer-db01 | 3306 (MySQL) | reused creds from web01 (`meridian_app`) | `ckplayer` sudo `/usr/bin/mysql` → root | table `hr.onboarding` holds **jdev** PEM private key → **ws01** |
| .53 | mer-db02 | 6379 (Redis, unauth) | unauthenticated Redis → write `ckplayer` authorized_keys → shell | writable root cron (`/etc/cron.d`) → root | key `ci:deploy_token` + `apikey:jenkins` → **app01** |
| .54 | mer-app01 | 8080 (Jenkins 2.138) | CVE-2018-1000861 script RCE → `jenkins` | sudo `/usr/bin/vi` (GTFOBins) → root | `/var/jenkins_home/secrets/itadmin.key` deploy key → **ws02** |
| .55 | mer-ws01 | 80 (status) | SSH as `jdev` with PEM from db01 | sudo `/usr/bin/find` (GTFOBins) → root | `~jdev/.ssh/known_hosts` + `~/work-notes.md` → names **ws02 / itadmin** |
| .56 | mer-ws02 | 80 (status) | SSH as `itadmin` with deploy key from app01 | SUID `/usr/bin/cp` → root | `~itadmin/.secrets/vault.txt`: SIEM admin pw → **log01**, LDAP admin pw → **ipa01** |
| .57 | mer-fs01 | 445 (Samba) | writable Samba share `backups` (guest) → drop authorized_keys / read backups | sudo `/usr/bin/tar` (GTFOBins) → root | `/srv/backups/ipa-backup.tgz` → **ipa01** `Directory-Manager` pw |
| .58 | mer-log01 | 8983 (Solr) | CVE-2021-44228 Log4Shell → `solr` | sudo `/usr/bin/systemctl` → root | crown jewel #1: full log visibility; admin pw confirms ws02 loot |
| .59 | mer-ipa01 | 389 (slapd LDAP) | reached via `Directory-Manager` / LDAP admin pw from ws02+fs01 | sudo `/usr/bin/perl` for `ldapadmin` → root | **OBJECTIVE**: root = central-auth/domain takeover |

### Shared secrets (must match across boxes)

| Secret | Value | Lives on | Used at |
|--------|-------|----------|---------|
| DB app creds | `meridian_app` / `Fr3ight-Db-2024!` | planted on web01 | db01 login |
| jdev SSH key | `jdev_id_rsa` (PEM) | dumped in db01 `hr.onboarding` | ws01 SSH |
| CI deploy token | `ci:deploy_token` = `mer-ci-9f3a17` | redis key on db02 | app01 context |
| itadmin deploy key | `itadmin.key` (PEM) | app01 `/var/jenkins_home/secrets` | ws02 SSH |
| SIEM admin pw | `s13m-Adm1n-Meridian` | ws02 vault | log01 confirm / Solr admin |
| LDAP Directory-Manager pw | `D1r3ctory-Mgr-Mer!` | ws02 vault + fs01 backup | ipa01 login |

## OSCP-style enrichment recipe (apply to every box)

The range should reward **enumeration**: multiple services per host, version
banners that point at real exploits, hidden web paths, and credentials/keys
left in configs/backups/logs/histories that unlock the next service or box.
Every box gets, where its base allows:

1. **Multiple listening services** - its primary service + at least one extra
   (status web page, FTP, SNMP, secondary app). Some vulnerable, some not.
2. **Recon breadcrumbs** - `robots.txt`/hidden dirs, `.bak` configs, HTML
   comments, `/var/mail`, `.bash_history`, world-readable configs, verbose
   banners. Recon alone should yield at least one credential or pivot hint.
3. **Multiple foothold paths** - e.g. a CVE *and* a creds-in-backup path.
4. **Layered privesc** - SUID / sudo / cron / writable-path, discoverable by
   standard enumeration (`sudo -l`, `find / -perm -4000`, `cat /etc/cron*`).

> Base constraint: the 4 vulhub boxes (web01/web02/app01/log01) run EOL Debian
> Buster (dead apt mirror) - enrich them with **web content / configs / files**
> only, no new packages. The 6 bookworm boxes can add real service packages.

**Flagship example - web01** (built, verified): real shipment portal with a
`generator`/Server banner (Apache 2.4.49 → CVE), `robots.txt` exposing
`/backup` `/inc` `/portal`, `/backup/portal-config.php.bak` leaking the db01
creds + a portal-admin login, HTML dev-note comments naming internal hosts and
the jdev deploy key, a `/portal/` login with QA creds in source. Foothold via
**either** the CVE RCE **or** recon→leaked creds.

### Exploit-vector matrix - multiple exciting ways into each box

Pivots are never "just SSH with a looted password." Every box has at least one
*exciting network exploit*; most have two independent paths.

| Box | Services | Vector A (network exploit) | Vector B | recon path | root |
|-----|----------|----------------------------|----------|-----------|------|
| web01 | ssh, http | **CVE-2021-41773** path-traversal CGI RCE | recon→`portaladmin`/`Sh1pp1ng#Portal!` SSH | portal comments, /portal QA creds | SUID python / root cron (`/opt/portal`) |
| web02 | ssh, http(8080) | **CVE-2017-5638** Struts2 OGNL RCE | tomcat-users cred reuse→webadmin | deploy notes | SUID env / sudo awk |
| db01 | ssh, mysql, http(8080) | **MySQL FILE → `INTO OUTFILE`** → svc-sql | cred reuse → dbadmin | backup-web SQL dump→jdev key, .mysql_history | sudo mysql |
| db02 | ssh, redis, http(8080) | **unauth Redis → SSH key** → svc-cache | **cmd-injection** cache-admin → cacheadm | web key leak (ci token) | root cron (`/opt/cache`) |
| app01 | ssh, http(8080) | **CVE-2018-1000861** Jenkins RCE (script console + CLI) | - | credentials.xml + build log leaks | sudo vi |
| ws01 | ssh, http(8000) | **cmd-injection** build dash → devweb | jdev looted key | git-history DB creds, notes | devweb→root cron / sudo find |
| ws02 | ssh, http(8000) | **LFI** → steal itadmin key → SSH | app01 deploy key | LFI any file, vault | SUID cp |
| fs01 | ssh, smb, ftp | **anon SMB write → root cron** | IT cred reuse → itadmin (+anon rsync) | anon FTP smb.conf.bak creds | cron=root / sudo tar |
| log01 | ssh, http, solr(8983) | **CVE-2021-44228** Log4Shell | `siemadmin`/`s13m-Adm1n-Meridian` SSH (from ws02 vault) | **SIEM ingest logs leak creds for the whole network** | sudo systemctl |
| ipa01 | ssh, ldap(389) | **LDAP anon-bind hash leak → crack** → SSH | Directory-Manager reuse → ldapadmin | anon LDAP dump | sudo perl |

All vectors above are **built and verified end-to-end** (each foothold lands a
shell / each recon path yields the documented credential, and privesc reaches
root). Every box has multiple services and at least one exciting network
exploit; most have two independent footholds plus a recon-only path. log01's
SIEM is the keystone recon reward - its ingested logs leak credentials used
across the entire range, rewarding the player who pivots to it.

> **VM provisioner note (vm/meridian/provision/):** every box now has ONE
> distinct privesc, no shared paths (web01 SUID python, web02 SUID env, db01 sudo
> mysql, db02 root cron, app01 sudo vi, ws01 sudo find, ws02 SUID cp, fs01 sudo
> tar, log01 sudo systemctl, ipa01 sudo perl). The redundant SUID `/usr/bin/find`
> that was bolted onto 5 boxes (and the duplicated sudo tar / SUID python) was
> removed so privesc no longer feels identical across the network. Two boxes also
> have a second foothold (web01 `portaladmin` cred from the leaked backup config;
> log01 `siemadmin` cred from the ws02 vault, which now reaches root via the same
> sudo systemctl grant). db01 and
> log01 were fully re-verified end-to-end on the VMs this session
> (MySQL-FILE→OUTFILE→root and Log4Shell→RCE→root). The added GTFOBins/cron paths
> are standard, syntax-checked provisioner steps; sync the matching `ck-init.sh`
> if you change a credential. Keep this table and the provisioners in lockstep.

### Foothold accounts (no generic "ckplayer" - every box looks like a real host)

The user flag lives in the foothold account's home; the root flag is always
`/root/root.txt`. Per-box flag paths are baked into each image as
`CK_USER_FLAG_PATH` and registered in the scenario roster so the flag scanner
reads the right path.

| Box | Foothold account | user.txt path |
|-----|------------------|---------------|
| web01 | www-data | /var/www/user.txt |
| web02 | webadmin | /home/webadmin/user.txt |
| db01 | dbadmin | /home/dbadmin/user.txt |
| db02 | svc-cache | /home/svc-cache/user.txt |
| app01 | jenkins | /var/jenkins_home/user.txt |
| ws01 | jdev | /home/jdev/user.txt |
| ws02 | itadmin | /home/itadmin/user.txt |
| fs01 | itadmin | /home/itadmin/user.txt |
| log01 | solr | /home/solr/user.txt |
| ipa01 | ldapadmin | /home/ldapadmin/user.txt |

Tiers → bounty (existing settings `koth_bounty_{easy,medium,hard}`). Rated by
foothold + privesc *complexity* (the hardest intended path), not chain depth:
- **easy** = web01, web02, ws01 - public one-step CVE/cmd-injection (or a looted
  key) + a trivial SUID/cron/sudo privesc.
- **medium** = db02, app01, ws02, fs01 - unauth-Redis CONFIG-SET key-write,
  Jenkins Groovy console, LFI→key theft, anon-SMB→root-cron, on GTFOBins/SUID privesc.
- **hard** = db01, log01, ipa01:
  - db01 - SQLi → MySQL FILE-priv → `INTO OUTFILE` authorized_keys (multi-step,
    perms/sandbox-sensitive - the flagship MySQL-FILE→RCE).
  - log01 - Log4Shell needs JNDI-LDAP + HTTP infra and a malicious class with
    `trustURLCodebase`, the most involved exploit in the range.
  - ipa01 - the central-auth OBJECTIVE: LDAP anonymous-bind hash leak → crack, and
    full compromise depends on creds looted across the whole chain.
