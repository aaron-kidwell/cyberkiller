#!/bin/bash
# mer-log01 - Meridian SIEM / central log collector (crown jewel #1).
# Foothold: CVE-2021-44228 Log4Shell via Solr (lands as 'solr').
# Privesc: SUID /usr/bin/find (GTFOBins) -> root.
# Loot: central log visibility; confirms the SIEM admin password (from ws02).

# Ensure the solr account's home exists for the user flag.
id solr &>/dev/null && mkdir -p /home/solr && chown solr /home/solr 2>/dev/null || true

[ -x /usr/bin/find ] && chmod u+s /usr/bin/find

mkdir -p /opt/siem
cat > /opt/siem/INGEST_SOURCES.txt << 'EOF'
Meridian SIEM - ingest sources (syslog/beats):
  mer-web01 .50   mer-web02 .51   mer-db01 .52   mer-db02 .53
  mer-app01 .54   mer-ws01  .55   mer-ws02 .56   mer-fs01 .57
  mer-ipa01 .59  (LDAP/central auth - Directory Manager auth events here)
SIEM admin console: https://10.66.20.58:8983/solr/  (admin pw held by IT)
EOF
chmod 644 /opt/siem/INGEST_SOURCES.txt

cat > /opt/siem/auth-events.log << 'EOF'
... sshd[mer-ws02]: Accepted publickey for itadmin
... slapd[mer-ipa01]: BIND dn="cn=Directory Manager" mech=SIMPLE ssf=0
... slapd[mer-ipa01]: hint: Directory Manager credential is reused as the IPA root login
EOF
chmod 644 /opt/siem/auth-events.log

# The SIEM ingests cleartext logs from every host - a recon goldmine. Reading
# the indexed logs leaks credentials used across the network (over-logging is a
# classic real-world SIEM problem).
mkdir -p /opt/siem/ingest
cat > /opt/siem/ingest/meridian-syslog.log << 'EOF'
mer-db01 mariadb: [Warning] Access granted user='meridian_app' host='10.66.20.50' (using password: Fr3ight-Db-2024!)
mer-fs01 vsftpd: CONNECT anonymous; smb itadmin reused pw s13m-Adm1n-Meridian
mer-ws02 sudo:   itadmin : TTY=pts/0 ; PWD=/home/itadmin ; USER=root ; COMMAND=/usr/bin/python3
mer-ipa01 slapd: bind cn=Directory Manager pw=D1r3ctory-Mgr-Mer! (debug logging left on!)
mer-app01 jenkins: deploy job used key itadmin.key -> mer-ws02
mer-web01 apache: GET /backup/portal-config.php.bak 200 (config backup is web-exposed!)
mer-ws01 cron:   root CMD (/opt/devdash/deploy.sh)  # devweb-writable -> root
EOF
chmod 644 /opt/siem/ingest/meridian-syslog.log
