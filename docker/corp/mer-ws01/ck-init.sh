#!/bin/bash
# mer-ws01 - Meridian developer workstation. Multiple ways in:
#   A) command injection in the :8000 build dashboard -> shell as devweb
#   B) SSH as jdev with the key looted from mer-db01
# Privesc:
#   devweb -> root  via a root cron that runs a devweb-writable deploy script
#   jdev   -> root  via sudo /usr/bin/find (GTFOBins)

# --- accounts ---
id devweb &>/dev/null || useradd -m -s /bin/bash devweb
id jdev   &>/dev/null || useradd -m -s /bin/bash jdev
mkdir -p /home/jdev/.ssh
cp /tmp/ck/jdev.pub /home/jdev/.ssh/authorized_keys
chmod 700 /home/jdev/.ssh && chmod 600 /home/jdev/.ssh/authorized_keys
chown -R jdev:jdev /home/jdev/.ssh

# jdev -> root
grep -q "jdev ALL=(root) NOPASSWD:/usr/bin/find" /etc/sudoers || \
  echo "jdev ALL=(root) NOPASSWD:/usr/bin/find" >> /etc/sudoers

# devweb -> root: a root cron runs the deploy script, which devweb can edit.
mkdir -p /opt/devdash
cat > /opt/devdash/deploy.sh <<'EOS'
#!/bin/sh
# nightly build-artifact sync (runs as root via cron)
:
EOS
chown devweb:devweb /opt/devdash/deploy.sh
chmod 775 /opt/devdash/deploy.sh
echo "* * * * * root /bin/sh /opt/devdash/deploy.sh" > /etc/cron.d/meridian-deploy 2>/dev/null || true

# --- recon breadcrumbs ---
# A git repo whose history leaks a credential (git log -p / show).
if command -v git >/dev/null; then
  su - jdev -c '
    mkdir -p ~/portal-ci && cd ~/portal-ci && git init -q
    git config user.email jdev@meridian.corp; git config user.name jdev
    printf "DB_HOST=10.66.20.52\nDB_USER=meridian_app\nDB_PASS=Fr3ight-Db-2024!\n" > .env
    git add .env && git commit -qm "add portal env (temp)"
    git rm -q .env && echo ".env" > .gitignore && git add .gitignore && git commit -qm "remove secret, gitignore it"
  ' 2>/dev/null
fi

cat > /home/jdev/work-notes.md << 'EOF'
# Dev notes
- Build dashboard (port 8000) still has the unsanitised host field - my bad, will fix.
- CI is on mer-app01 (10.66.20.54). itadmin owns the deploy pipeline on mer-ws02.
- The deploy cron on this box runs /opt/devdash/deploy.sh as root.
- Old portal env (with DB creds) is in my git history under ~/portal-ci.
EOF
chown jdev:jdev /home/jdev/work-notes.md
