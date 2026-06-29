#!/bin/bash
# mer-ipa01 - Meridian central auth (OpenLDAP). Scenario objective. Ways in:
#   A) LDAP anonymous bind leaks userPassword hashes -> crack -> SSH as that user
#   B) SSH as ldapadmin with the Directory Manager password (looted ws02/fs01)
# Privesc: SUID /usr/bin/find (GTFOBins) -> root = central-auth takeover.

ADMIN_DN="cn=admin,dc=meridian,dc=corp"
ADMIN_PW="D1r3ctory-Mgr-Mer!"

# Directory admin SSH account (creds-reuse path).
id ldapadmin &>/dev/null || useradd -m -s /bin/bash ldapadmin
echo "ldapadmin:${ADMIN_PW}" | chpasswd

# A real directory user whose weak password is crackable AND is their SSH login.
id bjohnson &>/dev/null || useradd -m -s /bin/bash bjohnson
echo "bjohnson:Welcome1" | chpasswd

# Privesc
[ -x /usr/bin/find ] && chmod u+s /usr/bin/find

# --- Seed the directory + relax ACL so anonymous bind leaks userPassword ---
mkdir -p /run/slapd && chown openldap:openldap /run/slapd /var/lib/ldap 2>/dev/null || true
slapd -h "ldapi:///" -u openldap -g openldap 2>/dev/null &
SLPID=$!
for i in $(seq 1 20); do ldapsearch -Y EXTERNAL -H ldapi:/// -b cn=config -s base >/dev/null 2>&1 && break; sleep 1; done

# Find the mdb database DN for our suffix.
DBDN=$(ldapsearch -Y EXTERNAL -H ldapi:/// -b cn=config '(olcSuffix=dc=meridian,dc=corp)' dn 2>/dev/null | awk -F': ' '/^dn:/{print $2; exit}')
[ -z "$DBDN" ] && DBDN="olcDatabase={1}mdb,cn=config"

# Permissive read ACL (anonymous can read everything incl. userPassword).
ldapmodify -Y EXTERNAL -H ldapi:/// >/dev/null 2>&1 <<EOF
dn: ${DBDN}
changetype: modify
replace: olcAccess
olcAccess: {0}to * by * read
EOF

HASH=$(slappasswd -s Welcome1)
ldapadd -x -H ldapi:/// -D "$ADMIN_DN" -w "$ADMIN_PW" >/dev/null 2>&1 <<EOF
dn: ou=people,dc=meridian,dc=corp
objectClass: organizationalUnit
ou: people

dn: uid=bjohnson,ou=people,dc=meridian,dc=corp
objectClass: inetOrgPerson
cn: Bob Johnson
sn: Johnson
uid: bjohnson
mail: bjohnson@meridian.corp
userPassword: ${HASH}

dn: uid=ldapadmin,ou=people,dc=meridian,dc=corp
objectClass: inetOrgPerson
cn: Directory Admin
sn: Admin
uid: ldapadmin
description: local login uses the Directory Manager password
EOF

kill "$SLPID" 2>/dev/null; sleep 1

cat > /home/ldapadmin/OBJECTIVE.txt << 'EOF'
mer-ipa01 - Meridian central authentication (LDAP, dc=meridian,dc=corp).
Root here = full control of the corporate identity store. Scenario objective.
EOF
chown ldapadmin:ldapadmin /home/ldapadmin/OBJECTIVE.txt 2>/dev/null || true
