#!/usr/bin/env python3
"""Meridian IT toolbox - internal log viewer on mer-ws02:8000.
The 'file' param is joined to a base dir with no traversal check (path
traversal / LFI). Read arbitrary files -> grab itadmin's SSH key -> SSH in."""
import http.server, urllib.parse, os, socketserver

BASE = "/var/log/ittools"
PAGE = """<!doctype html><html><head><title>Meridian IT Toolbox</title>
<style>body{{font-family:Arial;background:#10131f;color:#dde}}.w{{max-width:720px;margin:40px auto}}
a{{color:#7fb}}pre{{background:#0b0f18;padding:12px;border:1px solid #243;white-space:pre-wrap;overflow:auto}}</style></head>
<body><div class="w"><h2 style="color:#2bd4c0">◆ Meridian IT Toolbox <small style="color:#566">log viewer</small></h2>
<p>View a maintenance log:
<a href="/?file=maintenance.log">maintenance.log</a> |
<a href="/?file=backup.log">backup.log</a></p>
<pre>{out}</pre>
<p style="color:#566;font-size:12px">itadmin - restrict this to the log dir before exposing it more widely.</p>
</div></body></html>"""

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        q = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(q.query)
        out = "Select a log above."
        f = params.get("file", [""])[0]
        if f:
            # VULN: no sanitisation -> path traversal / LFI
            try:
                with open(os.path.join(BASE, f)) as fh:
                    out = fh.read()
            except Exception as e:
                out = "error: %s" % e
        self.send_response(200); self.send_header("Content-Type", "text/html"); self.end_headers()
        self.wfile.write(PAGE.format(out=urllib.parse.quote(out) if False else out.replace("<","&lt;")).encode())

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("0.0.0.0", 8000), H) as s:
    s.serve_forever()
