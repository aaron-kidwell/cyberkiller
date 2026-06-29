package targets

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// Host-port publishing makes targets reachable with zero setup: every box's
// service ports are bound on the host, so players just point their tools at
// <host>:<port> - no VPN, no routing, no sudo. The host port is derived from the
// target's arena IP so it's stable across resets (10.66.20.50's ssh is always the
// same host port). Boxes still share the ck-arena network, so the breach chain's
// box-to-box pivots keep working internally.

func lastOctet(arenaIP string) int {
	parts := strings.Split(arenaIP, ".")
	n, _ := strconv.Atoi(parts[len(parts)-1])
	return n
}

var svcNames = map[string]string{
	"22": "ssh", "80": "http", "8080": "http", "3306": "mysql", "5432": "postgres",
	"6379": "redis", "445": "smb", "139": "smb", "8983": "solr", "389": "ldap", "443": "https",
}

func svcName(port string) string {
	if s, ok := svcNames[port]; ok {
		return s
	}
	return "tcp"
}

// HostPort returns the stable host port a given container port is published on
// for a target at arenaIP.
func HostPort(arenaIP string, idx int) int { return 30000 + lastOctet(arenaIP)*10 + idx }

// PublishArgs returns the docker `-p` args to bind a target's ports on the host,
// plus a JSON [{service, port, container_port}] describing the published ports
// for the radar to show players where to connect.
func PublishArgs(arenaIP string, ports []string) ([]string, []byte) {
	var args []string
	out := make([]map[string]any, 0, len(ports))
	for i, p := range ports {
		hp := HostPort(arenaIP, i)
		args = append(args, "-p", fmt.Sprintf("%d:%s", hp, p))
		out = append(out, map[string]any{"service": svcName(p), "port": hp, "container_port": p})
	}
	j, _ := json.Marshal(out)
	return args, j
}
