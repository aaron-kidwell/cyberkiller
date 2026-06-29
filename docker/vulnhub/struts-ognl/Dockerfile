# CVE-2017-5638 (s2-045): Apache Struts 2.3.30 Content-Type OGNL injection
FROM vulhub/struts2:2.3.30

# Fix EOL Debian Stretch apt sources
RUN sed -i \
      -e 's|http://deb.debian.org|http://archive.debian.org|g' \
      -e 's|http://security.debian.org/debian-security|http://archive.debian.org/debian-security|g' \
      -e 's|http://security.debian.org |http://archive.debian.org/debian-security |g' \
      /etc/apt/sources.list && \
    sed -i '/-updates/d; /-backports/d' /etc/apt/sources.list

# KOTH overlay - Struts/Jetty on 8080, nginx proxies to 80
RUN apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    openssh-server supervisor iproute2 procps curl sudo nginx \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/run/sshd && ssh-keygen -A

COPY docker/vulnhub/struts-ognl/supervisord.conf /etc/supervisor/supervisord.conf
COPY docker/vulnhub/struts-ognl/nginx.conf /etc/nginx/nginx.conf
COPY docker/vulnhub/struts-ognl/ck-init.sh /ck-init.sh
COPY docker/targets/entrypoint.sh /entrypoint.sh
RUN chmod +x /ck-init.sh /entrypoint.sh

EXPOSE 22 80 8080
ENTRYPOINT ["/entrypoint.sh"]
