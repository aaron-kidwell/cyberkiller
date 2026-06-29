# CVE-2021-44228: Log4Shell via Apache Solr 8.11.0
FROM vulhub/solr:8.11.0

# Fix EOL Debian Jessie apt sources (including sources.list.d/ backports)
RUN find /etc/apt -name '*.list' -exec sed -i \
      -e 's|http://deb.debian.org|http://archive.debian.org|g' \
      -e 's|http://security.debian.org/debian-security|http://archive.debian.org/debian-security|g' \
      -e 's|http://security.debian.org |http://archive.debian.org/debian-security |g' \
      {} \; && \
    find /etc/apt -name '*.list' -exec sed -i '/-updates/d; /-backports/d' {} \; && \
    echo 'Acquire::Check-Valid-Until "false";' > /etc/apt/apt.conf.d/99archive

# KOTH overlay - Solr on 8983, nginx proxies to 80
USER root
RUN apt-get update -qq -o Acquire::AllowInsecureRepositories=true && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends --allow-unauthenticated \
    openssh-server supervisor iproute2 procps curl sudo nginx \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/run/sshd && ssh-keygen -A

COPY docker/vulnhub/log4shell/supervisord.conf /etc/supervisor/supervisord.conf
COPY docker/vulnhub/log4shell/nginx.conf /etc/nginx/nginx.conf
COPY docker/vulnhub/log4shell/ck-init.sh /ck-init.sh
COPY docker/targets/entrypoint.sh /entrypoint.sh
RUN chmod +x /ck-init.sh /entrypoint.sh

EXPOSE 22 80 8983
ENTRYPOINT ["/entrypoint.sh"]
