#!/bin/bash
# mer-db01 - Meridian primary database.
# Credential reuse: the shipment-portal DB password (looted from web01) is also
# the 'dbadmin' SSH password here. Privesc: sudo mysql (GTFOBins) -> root.

# MariaDB needs its socket dir at runtime (/run is tmpfs, wiped each start).
mkdir -p /run/mysqld && chown mysql:mysql /run/mysqld

# DBA account; the DB password is reused as their SSH login (credential reuse).
id dbadmin &>/dev/null || useradd -m -s /bin/bash dbadmin
id dbweb &>/dev/null   || useradd -m -s /usr/sbin/nologin dbweb
echo "dbadmin:Fr3ight-Db-2024!" | chpasswd

# Recon breadcrumb: dbadmin's mysql history leaks the query patterns + a root login.
cat > /home/dbadmin/.mysql_history <<'EOF'
mysql -u root
select * from hr.onboarding;
update mysql.user set authentication_string=PASSWORD('Fr3ight-Db-2024!') where User='meridian_app';
-- note: nightly dump goes to /var/backups (served on :8080)
flush privileges;
EOF
chown dbadmin:dbadmin /home/dbadmin/.mysql_history; chmod 600 /home/dbadmin/.mysql_history

# dbadmin -> root via sudo mysql ( \! /bin/bash )
if ! grep -q "dbadmin ALL=(root) NOPASSWD:/usr/bin/mysql" /etc/sudoers 2>/dev/null; then
  echo "dbadmin ALL=(root) NOPASSWD:/usr/bin/mysql" >> /etc/sudoers
fi

# Second entry path: a service account whose .ssh is writable by the mysql
# process, so the MySQL FILE-priv (INTO OUTFILE) RCE lands a real shell:
#   SELECT '<your pubkey>' INTO OUTFILE '/home/svc-sql/.ssh/authorized_keys'
id svc-sql &>/dev/null || useradd -m -s /bin/bash svc-sql
mkdir -p /home/svc-sql/.ssh
chmod 777 /home/svc-sql/.ssh
chown svc-sql:svc-sql /home/svc-sql/.ssh 2>/dev/null || true
# OUTFILE writes authorized_keys as the mysql user into a world-writable .ssh;
# relax StrictModes so sshd still accepts it (the misconfig that makes the
# FILE-priv -> RCE path actually pop a shell).
sed -i 's/^#*StrictModes.*/StrictModes no/' /etc/ssh/sshd_config
grep -q '^StrictModes' /etc/ssh/sshd_config || echo 'StrictModes no' >> /etc/ssh/sshd_config
# svc-sql -> root via SUID find (so the OUTFILE path also reaches root)
[ -x /usr/bin/find ] && chmod u+s /usr/bin/find

cat > /home/dbadmin/NOTES.txt << 'EOF'
HR onboarding records live in the `hr.onboarding` table (includes temporary
SSH keys issued to new staff). Shipment data in `shipments`.
DB login: meridian_app / (see the portal config).
EOF
chown dbadmin:dbadmin /home/dbadmin/NOTES.txt 2>/dev/null || true
