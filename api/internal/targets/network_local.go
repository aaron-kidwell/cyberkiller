package targets

import (
	"context"
	"log"
	"os"
	"os/exec"
	"strings"

	"github.com/cyberkiller/api/internal/db"
)

// InitArenaNetworking enables IP forwarding so the control container (which sits
// on both ck-net and ck-arena) can talk to targets. Targets now have real IPs on
// the ck-arena bridge (10.66.20.0/24), which Docker routes from the host
// automatically - no manual routes or DNAT needed.
func InitArenaNetworking() {
	if os.Getenv("LOCAL_DOCKER_ORCHESTRATION") != "true" {
		return
	}
	exec.Command("sysctl", "-w", "net.ipv4.ip_forward=1").Run()
}

// serviceContainers are the long-lived stack containers that must never be killed by the orphan reaper.
var serviceContainers = map[string]bool{
	"ck-control": true,
	"ck-web":     true,
	"ck-admin":   true,
	"ck-db":      true,
	"ck-redis":   true,
}

// KillOrphanContainers removes koth-* target containers that are not tracked
// as active in the database. Called on startup to clean up previous-session debris.
func KillOrphanContainers(ctx context.Context) {
	// Only look at koth-* target containers - never touch service containers.
	out, err := exec.Command("docker", "ps", "-a", "--filter", "name=koth-", "--format", "{{.Names}}").Output()
	if err != nil {
		return
	}
	// Collect active container IDs from DB
	active := map[string]bool{}
	rows, _ := db.Pool.Query(ctx, `
		SELECT container_id FROM koth_machines WHERE status IN ('active','spinning') AND container_id != ''
		UNION ALL
		SELECT instance_id FROM targets WHERE status = 'active' AND instance_id != ''
	`)
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var cid string
			rows.Scan(&cid)
			active[cid] = true
		}
	}
	for _, name := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		name = strings.TrimSpace(name)
		if name == "" || serviceContainers[name] {
			continue
		}
		if !active[name] {
			exec.Command("docker", "rm", "-f", name).Run()
			log.Printf("[cleanup] killed orphan container %s", name)
		}
	}
}

// ReapplyArenaNetworking re-enables forwarding after a control-plane restart.
// Targets keep their real arena IPs across restarts, so there is no per-target
// DNAT/routing to rebuild any more.
func ReapplyArenaNetworking(ctx context.Context) {
	if !UseDocker() {
		return
	}
	InitArenaNetworking()
}
