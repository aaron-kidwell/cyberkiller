# mer-app01 - Meridian internal CI server.
# Layers Meridian loot on the built jenkins-rce target (Jenkins 2.138,
# CVE-2018-1000861 script RCE, SSH overlay).
FROM cyberkiller/target-jenkins-rce:latest

COPY docker/corp/keys/itadmin.key /tmp/ck/itadmin.key
COPY docker/corp/entrypoint.sh /entrypoint.sh
COPY docker/corp/mer-app01/ck-init.sh /ck-init.sh
RUN chmod +x /entrypoint.sh /ck-init.sh

ENV CK_USER_FLAG_PATH=/var/jenkins_home/user.txt CK_USER_FLAG_OWNER=jenkins

EXPOSE 22 8080
ENTRYPOINT ["/entrypoint.sh"]
