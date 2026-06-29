# mer-db01 - Meridian primary database (MySQL/MariaDB).
# Foothold: the shipment-portal DB creds looted from web01 are REUSED as the
#   'dbadmin' SSH password (credential reuse) -> shell as dbadmin.
# Privesc: sudo /usr/bin/mysql (GTFOBins: \! /bin/bash) -> root.
# Loot: hr.onboarding table holds the 'jdev' SSH private key -> ws01.
FROM debian:bookworm-slim

RUN apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    openssh-server supervisor sudo iproute2 procps curl mariadb-server mariadb-client python3 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/run/sshd && ssh-keygen -A

# Seed the database at build time (reliable, no runtime race).
COPY docker/corp/keys/jdev_id_rsa /tmp/ck/jdev_id_rsa
COPY docker/corp/mer-db01/seed.sh /tmp/ck/seed.sh
RUN chmod +x /tmp/ck/seed.sh && /tmp/ck/seed.sh && rm -rf /tmp/ck

COPY docker/corp/mer-db01/my.cnf /etc/mysql/conf.d/zz-meridian.cnf
COPY docker/corp/mer-db01/backupweb.py /opt/backupweb/backupweb.py
COPY docker/corp/entrypoint.sh /entrypoint.sh
COPY docker/corp/mer-db01/supervisord.conf /etc/supervisor/supervisord.conf
COPY docker/corp/mer-db01/ck-init.sh /ck-init.sh
RUN chmod +x /entrypoint.sh /ck-init.sh

ENV CK_USER_FLAG_PATH=/home/dbadmin/user.txt CK_USER_FLAG_OWNER=dbadmin

EXPOSE 22 3306 8080
ENTRYPOINT ["/entrypoint.sh"]
