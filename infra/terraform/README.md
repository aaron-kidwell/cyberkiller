# CyberKiller AWS (deferred)

Deploy only after the stack runs cleanly locally (`./deploy.sh`).

Planned stack:
- EC2 `t4g.small` (ARM64) with Elastic IP
- Security groups: 443/80 (hub), 8080 restricted; never expose the arena
- Targets run on the `ck-arena` bridge (`10.66.20.x`), isolated from the control plane
- Secrets via environment / SSM
