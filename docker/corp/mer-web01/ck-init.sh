#!/bin/bash
# mer-web01 - Meridian DMZ web app. Entry point of the MERIDIAN scenario.
# Foothold: CVE-2021-41773 path-traversal CGI RCE as the web server user (daemon).
# Privesc: SUID python -> root.
# Loot: DB connection include with mer-db01 creds (credential reuse downstream).

# Web user -> root via SUID python (GTFOBins). Whichever python the EOL base ships
# (python3 or python2.7) gets the SUID bit - both work via GTFOBins.
PY=$(command -v python3 2>/dev/null || command -v python 2>/dev/null)
[ -n "$PY" ] && chmod u+s "$PY"

# Second foothold: /backup/portal-config.php.bak leaks "portaladmin / Sh1pp1ng#Portal!".
# Create that account so the documented credential-recon SSH path actually works.
id portaladmin >/dev/null 2>&1 || useradd -m -s /bin/bash portaladmin 2>/dev/null
echo 'portaladmin:Sh1pp1ng#Portal!' | chpasswd 2>/dev/null

# Ensure /var/www exists and is owned by the web user (where the flag is planted).
mkdir -p /var/www && chown www-data:www-data /var/www 2>/dev/null || true

# Web content (portal, robots.txt, /backup, /inc, /portal) ships in the image
# under htdocs - see docker/corp/mer-web01/webroot/. Recon path: robots.txt ->
# /backup/portal-config.php.bak leaks the db01 creds even without RCE.
chmod -R 644 /usr/local/apache2/htdocs/backup/* 2>/dev/null || true
