#!/usr/bin/env python3
"""Meridian cache admin - internal Redis ops tool on mer-db02:8080.
The 'name' field of the backup feature is passed to the shell unsanitised
(command injection). Foothold: RCE as the 'cacheadm' service account.
Also surfaces cache keys (info disclosure) for recon."""
import http.server, subprocess, urllib.parse, socketserver

PAGE = """<!doctype html><html><head><title>Meridian Cache Admin</title>
<style>body{{font-family:Arial;background:#10131f;color:#dde}}.w{{max-width:700px;margin:40px auto}}
input{{padding:8px;background:#0b0f18;color:#fff;border:1px solid #345}}button{{padding:8px 14px;background:#2bd4c0;border:0;font-weight:bold}}
pre{{background:#0b0f18;padding:12px;border:1px solid #243;white-space:pre-wrap}}</style></head>
<body><div class="w"><h2 style="color:#2bd4c0">◆ Meridian Cache Admin <small style="color:#566">redis ops</small></h2>
<h4>Cache keys</h4><pre>{keys}</pre>
<h4>Snapshot backup</h4>
<form><input name="name" placeholder="backup-name"><button>Create snapshot</button></form>
<pre>{out}</pre>
<p style="color:#566;font-size:12px">svc-cache owns the cache. cacheadm runs this console.</p></div></body></html>"""

def keys():
    try:
        ks = subprocess.getoutput("redis-cli keys '*'").split()
        lines = []
        for k in ks[:20]:
            v = subprocess.getoutput("redis-cli get %s" % k)
            lines.append("%s = %s" % (k, v))
        return "\n".join(lines) or "(empty)"
    except Exception as e:
        return "err: %s" % e

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        q = urllib.parse.urlparse(self.path)
        p = urllib.parse.parse_qs(q.query)
        out = ""
        name = p.get("name", [""])[0]
        if name:
            # VULN: command injection
            out = subprocess.getoutput("sh -c 'redis-cli save && cp /var/lib/redis/dump.rdb /tmp/" + name + ".rdb' 2>&1")
            out += "\nsnapshot requested: " + name
        self.send_response(200); self.send_header("Content-Type", "text/html"); self.end_headers()
        self.wfile.write(PAGE.format(keys=keys(), out=out).encode())

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("0.0.0.0", 8080), H) as s:
    s.serve_forever()
