package targets

import (
	"context"
	"log"
	"os/exec"

	"github.com/cyberkiller/api/internal/db"
)

// ReconcileStaleMachines expires DB rows whose containers no longer exist and frees IPs.
func ReconcileStaleMachines(ctx context.Context) int {
	if !UseDocker() {
		return 0
	}
	n := 0
	rows, err := db.Pool.Query(ctx, `
		SELECT instance_id, host(arena_ip) FROM targets WHERE status = 'active' AND instance_id != ''
	`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var ref, ip string
			rows.Scan(&ref, &ip)
			if ResolveContainerName(ref) != "" {
				continue
			}
			exec.Command("docker", "rm", "-f", ref).Run()
			db.Pool.Exec(ctx, `UPDATE targets SET status='expired' WHERE arena_ip=$1::inet AND status='active'`, ip)
			db.Pool.Exec(ctx, `UPDATE ip_pool SET assigned_at=NULL WHERE pool='target' AND arena_ip=$1::inet`, ip)
			log.Printf("[targets] expired stale target %s (container %s gone)", ip, ref)
			n++
		}
	}
	rows2, _ := db.Pool.Query(ctx, `
		SELECT container_id, host(arena_ip) FROM koth_machines
		WHERE status = 'active' AND container_id != ''
	`)
	if rows2 != nil {
		defer rows2.Close()
		for rows2.Next() {
			var ref, ip string
			rows2.Scan(&ref, &ip)
			if ResolveContainerName(ref) != "" {
				continue
			}
			exec.Command("docker", "rm", "-f", ref).Run()
			db.Pool.Exec(ctx, `
				UPDATE koth_machines SET status='expired', container_id=''
				WHERE arena_ip=$1::inet AND status='active'
			`, ip)
			db.Pool.Exec(ctx, `UPDATE ip_pool SET assigned_at=NULL WHERE pool='target' AND arena_ip=$1::inet`, ip)
			log.Printf("[koth] expired stale hill %s (container %s gone)", ip, ref)
			n++
		}
	}
	return n
}
