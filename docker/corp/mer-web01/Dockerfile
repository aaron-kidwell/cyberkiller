# mer-web01 - Meridian DMZ web app (the only internet-facing box).
# Layers Meridian-specific loot on the already-built apache-rce target
# (Apache 2.4.49, CVE-2021-41773 path-traversal CGI RCE, SSH overlay).
FROM cyberkiller/target-apache-rce:latest

COPY docker/corp/mer-web01/webroot/ /usr/local/apache2/htdocs/
COPY docker/corp/entrypoint.sh /entrypoint.sh
COPY docker/corp/mer-web01/ck-init.sh /ck-init.sh
RUN chmod +x /entrypoint.sh /ck-init.sh

# Foothold account is the web server user; flag lives in the web root owner's home.
ENV CK_USER_FLAG_PATH=/var/www/user.txt CK_USER_FLAG_OWNER=www-data

EXPOSE 22 80
ENTRYPOINT ["/entrypoint.sh"]
