# Security

## This software is intentionally vulnerable

CyberKiller deploys deliberately vulnerable systems (real CVEs such as Log4Shell,
Struts2 OGNL, Jenkins RCE, and others) and offensive-security tooling. It is built
for training in an isolated lab.

**Run it only on a network you control and are authorized to test. Never expose the
target machines to the internet or to any untrusted network.** You are responsible
for how you deploy and use it.

## Isolation model

- Target containers run on an isolated Docker bridge (`ck-arena`) and are reached
  through the control plane's DNAT, not on the control-plane network.
- The control plane (API, database, Redis) is on a separate network; a rooted target
  should only be able to reach the other target IPs, not the database or control API.
- Targets run with CPU, memory, and PID limits and without access to the Docker
  socket. Only the control plane mounts the Docker socket, and it is not reachable
  from a target.
- The admin panel binds to localhost by default; reach it over an SSH tunnel rather
  than exposing it publicly.

When self-hosting, keep these properties: do not publish target ports to the public
internet, and do not put the admin panel or the database on a public interface.

## Reporting a vulnerability in the platform

If you find a vulnerability in CyberKiller itself (not in the intentionally
vulnerable targets), please open a private security advisory on the repository or
contact the maintainer rather than filing a public issue.
