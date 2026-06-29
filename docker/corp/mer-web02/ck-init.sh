#!/bin/bash
# mer-web02 - Meridian internal intranet/CMS.
# Foothold: CVE-2017-5638 Struts2 OGNL RCE.
# Privesc: SUID /usr/bin/env (GTFOBins) -> root.
# Loot: intranet backup notes naming the SIEM (log01) and dev user jdev.

# Realistic intranet maintainer account (home holds the user flag).
id webadmin &>/dev/null || useradd -m -s /bin/bash webadmin

# SUID env for the user->root step (GTFOBins: env -> /bin/sh)
[ -x /usr/bin/env ] && chmod u+s /usr/bin/env

# --- Loot: leaked intranet backup with internal notes ---
mkdir -p /var/backups
cat > /var/backups/intranet.bak << 'EOF'
Meridian Intranet - ops wiki snapshot (DO NOT DISTRIBUTE)

* Central logging: all hosts ship syslog to mer-log01 (10.66.20.58, Solr/SIEM).
  Ask IT (itadmin) for the SIEM admin password - it's in their vault.
* Dev onboarding: new devs get an account 'jdev' on the dev workstation.
  Their SSH key is stored in the HR onboarding DB (mer-db01) until first login.
* Reminder: rotate the shipment-portal DB creds, they are reused internally.
EOF
chmod 644 /var/backups/intranet.bak

# More recon: a Tomcat manager creds file + a deploy note (lateral hints).
mkdir -p /opt/tomcat/conf
cat > /opt/tomcat/conf/tomcat-users.xml << 'EOF'
<tomcat-users>
  <!-- manager account for the ops team -->
  <user username="deployer" password="T0mcat-Deploy!" roles="manager-gui,manager-script"/>
  <!-- NOTE: deployer pw is reused for the 'webadmin' shell account here -->
</tomcat-users>
EOF
chmod 644 /opt/tomcat/conf/tomcat-users.xml
# Make the reuse real: webadmin's SSH password == the tomcat deployer password.
echo "webadmin:T0mcat-Deploy!" | chpasswd

cat > /opt/meridian-deploy-notes.txt << 'EOF'
Intranet deploy runbook:
 - app ships from mer-app01 (Jenkins, 10.66.20.54)
 - logs ship to the SIEM mer-log01 (10.66.20.58)
 - DB: mer-db01, app account creds in the portal include on mer-web01
EOF
chmod 644 /opt/meridian-deploy-notes.txt
