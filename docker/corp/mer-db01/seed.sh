#!/bin/bash
# Build-time MariaDB seed for mer-db01.
set -e
mkdir -p /run/mysqld /var/lib/mysql
chown -R mysql:mysql /run/mysqld /var/lib/mysql
mariadb-install-db --user=mysql --datadir=/var/lib/mysql --auth-root-authentication-method=normal >/dev/null 2>&1

# Start a temporary server to seed data.
mariadbd --user=mysql --datadir=/var/lib/mysql --socket=/run/mysqld/mysqld.sock --skip-networking=0 &
PID=$!
for i in $(seq 1 30); do
  mariadb --socket=/run/mysqld/mysqld.sock -e "SELECT 1" >/dev/null 2>&1 && break
  sleep 1
done

JDEV_KEY="$(cat /tmp/ck/jdev_id_rsa)"

mariadb --socket=/run/mysqld/mysqld.sock <<SQL
CREATE DATABASE IF NOT EXISTS shipments;
CREATE DATABASE IF NOT EXISTS hr;
CREATE TABLE hr.onboarding (
  id INT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(64),
  fullname VARCHAR(128),
  host VARCHAR(64),
  ssh_private_key TEXT,
  note VARCHAR(255)
);
INSERT INTO hr.onboarding (username, fullname, host, ssh_private_key, note) VALUES
  ('jdev', 'Jordan Dev', 'mer-ws01 (10.66.20.55)',
   '${JDEV_KEY}',
   'Temp SSH key issued at onboarding. Dev to rotate after first login (never did).');
CREATE TABLE shipments.manifests (id INT, ref VARCHAR(32), dest VARCHAR(64));
INSERT INTO shipments.manifests VALUES (1,'MER-0001','Rotterdam'),(2,'MER-0002','Singapore');

-- App account reused from the public portal (creds match web01's db.php).
-- Over-privileged (FILE) like a real lazily-configured app account: enables
-- the SELECT ... INTO OUTFILE -> webshell/authorized_keys RCE path.
CREATE USER IF NOT EXISTS 'meridian_app'@'%' IDENTIFIED BY 'Fr3ight-Db-2024!';
GRANT ALL PRIVILEGES ON *.* TO 'meridian_app'@'%' WITH GRANT OPTION;
GRANT FILE ON *.* TO 'meridian_app'@'%';
FLUSH PRIVILEGES;
SQL

# A nightly DB dump left world-readable in /var/backups (recon artifact): it
# contains the hr.onboarding rows, including jdev's SSH key -> ws01, with no
# DB login required if you find the backup.
mkdir -p /var/backups
mariadb-dump --socket=/run/mysqld/mysqld.sock --databases hr shipments > /var/backups/meridian-db-$(date +%F 2>/dev/null || echo backup).sql 2>/dev/null || \
  mariadb-dump --socket=/run/mysqld/mysqld.sock --databases hr shipments > /var/backups/meridian-db-backup.sql 2>/dev/null
chmod 644 /var/backups/*.sql 2>/dev/null || true

mysqladmin --socket=/run/mysqld/mysqld.sock shutdown
wait $PID 2>/dev/null || true
