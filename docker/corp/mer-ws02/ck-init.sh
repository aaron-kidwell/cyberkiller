#!/bin/bash
# mer-ws02 - Meridian IT admin workstation. Multiple ways in:
#   A) LFI in the IT toolbox (:8000) -> read /home/itadmin/.ssh/id_ed25519 -> SSH
#   B) SSH as itadmin with the deploy key looted from mer-app01
# Privesc: SUID /usr/bin/python3 (GTFOBins) -> root.
# Loot: itadmin vault -> SIEM (log01) + LDAP (ipa01) credentials.

id itweb &>/dev/null   || useradd -m -s /usr/sbin/nologin itweb
id itadmin &>/dev/null || useradd -m -s /bin/bash itadmin

# itadmin trusts both the app01 deploy key AND a local key (the one the LFI leaks)
mkdir -p /home/itadmin/.ssh
cp /tmp/ck/itadmin.pub /home/itadmin/.ssh/authorized_keys
ssh-keygen -t ed25519 -N "" -C "itadmin@mer-ws02" -f /home/itadmin/.ssh/id_ed25519 >/dev/null 2>&1
cat /home/itadmin/.ssh/id_ed25519.pub >> /home/itadmin/.ssh/authorized_keys
chmod 700 /home/itadmin/.ssh
chmod 644 /home/itadmin/.ssh/id_ed25519   # world-readable so the LFI can leak it
chmod 600 /home/itadmin/.ssh/authorized_keys
chown -R itadmin:itadmin /home/itadmin/.ssh
sed -i 's/^#*StrictModes.*/StrictModes no/' /etc/ssh/sshd_config
grep -q '^StrictModes' /etc/ssh/sshd_config || echo 'StrictModes no' >> /etc/ssh/sshd_config

# itadmin -> root via SUID python3
PY=$(command -v python3); [ -n "$PY" ] && chmod u+s "$(readlink -f "$PY")"

# IT toolbox log dir + some believable logs.
mkdir -p /var/log/ittools
cat > /var/log/ittools/maintenance.log <<'EOF'
[OK] nightly patch window completed on mer-web01, mer-db01
[WARN] mer-log01 disk at 71% - rotate Solr indices
[INFO] reminder: SIEM + LDAP admin creds are in itadmin's vault (~/.secrets)
EOF
echo "[OK] veeam backup job finished" > /var/log/ittools/backup.log
chown -R itweb:itweb /var/log/ittools

# Loot: the IT password vault (crosses to log01 + ipa01).
mkdir -p /home/itadmin/.secrets
cat > /home/itadmin/.secrets/vault.txt << 'EOF'
Meridian IT - credential vault (KEEP OFFLINE)

  mer-log01  SIEM/Solr admin    : admin / s13m-Adm1n-Meridian
  mer-fs01   file server (smb)   : itadmin / s13m-Adm1n-Meridian   (reused)
  mer-ipa01  LDAP Directory Mgr  : cn=Directory Manager / D1r3ctory-Mgr-Mer!
             ^ also the local login on the IPA host (reused).
EOF
chmod 600 /home/itadmin/.secrets/vault.txt
chown -R itadmin:itadmin /home/itadmin/.secrets
