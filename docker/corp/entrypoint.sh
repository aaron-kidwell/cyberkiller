#!/bin/bash
# MERIDIAN corp-scenario entrypoint. Unlike the generic target entrypoint, this
# does NOT create a "ckplayer" account - each box's ck-init creates realistic
# corporate accounts (www-data, jenkins, jdev, itadmin, dbadmin, ...). It also
# applies a shared layer of "enterprise dressing" (hostname, internal DNS via
# /etc/hosts, corporate login banner, seeded logs) so every box feels like a
# real Meridian server, not a bare container. Flags are planted into the
# configured foothold account's home.
set -e

HOST="$(hostname)"
ROLE="${CK_ROLE:-corporate server}"

# --- Enterprise dressing (applies to every MERIDIAN box) -------------------

# Internal name resolution: the whole Meridian network resolves by name, so
# enumeration and lateral movement feel like a real internal LAN.
cat >> /etc/hosts <<'HOSTS'
10.66.20.50  mer-web01.meridian.corp  mer-web01
10.66.20.51  mer-web02.meridian.corp  mer-web02
10.66.20.52  mer-db01.meridian.corp   mer-db01
10.66.20.53  mer-db02.meridian.corp   mer-db02
10.66.20.54  mer-app01.meridian.corp  mer-app01
10.66.20.55  mer-ws01.meridian.corp   mer-ws01
10.66.20.56  mer-ws02.meridian.corp   mer-ws02
10.66.20.57  mer-fs01.meridian.corp   mer-fs01
10.66.20.58  mer-log01.meridian.corp  mer-log01
10.66.20.59  mer-ipa01.meridian.corp  mer-ipa01
HOSTS

# Corporate login banner (SSH + console).
BANNER="/etc/motd"
cat > "$BANNER" <<EOF

  ╔══════════════════════════════════════════════════════════════╗
  ║   MERIDIAN LOGISTICS - internal systems                        ║
  ║   $(printf '%-58s' "host: ${HOST}  ·  role: ${ROLE}") ║
  ║   AUTHORISED PERSONNEL ONLY. Activity is logged and monitored. ║
  ║   Questions: IT Service Desk x4500 / helpdesk@meridian.corp    ║
  ╚══════════════════════════════════════════════════════════════╝

EOF
sed -i 's/^#\?PrintMotd.*/PrintMotd yes/' /etc/ssh/sshd_config 2>/dev/null || true
cp "$BANNER" /etc/issue.net 2>/dev/null || true
sed -i 's@^#\?Banner.*@Banner /etc/issue.net@' /etc/ssh/sshd_config 2>/dev/null || true

# Seed a little day-to-day history in the logs so the box looks lived-in.
mkdir -p /var/log
NOW="$(date '+%b %d %H:%M:%S' 2>/dev/null || echo 'Jan 01 09:00:00')"
{
  echo "$NOW $HOST CRON[2114]: (root) CMD (/usr/local/sbin/backup-rotate.sh)"
  echo "$NOW $HOST systemd[1]: Started Daily apt download activities."
  echo "$NOW $HOST CRON[2390]: (root) CMD (/usr/local/sbin/health-report.sh)"
} >> /var/log/syslog 2>/dev/null || true

# A real recurring job so `crontab`/ps/log inspection shows live operations.
cat > /usr/local/sbin/health-report.sh <<'EOS'
#!/bin/sh
echo "$(date) $(hostname) health OK uptime=$(cut -d. -f1 /proc/uptime 2>/dev/null)s" >> /var/log/meridian-health.log
EOS
chmod +x /usr/local/sbin/health-report.sh
echo "*/10 * * * * root /usr/local/sbin/health-report.sh" > /etc/cron.d/meridian-health 2>/dev/null || true

# --- Standard platform plumbing -------------------------------------------

[ -n "${CK_ROOT_PASSWORD:-}" ] && echo "root:${CK_ROOT_PASSWORD}" | chpasswd
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config
grep -q '^UsePAM' /etc/ssh/sshd_config || echo 'UsePAM yes' >> /etc/ssh/sshd_config

if [ -n "${CK_KOTH_TOKEN:-}" ]; then
  echo "${CK_KOTH_TOKEN}" > /root/.koth_token
  chmod 400 /root/.koth_token
fi

# Box-specific setup: creates the realistic foothold user(s), loot, privesc.
[ -x /ck-init.sh ] && /ck-init.sh

# Plant the user flag into the foothold account's home (after ck-init made it).
UF="${CK_USER_FLAG_PATH:-/home/operator/user.txt}"
mkdir -p "$(dirname "$UF")"
if [ -n "${CK_USER_FLAG:-}" ]; then
  echo "${CK_USER_FLAG}" > "$UF"
else
  echo "# Write your arena handle here (same as your hub login) to score the user flag" > "$UF"
fi
# World-writable so ANY foothold account can submit the user flag (the exploit
# may land as a different user than the flag's owner, e.g. daemon vs www-data).
chmod 666 "$UF"
[ -n "${CK_USER_FLAG_OWNER:-}" ] && chown "${CK_USER_FLAG_OWNER}:${CK_USER_FLAG_OWNER}" "$UF" 2>/dev/null || true

# Lived-in feel: give the foothold account a plausible shell history and a
# recent-login record, so a player landing on the box sees real day-to-day
# operator activity rather than a sterile container. (Applies to every box.)
OWN="${CK_USER_FLAG_OWNER:-root}"
OWN_HOME="$(getent passwd "$OWN" 2>/dev/null | cut -d: -f6)"
[ -z "$OWN_HOME" ] && OWN_HOME="/root"
if [ -d "$OWN_HOME" ]; then
  cat > "$OWN_HOME/.bash_history" <<HIST
ls -la
df -h
sudo -l
tail -n50 /var/log/syslog
systemctl status
ssh ${OWN}@mer-app01
cat /etc/hosts
crontab -l
exit
HIST
  chown "$OWN":"$OWN" "$OWN_HOME/.bash_history" 2>/dev/null || true
  chmod 600 "$OWN_HOME/.bash_history" 2>/dev/null || true
fi
# Wtmp-style last-login note in MOTD footer.
echo "Last login: $(date '+%a %b %d %H:%M' 2>/dev/null) from 10.66.20.1" >> /etc/motd 2>/dev/null || true

# Root flag is always /root/root.txt - root is root on any real box.
if [ -n "${CK_ROOT_FLAG:-}" ]; then
  echo "${CK_ROOT_FLAG}" > /root/root.txt
else
  echo "# Write your arena handle here once you have root to score the root flag" > /root/root.txt
fi
chmod 600 /root/root.txt

exec /usr/bin/supervisord -n -c /etc/supervisor/supervisord.conf
