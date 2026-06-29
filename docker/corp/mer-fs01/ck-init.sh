#!/bin/bash
# mer-fs01 - Meridian file server (Samba).
# Foothold: SSH as 'itadmin' (IT creds reused, looted from ws02 / anon SMB).
# Privesc: sudo /usr/bin/tar (GTFOBins) -> root.
# Loot: /srv/backups/ipa-backup.tgz -> LDAP Directory Manager password.

id itadmin &>/dev/null || useradd -m -s /bin/bash itadmin
echo "itadmin:s13m-Adm1n-Meridian" | chpasswd

# itadmin -> root via sudo tar
if ! grep -q "itadmin ALL=(root) NOPASSWD:/usr/bin/tar" /etc/sudoers 2>/dev/null; then
  echo "itadmin ALL=(root) NOPASSWD:/usr/bin/tar" >> /etc/sudoers
fi

# Second entry path: anonymous-writable [deploy] share + a root cron that runs
# anything dropped there. Drop a .sh via smbclient -> root RCE within a minute.
mkdir -p /opt/deploy
chmod 777 /opt/deploy
cat > /usr/local/sbin/run-deploy.sh <<'EOS'
#!/bin/sh
for f in /opt/deploy/*.sh; do [ -f "$f" ] && /bin/sh "$f" >>/var/log/deploy.log 2>&1 && rm -f "$f"; done
EOS
chmod +x /usr/local/sbin/run-deploy.sh
echo "* * * * * root /usr/local/sbin/run-deploy.sh" > /etc/cron.d/meridian-deploy
cat > /opt/deploy/README.txt <<'EOF'
Drop maintenance scripts (*.sh) here - the ops cron runs them automatically.
EOF

# vsftpd needs its chroot helper dir (/var/run is tmpfs, wiped each start).
mkdir -p /var/run/vsftpd/empty

# Anonymous FTP root - leaks an smb.conf backup + a creds note (recon).
mkdir -p /srv/ftp/pub
cat > /srv/ftp/pub/smb.conf.bak <<'EOF'
# Meridian fileserver samba backup
# itadmin maintenance login (reused org-wide): itadmin / s13m-Adm1n-Meridian
# NOTE: the [deploy] share is writable by guests and a root cron runs it (!)
EOF
cat > /srv/ftp/pub/README <<'EOF'
Public FTP drop. Old config backups under pub/. Do not store secrets here (oops).
EOF
chmod -R 755 /srv/ftp
chown -R nobody:nogroup /srv/ftp 2>/dev/null || true

# Backups share content - readable anonymously over SMB.
mkdir -p /srv/backups /tmp/ipa
cat > /tmp/ipa/dirmgr.txt << 'EOF'
FreeIPA / LDAP backup - mer-ipa01 (10.66.20.59)
  Directory Manager DN : cn=Directory Manager
  Directory Manager pw : D1r3ctory-Mgr-Mer!
  (reused as the local login on the IPA host)
EOF
tar -czf /srv/backups/ipa-backup.tgz -C /tmp ipa 2>/dev/null
rm -rf /tmp/ipa
cat > /srv/backups/README.txt << 'EOF'
IT backups. ipa-backup.tgz = nightly export of the central auth server.
EOF
chmod -R 755 /srv/backups
