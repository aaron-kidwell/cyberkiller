# CVE-2022-22965: Spring4Shell - Spring Framework 5.3.17 data binding RCE
FROM vulhub/spring-webmvc:5.3.17

# Debian Bullseye (still supported) - no source fix needed, just update
USER root
RUN apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    openssh-server supervisor iproute2 procps curl sudo nginx \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/run/sshd && ssh-keygen -A

COPY docker/vulnhub/spring4shell/supervisord.conf /etc/supervisor/supervisord.conf
COPY docker/vulnhub/spring4shell/nginx.conf /etc/nginx/nginx.conf
COPY docker/vulnhub/spring4shell/ck-init.sh /ck-init.sh
COPY docker/targets/entrypoint.sh /entrypoint.sh
RUN chmod +x /ck-init.sh /entrypoint.sh

EXPOSE 22 80 8080
ENTRYPOINT ["/entrypoint.sh"]
