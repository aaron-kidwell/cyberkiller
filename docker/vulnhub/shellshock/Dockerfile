# CVE-2014-6271: Bash 4.3 Shellshock via Apache CGI
FROM vulhub/bash:4.3.0-with-httpd

# Fix EOL Debian Jessie apt sources
RUN sed -i \
      -e 's|http://deb.debian.org|http://archive.debian.org|g' \
      -e 's|http://security.debian.org/debian-security|http://archive.debian.org/debian-security|g' \
      -e 's|http://security.debian.org |http://archive.debian.org/debian-security |g' \
      /etc/apt/sources.list && \
    sed -i '/-updates/d; /-backports/d' /etc/apt/sources.list && \
    echo 'Acquire::Check-Valid-Until "false";' > /etc/apt/apt.conf.d/99archive

# KOTH overlay - Apache already on port 80
RUN apt-get update -qq -o Acquire::AllowInsecureRepositories=true && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends --allow-unauthenticated \
    openssh-server supervisor iproute2 procps curl sudo \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/run/sshd && ssh-keygen -A

# Enable CGI and set up shellshock victim script using the VULNERABLE bash 4.3.0
RUN a2enmod cgi && \
    sed -i 's|#Include conf-available/serve-cgi-bin.conf|Include conf-available/serve-cgi-bin.conf|' \
      /etc/apache2/sites-enabled/000-default.conf && \
    mkdir -p /usr/lib/cgi-bin && \
    printf '#!/usr/local/bash-4.3.0/bin/bash\nexport PATH=/usr/local/bash-4.3.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\necho "Content-type: text/plain"\necho ""\necho "Target: $(hostname)"\necho "UA: $HTTP_USER_AGENT"\n' \
      > /usr/lib/cgi-bin/victim.cgi && \
    chmod +x /usr/lib/cgi-bin/victim.cgi

COPY docker/vulnhub/shellshock/supervisord.conf /etc/supervisor/supervisord.conf
COPY docker/vulnhub/shellshock/ck-init.sh /ck-init.sh
COPY docker/targets/entrypoint.sh /entrypoint.sh
RUN chmod +x /ck-init.sh /entrypoint.sh

EXPOSE 22 80
ENTRYPOINT ["/entrypoint.sh"]
