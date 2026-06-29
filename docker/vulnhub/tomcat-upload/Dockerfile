# CVE-2017-12615: Tomcat 8.5.19 HTTP PUT JSP upload
FROM vulhub/tomcat:8.5.19

# Fix EOL Debian Stretch apt sources
RUN sed -i \
      -e 's|http://deb.debian.org|http://archive.debian.org|g' \
      -e 's|http://security.debian.org/debian-security|http://archive.debian.org/debian-security|g' \
      -e 's|http://security.debian.org |http://archive.debian.org/debian-security |g' \
      /etc/apt/sources.list && \
    sed -i '/-updates/d; /-backports/d' /etc/apt/sources.list && \
    echo 'Acquire::Check-Valid-Until "false";' > /etc/apt/apt.conf.d/99archive

# KOTH overlay - Tomcat on 8080, nginx proxies to 80
RUN apt-get update -qq -o Acquire::AllowInsecureRepositories=true && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends --allow-unauthenticated \
    openssh-server supervisor iproute2 procps curl sudo nginx \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/run/sshd && ssh-keygen -A

# Enable CVE-2017-12615: set readonly=false so PUT uploads JSPs
RUN sed -i 's|<param-name>debug</param-name>|<param-name>readonly</param-name>\n            <param-value>false</param-value>\n        </init-param>\n        <init-param>\n            <param-name>debug</param-name>|' \
      /usr/local/tomcat/conf/web.xml

COPY docker/vulnhub/tomcat-upload/supervisord.conf /etc/supervisor/supervisord.conf
COPY docker/vulnhub/tomcat-upload/nginx.conf /etc/nginx/nginx.conf
COPY docker/vulnhub/tomcat-upload/ck-init.sh /ck-init.sh
COPY docker/targets/entrypoint.sh /entrypoint.sh
RUN chmod +x /ck-init.sh /entrypoint.sh

EXPOSE 22 80 8080
ENTRYPOINT ["/entrypoint.sh"]
