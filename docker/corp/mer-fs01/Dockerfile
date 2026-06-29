# mer-fs01 - Meridian file server (Samba).
# Foothold: anonymous SMB read of the 'backups' share leaks creds; the IT creds
#   (looted on ws02) are reused as SSH login 'itadmin' here (credential reuse).
# Privesc: sudo /usr/bin/tar (GTFOBins) -> root.
# Loot: /srv/backups/ipa-backup.tgz -> LDAP Directory Manager password (ipa01).
FROM debian:bookworm-slim

RUN apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    openssh-server supervisor sudo iproute2 procps curl samba smbclient cron vsftpd \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/run/sshd && ssh-keygen -A

COPY docker/corp/entrypoint.sh /entrypoint.sh
COPY docker/corp/mer-fs01/supervisord.conf /etc/supervisor/supervisord.conf
COPY docker/corp/mer-fs01/smb.conf /etc/samba/smb.conf
COPY docker/corp/mer-fs01/vsftpd.conf /etc/vsftpd.conf
COPY docker/corp/mer-fs01/ck-init.sh /ck-init.sh
RUN chmod +x /entrypoint.sh /ck-init.sh

ENV CK_USER_FLAG_PATH=/home/itadmin/user.txt CK_USER_FLAG_OWNER=itadmin

EXPOSE 21 22 445
ENTRYPOINT ["/entrypoint.sh"]
