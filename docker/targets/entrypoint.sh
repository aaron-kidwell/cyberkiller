#!/bin/bash
# Shared CyberKiller target entrypoint - the flag-plant contract every bundled
# target image follows. The control plane passes these env vars at `docker run`:
#   CK_ROOT_PASSWORD - password for root + the ckplayer pivot account. Random and
#                      NOT shown to players: they earn the foothold by exploiting
#                      the box; this is for the privesc chain + operator access.
#   CK_USER_FLAG     - written to /home/ckplayer/user.txt (the foothold flag)
#   CK_ROOT_FLAG     - written to /root/root.txt (the root flag)
# ckplayer is a real account in these bundled boxes' designed privesc chains (e.g.
# daemon -> ckplayer -> root). A per-image /ck-init.sh runs last to plant the vuln
# + loot. Arbitrary images added via "inject flags" get NO account - just the flags
# at the operator's chosen paths; the image's own vulnerability is the foothold.
set -e

if ! id ckplayer &>/dev/null; then
  useradd -m -s /bin/bash ckplayer
fi

# Set passwords - root and ckplayer share the same password for simplicity
if [ -n "${CK_ROOT_PASSWORD:-}" ]; then
  echo "root:${CK_ROOT_PASSWORD}" | chpasswd
  echo "ckplayer:${CK_ROOT_PASSWORD}" | chpasswd
fi

# Allow password auth for the box's accounts (privesc chain + operator access;
# the password isn't given to players).
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config
# Ensure UsePAM yes (Debian default, keeps password auth working)
grep -q '^UsePAM' /etc/ssh/sshd_config || echo 'UsePAM yes' >> /etc/ssh/sshd_config

if [ -n "${CK_USER_FLAG:-}" ]; then
  echo "${CK_USER_FLAG}" > /home/ckplayer/user.txt
else
  echo "# Write your arena handle here (same as hub login)" > /home/ckplayer/user.txt
fi
chown ckplayer:ckplayer /home/ckplayer/user.txt
chmod 644 /home/ckplayer/user.txt

if [ -n "${CK_ROOT_FLAG:-}" ]; then
  echo "${CK_ROOT_FLAG}" > /root/root.txt
else
  echo "# Write your arena handle here after root" > /root/root.txt
fi
chmod 600 /root/root.txt

# King-of-the-Hill throne file: whoever has root writes their hub handle here to
# hold the hill. Root-owned so claiming it requires the root foothold (that's the
# game); the control plane reads it server-side to score the holder.
[ -f /root/king.txt ] || echo "unclaimed" > /root/king.txt
chmod 644 /root/king.txt

mkdir -p /var/www/html
if [ ! -f /var/www/html/index.html ]; then
  echo '<html><body><h1>CyberKiller target</h1></body></html>' > /var/www/html/index.html
fi
if [ -x /ck-init.sh ]; then
  /ck-init.sh
fi
exec /usr/bin/supervisord -n -c /etc/supervisor/supervisord.conf
