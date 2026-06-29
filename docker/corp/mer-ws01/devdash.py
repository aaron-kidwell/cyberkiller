#!/usr/bin/env python3
"""Meridian dev build dashboard - internal tool on mer-ws01:8000.
Lets devs check connectivity to build hosts. The 'host' param is passed
straight to the shell (command injection) - a realistic homegrown-tool bug.
Foothold: RCE as the 'devweb' service account."""
import http.server, subprocess, urllib.parse, socketserver

PAGE = """<!doctype html><html><head><title>Meridian Build Dashboard</title>
<style>body{{font-family:Arial;background:#10131f;color:#dde}}.w{{max-width:680px;margin:50px auto}}
input{{padding:8px;width:60%;background:#0b0f18;color:#fff;border:1px solid #345}}
button{{padding:8px 14px;background:#2bd4c0;border:0;font-weight:bold}}
pre{{background:#0b0f18;padding:12px;border:1px solid #243;white-space:pre-wrap}}</style></head>
<body><div class="w"><h2 style="color:#2bd4c0">◆ Meridian Build Dashboard <small style="color:#566">v0.9 (internal)</small></h2>
<p>Connectivity check to a build host:</p>
<form><input name="host" placeholder="mer-app01"><button>Ping</button></form>
<pre>{out}</pre>
<p style="color:#566;font-size:12px">jdev - TODO: sanitise the host field before we ship this. Pipeline notes in
~/notes. CI deploy runs as devweb.</p></div></body></html>"""

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        q = urllib.parse.urlparse(self.path)
        out = ""
        if q.path in ("/", "/index.html"):
            params = urllib.parse.parse_qs(q.query)
            host = params.get("host", [""])[0]
            if host:
                # VULN: unsanitised shell interpolation -> command injection
                out = subprocess.getoutput("ping -c1 -W1 " + host)
            self.send_response(200); self.send_header("Content-Type", "text/html"); self.end_headers()
            self.wfile.write(PAGE.format(out=out).encode())
        else:
            self.send_response(404); self.end_headers()

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("0.0.0.0", 8000), H) as s:
    s.serve_forever()
