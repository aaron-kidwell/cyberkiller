# mer-ipa01 - Meridian central auth (OpenLDAP). The scenario objective.
# Foothold: SSH as ckplayer using the Directory Manager password (looted from
#   ws02 vault / fs01 backup) - credential reuse.
# Privesc: SUID /usr/bin/find (GTFOBins) -> root = central-auth takeover.
FROM debian:bookworm-slim

# Preseed slapd so apt installs it non-interactively with our DIT + admin pw.
RUN echo "slapd slapd/internal/generated_adminpw password D1r3ctory-Mgr-Mer!" | debconf-set-selections \
 && echo "slapd slapd/internal/adminpw password D1r3ctory-Mgr-Mer!" | debconf-set-selections \
 && echo "slapd slapd/password1 password D1r3ctory-Mgr-Mer!" | debconf-set-selections \
 && echo "slapd slapd/password2 password D1r3ctory-Mgr-Mer!" | debconf-set-selections \
 && echo "slapd slapd/domain string meridian.corp" | debconf-set-selections \
 && echo "slapd shared/organization string Meridian Logistics" | debconf-set-selections \
 && apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    openssh-server supervisor sudo iproute2 procps curl slapd ldap-utils \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /var/run/sshd && ssh-keygen -A

COPY docker/corp/entrypoint.sh /entrypoint.sh
COPY docker/corp/mer-ipa01/supervisord.conf /etc/supervisor/supervisord.conf
COPY docker/corp/mer-ipa01/ck-init.sh /ck-init.sh
RUN chmod +x /entrypoint.sh /ck-init.sh

ENV CK_USER_FLAG_PATH=/home/ldapadmin/user.txt CK_USER_FLAG_OWNER=ldapadmin

EXPOSE 22 389
ENTRYPOINT ["/entrypoint.sh"]
