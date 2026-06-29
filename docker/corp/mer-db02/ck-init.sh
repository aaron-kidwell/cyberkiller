#!/bin/bash
# mer-db02 - Meridian Redis cache (unauthenticated).
# Foothold: classic unauth-Redis RCE - CONFIG SET dir to svc-cache's .ssh,
#   dbfilename authorized_keys, store a key, SAVE -> shell as svc-cache.
# Privesc: SUID /usr/bin/find (GTFOBins) -> root.

# Realistic service accounts.
id svc-cache &>/dev/null || useradd -m -s /bin/bash svc-cache
id cacheadm &>/dev/null  || useradd -m -s /bin/bash cacheadm

[ -x /usr/bin/find ] && chmod u+s /usr/bin/find

# Redis (running as root) needs a writable data dir.
mkdir -p /var/lib/redis && chmod 777 /var/lib/redis

# Make svc-cache's .ssh writable so the public exploit path lands a shell.
mkdir -p /home/svc-cache/.ssh
chmod 777 /home/svc-cache/.ssh
chown svc-cache:svc-cache /home/svc-cache/.ssh 2>/dev/null || true

cat > /var/lib/redis/HINT.txt << 'EOF'
Redis 6.x - no requirepass, bound to all interfaces (port 6379).
Cache holds CI pipeline tokens. Known unauth-RCE: write an SSH key via
CONFIG SET dir/dbfilename + SAVE. Target a writable .ssh directory.
EOF
chmod 644 /var/lib/redis/HINT.txt
