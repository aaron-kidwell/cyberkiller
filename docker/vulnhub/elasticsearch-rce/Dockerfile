# CVE-2015-1427: Elasticsearch 1.4.2 Groovy sandbox escape RCE
FROM vulhub/elasticsearch:1.4.2

# Fix EOL Debian Stretch apt sources + expired GPG keys
RUN sed -i \
      -e 's|http://deb.debian.org|http://archive.debian.org|g' \
      -e 's|http://security.debian.org/debian-security|http://archive.debian.org/debian-security|g' \
      -e 's|http://security.debian.org |http://archive.debian.org/debian-security |g' \
      /etc/apt/sources.list && \
    sed -i '/-updates/d; /-backports/d' /etc/apt/sources.list && \
    echo 'Acquire::Check-Valid-Until "false";' > /etc/apt/apt.conf.d/99archive

# KOTH overlay - ES runs on 9200, nginx proxies to 80
USER root
RUN apt-get update -qq -o Acquire::AllowInsecureRepositories=true && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends --allow-unauthenticated \
    openssh-server supervisor iproute2 procps curl sudo nginx \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/run/sshd && ssh-keygen -A

COPY docker/vulnhub/elasticsearch-rce/supervisord.conf /etc/supervisor/supervisord.conf
COPY docker/vulnhub/elasticsearch-rce/nginx.conf /etc/nginx/nginx.conf
COPY docker/vulnhub/elasticsearch-rce/ck-init.sh /ck-init.sh
COPY docker/targets/entrypoint.sh /entrypoint.sh
RUN chmod +x /ck-init.sh /entrypoint.sh

EXPOSE 22 80 9200
ENTRYPOINT ["/entrypoint.sh"]
