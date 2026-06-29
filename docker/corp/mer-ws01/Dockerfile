# mer-ws01 - Meridian developer workstation.
# Foothold A: command injection in the internal build dashboard (:8000) -> devweb.
# Foothold B: SSH as 'jdev' using the PEM private key looted from mer-db01.
# Privesc: sudo /usr/bin/find (GTFOBins) -> root.
FROM debian:bookworm-slim

RUN apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    openssh-server supervisor sudo iproute2 procps curl python3 iputils-ping git cron \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/run/sshd && ssh-keygen -A

COPY docker/corp/keys/jdev_id_rsa.pub /tmp/ck/jdev.pub
COPY docker/corp/mer-ws01/devdash.py /opt/devdash/devdash.py
COPY docker/corp/entrypoint.sh /entrypoint.sh
COPY docker/corp/mer-ws01/supervisord.conf /etc/supervisor/supervisord.conf
COPY docker/corp/mer-ws01/ck-init.sh /ck-init.sh
RUN chmod +x /entrypoint.sh /ck-init.sh

ENV CK_USER_FLAG_PATH=/home/jdev/user.txt CK_USER_FLAG_OWNER=jdev

EXPOSE 22 8000
ENTRYPOINT ["/entrypoint.sh"]
