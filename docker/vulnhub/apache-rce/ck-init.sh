#!/bin/bash
# CVE-2021-41773: Apache 2.4.49 path traversal + CGI RCE
# Foothold: RCE as daemon via path traversal
# Privesc: daemon -> ckplayer (sudo), ckplayer -> root (SUID python3)

# Allow daemon user to become ckplayer without password
echo "daemon ALL=(ckplayer) NOPASSWD:/bin/bash" >> /etc/sudoers
echo "daemon ALL=(ckplayer) NOPASSWD:/usr/bin/bash" >> /etc/sudoers

# SUID on python3 for ckplayer -> root
PY=$(command -v python3 2>/dev/null || command -v python 2>/dev/null)
if [ -n "$PY" ]; then
    chmod u+s "$PY"
fi

# Make /home/ckplayer readable so daemon can su to it
chmod 755 /home/ckplayer

# Intel hint embedded in a comment in /var/www/html/README
mkdir -p /usr/local/apache2/htdocs
cat > /usr/local/apache2/htdocs/README.txt << 'EOF'
Apache 2.4.49 - this server is running a legacy version.
CGI execution is enabled. Check the cgi-bin directory.
EOF
