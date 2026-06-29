#!/bin/bash
# mer-app01 - Meridian internal CI (Jenkins).
# Foothold: CVE-2018-1000861 Jenkins script RCE (lands as 'jenkins').
# Privesc: jenkins sudo /usr/bin/vi (GTFOBins) -> root.
# Loot: itadmin deploy key (PEM) used to SSH into the IT workstation (ws02).

# jenkins -> root via sudo vi
if ! grep -q "jenkins ALL=(root) NOPASSWD:/usr/bin/vi" /etc/sudoers 2>/dev/null; then
  echo "jenkins ALL=(root) NOPASSWD:/usr/bin/vi" >> /etc/sudoers
fi

# --- Loot: itadmin deploy key planted in Jenkins secrets ---
mkdir -p /var/jenkins_home/secrets
if [ -f /tmp/ck/itadmin.key ]; then
  cp /tmp/ck/itadmin.key /var/jenkins_home/secrets/itadmin.key
  chmod 644 /var/jenkins_home/secrets/itadmin.key
fi
cat > /var/jenkins_home/secrets/DEPLOY_NOTES.txt << 'EOF'
Deploy pipeline uses key 'itadmin.key' to push builds to the IT admin
workstation (mer-ws02, 10.66.20.56) as user 'itadmin'.
  ssh -i itadmin.key itadmin@10.66.20.56
EOF
chmod 644 /var/jenkins_home/secrets/DEPLOY_NOTES.txt

# Recon: a Jenkins credentials store + job config + build log leaking secrets.
mkdir -p /var/jenkins_home/jobs/portal-deploy/builds/42
cat > /var/jenkins_home/credentials.xml << 'EOF'
<com.cloudbees.plugins.credentials.SystemCredentialsProvider>
  <domainCredentialsMap>
    <entry><credentials>
      <com.cloudbees...UsernamePasswordCredentialsImpl>
        <id>db-meridian</id><username>meridian_app</username>
        <password>Fr3ight-Db-2024!</password>
        <description>portal DB (mer-db01)</description>
      </com.cloudbees...UsernamePasswordCredentialsImpl>
      <basicSSHUserPrivateKey><username>itadmin</username>
        <description>deploy key -> mer-ws02 (see secrets/itadmin.key)</description>
      </basicSSHUserPrivateKey>
    </credentials></entry>
  </domainCredentialsMap>
</com.cloudbees.plugins.credentials.SystemCredentialsProvider>
EOF
cat > /var/jenkins_home/jobs/portal-deploy/builds/42/log << 'EOF'
Started by user jdev
+ scp -i /var/jenkins_home/secrets/itadmin.key build.tgz itadmin@10.66.20.56:/opt
+ ssh itadmin@mer-ws02 'systemctl restart portal'
Finished: SUCCESS
EOF
chmod -R 644 /var/jenkins_home/credentials.xml /var/jenkins_home/jobs/portal-deploy/builds/42/log
chown -R 1000:1000 /var/jenkins_home/secrets /var/jenkins_home/credentials.xml /var/jenkins_home/jobs 2>/dev/null || true
rm -rf /tmp/ck
