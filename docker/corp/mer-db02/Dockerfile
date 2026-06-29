# mer-db02 - Meridian Redis cache (unauthenticated). Multiple ways in:
#   A) unauth Redis (:6379) -> write authorized_keys -> shell as svc-cache
#   B) command injection in the cache-admin console (:8080) -> shell as cacheadm
# Privesc: SUID /usr/bin/find (GTFOBins) -> root.
FROM debian:bookworm-slim

RUN apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    openssh-server supervisor sudo iproute2 procps curl redis-server redis-tools python3 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/run/sshd && ssh-keygen -A

COPY docker/corp/mer-db02/cacheadm.py /opt/cacheadm/cacheadm.py
COPY docker/corp/entrypoint.sh /entrypoint.sh
COPY docker/corp/mer-db02/supervisord.conf /etc/supervisor/supervisord.conf
COPY docker/corp/mer-db02/ck-init.sh /ck-init.sh
RUN chmod +x /entrypoint.sh /ck-init.sh

ENV CK_USER_FLAG_PATH=/home/svc-cache/user.txt CK_USER_FLAG_OWNER=svc-cache

EXPOSE 22 6379 8080
ENTRYPOINT ["/entrypoint.sh"]
