# mer-web02 - Meridian internal intranet/CMS.
# Layers Meridian loot on the built struts-ognl target (Struts2 2.3.30,
# CVE-2017-5638 OGNL RCE, SSH overlay).
FROM cyberkiller/target-struts-ognl:latest

COPY docker/corp/entrypoint.sh /entrypoint.sh
COPY docker/corp/mer-web02/ck-init.sh /ck-init.sh
RUN chmod +x /entrypoint.sh /ck-init.sh

ENV CK_USER_FLAG_PATH=/home/webadmin/user.txt CK_USER_FLAG_OWNER=webadmin

EXPOSE 22 8080
ENTRYPOINT ["/entrypoint.sh"]
