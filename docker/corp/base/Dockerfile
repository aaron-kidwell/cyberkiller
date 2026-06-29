# cyberkiller/corp-base - fat Debian base for MERIDIAN bookworm hosts.
# Goal: feel like a real, lived-in Linux server (full toolset + staff users),
# not a naked slim container. The 6 bookworm corp boxes layer their service on
# top of this. (vulhub/EOL-Buster boxes can't share it - dead apt mirror.)
FROM debian:bookworm

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update -qq && apt-get install -y --no-install-recommends \
      openssh-server supervisor sudo cron \
      bash-completion vim nano less man-db manpages ca-certificates locales \
      iproute2 net-tools iputils-ping dnsutils traceroute tcpdump netcat-openbsd \
      curl wget rsync openssl gnupg \
      python3 perl gcc make \
      procps htop psmisc lsof file tree jq unzip zip git \
    && rm -rf /var/lib/apt/lists/* \
    && sed -i 's/^# *en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen 2>/dev/null \
    && locale-gen en_US.UTF-8 >/dev/null 2>&1 || true \
    && mkdir -p /var/run/sshd && ssh-keygen -A

# A believable roster of staff accounts (home dirs + default skel), so
# /etc/passwd, /home and `who`/`last` look like a real multi-user host. These
# are non-login service/staff stubs; the box-specific foothold users are added
# by each box's ck-init.
RUN for u in m.ops s.admin a.patel l.chen r.boyd k.singh j.wright d.ferreira; do \
      useradd -m -s /bin/bash "$u" 2>/dev/null || true; \
    done \
    && printf 'MERIDIAN LOGISTICS internal host. Authorised use only.\n' > /etc/issue \
    && printf 'PRETTY_NAME="Meridian Linux (Debian 12)"\nNAME="Meridian Linux"\nID=debian\nVERSION="12 (meridian)"\n' >> /etc/os-release

# Realistic /etc/motd footer baseline (per-box entrypoint adds host/role banner).
RUN printf '\nMeridian IT - patched %s. Report issues to helpdesk@meridian.corp (x4500).\n' "$(date +%Y-%m 2>/dev/null || echo 2024-02)" >> /etc/motd
