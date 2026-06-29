#!/bin/bash
echo 'ckplayer ALL=(ALL) NOPASSWD: /bin/cat' > /etc/sudoers.d/ck-arena
chmod 440 /etc/sudoers.d/ck-arena
