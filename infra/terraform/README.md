# CyberKiller AWS (deferred)

Deploy only after [local/E2E_TEST.md](../../local/E2E_TEST.md) passes.

Planned stack:
- EC2 `t4g.small` (ARM64) with Elastic IP
- Security groups: 51820/udp (WireGuard), 443/80 (hub), 8080 restricted
- Replace Docker bridge DNAT with `10.66.20.x` on host `ck-arena`
- Secrets via environment / SSM - no `LOCAL_MODE`
