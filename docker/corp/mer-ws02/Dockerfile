# mer-ws02 - Meridian IT admin workstation. Multiple ways in:
#   A) path-traversal/LFI in the IT toolbox (:8000) -> read itadmin's SSH key -> SSH
#   B) SSH as itadmin using the deploy key looted from mer-app01
# Privesc: SUID /usr/bin/python3 (GTFOBins) -> root.
# Loot: itadmin password vault -> SIEM (log01) + LDAP (ipa01) creds.
FROM debian:bookworm-slim

RUN apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    openssh-server supervisor sudo iproute2 procps curl python3 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/run/sshd && ssh-keygen -A

COPY docker/corp/keys/itadmin.key.pub /tmp/ck/itadmin.pub
COPY docker/corp/mer-ws02/ittools.py /opt/ittools/ittools.py
COPY docker/corp/entrypoint.sh /entrypoint.sh
COPY docker/corp/mer-ws02/supervisord.conf /etc/supervisor/supervisord.conf
COPY docker/corp/mer-ws02/ck-init.sh /ck-init.sh
RUN chmod +x /entrypoint.sh /ck-init.sh

ENV CK_USER_FLAG_PATH=/home/itadmin/user.txt CK_USER_FLAG_OWNER=itadmin

EXPOSE 22 8000
ENTRYPOINT ["/entrypoint.sh"]
