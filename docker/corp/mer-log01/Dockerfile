# mer-log01 - Meridian log collector / SIEM (crown jewel #1).
# Layers Meridian loot on the built log4shell target (Solr 8.11.0,
# CVE-2021-44228 Log4Shell RCE, SSH overlay).
FROM cyberkiller/target-log4shell:latest

COPY docker/corp/entrypoint.sh /entrypoint.sh
COPY docker/corp/mer-log01/ck-init.sh /ck-init.sh
RUN chmod +x /entrypoint.sh /ck-init.sh

ENV CK_USER_FLAG_PATH=/home/solr/user.txt CK_USER_FLAG_OWNER=solr

EXPOSE 22 8983
ENTRYPOINT ["/entrypoint.sh"]
