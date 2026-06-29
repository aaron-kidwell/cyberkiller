#!/usr/bin/env python3
"""Meridian DB backup browser - internal tool on mer-db01:8080.
Serves /var/backups read-only with a directory listing. The nightly SQL dump
is world-readable here (info disclosure) - grab it and read the hr.onboarding
rows (jdev's SSH key) without a DB login. Runs as the 'dbweb' account."""
import http.server, functools, socketserver

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory="/var/backups")
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("0.0.0.0", 8080), Handler) as s:
    s.serve_forever()
