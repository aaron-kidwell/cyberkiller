#!/bin/bash
# CVE-2022-22965: Spring4Shell - Spring Framework RCE via data binding
# Foothold: Craft POST to manipulate class.module.classLoader → write JSP via access log
# Exploit steps:
#   1. POST /hello with params: class.module.classLoader.resources.context.parent.pipeline.first.*
#      Specifically: suffix=.jsp, dir=webapps/ROOT, prefix=tomcatwar, fileDateFormat=_
#      pattern=%{prefix}i java.io.InputStream in=...
#   2. Access http://TARGET/tomcatwar.jsp?pwd=thymeleaf&cmd=id
# Requires: JDK9+, Spring 5.3.17, Tomcat 9+ deployed as WAR
# User: tomcat/root depending on image
# Privesc: sudo rule or writable /etc/cron.d

# Create spring user for process isolation
id spring &>/dev/null || useradd -r -s /bin/bash -m spring

# Allow spring/tomcat process user to escalate
echo "ALL ALL=(ckplayer) NOPASSWD:/bin/bash" >> /etc/sudoers

# World-writable /etc/cron.d for a harder privesc path
echo "* * * * * root /opt/cleanup.sh 2>/dev/null" > /etc/cron.d/cleanup
cat > /opt/cleanup.sh << 'EOF'
#!/bin/bash
find /tmp -type f -mtime +7 -delete 2>/dev/null
EOF
chmod 777 /opt/cleanup.sh
chmod 644 /etc/cron.d/cleanup

# Find the actual JAR and make sure it's configured correctly
find /app /opt /root -name "*.jar" 2>/dev/null | head -1 | xargs -I{} chmod 644 {} 2>/dev/null || true
