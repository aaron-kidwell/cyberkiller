# CVE-2018-1000861: Jenkins Stapler routing pre-auth Groovy RCE
FROM vulhub/jenkins:2.138

# Fix EOL Debian Stretch apt sources + expired GPG keys (jenkins user → need root)
USER root
RUN find /etc/apt -name '*.list' -exec sed -i \
      -e 's|http://deb.debian.org|http://archive.debian.org|g' \
      -e 's|http://security.debian.org/debian-security|http://archive.debian.org/debian-security|g' \
      -e 's|http://security.debian.org |http://archive.debian.org/debian-security |g' \
      {} \; && \
    find /etc/apt -name '*.list' -exec sed -i '/-updates/d; /-backports/d' {} \; && \
    echo 'Acquire::Check-Valid-Until "false";' > /etc/apt/apt.conf.d/99archive

# KOTH overlay - Jenkins runs on 8080, nginx proxies to 80
RUN apt-get update -qq -o Acquire::AllowInsecureRepositories=true && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends --allow-unauthenticated \
    openssh-server supervisor iproute2 procps curl sudo nginx \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/run/sshd && ssh-keygen -A

COPY docker/vulnhub/jenkins-rce/supervisord.conf /etc/supervisor/supervisord.conf
COPY docker/vulnhub/jenkins-rce/nginx.conf /etc/nginx/nginx.conf
COPY docker/vulnhub/jenkins-rce/ck-init.sh /ck-init.sh
COPY docker/targets/entrypoint.sh /entrypoint.sh
RUN chmod +x /ck-init.sh /entrypoint.sh

EXPOSE 22 80 8080
ENTRYPOINT ["/entrypoint.sh"]
