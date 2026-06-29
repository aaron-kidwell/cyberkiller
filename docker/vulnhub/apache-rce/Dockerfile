# CVE-2021-41773: Apache 2.4.49 path traversal + CGI RCE
FROM vulhub/httpd:2.4.49

# Fix EOL Debian Buster apt sources
RUN sed -i \
      -e 's|http://deb.debian.org|http://archive.debian.org|g' \
      -e 's|http://security.debian.org/debian-security|http://archive.debian.org/debian-security|g' \
      -e 's|http://security.debian.org |http://archive.debian.org/debian-security |g' \
      /etc/apt/sources.list && \
    sed -i '/-updates/d; /-backports/d' /etc/apt/sources.list

# KOTH overlay - httpd already on port 80, no nginx proxy needed
RUN apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    openssh-server supervisor iproute2 procps curl sudo \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/run/sshd && ssh-keygen -A

# Enable CVE-2021-41773: mod_cgid + AllowEncodedSlashes NoDecode + permissive root dir
RUN sed -i \
      -e 's|#LoadModule cgid_module|LoadModule cgid_module|' \
      -e 's|Require all denied|Require all granted|g' \
      /usr/local/apache2/conf/httpd.conf && \
    sed -i '/^ServerRoot/a AllowEncodedSlashes NoDecode' /usr/local/apache2/conf/httpd.conf && \
    printf '\n<Directory "/">\n    Options +FollowSymLinks\n    Require all granted\n</Directory>\n\n<Directory "/usr/local/apache2/cgi-bin">\n    AllowOverride All\n    Options +ExecCGI +FollowSymLinks\n    Require all granted\n</Directory>\n' \
      >> /usr/local/apache2/conf/httpd.conf

COPY docker/vulnhub/apache-rce/supervisord.conf /etc/supervisor/supervisord.conf
COPY docker/vulnhub/apache-rce/ck-init.sh /ck-init.sh
COPY docker/targets/entrypoint.sh /entrypoint.sh
RUN chmod +x /ck-init.sh /entrypoint.sh

EXPOSE 22 80
ENTRYPOINT ["/entrypoint.sh"]
