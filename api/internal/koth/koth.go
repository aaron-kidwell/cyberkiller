// Package koth holds the container spawn + reset helpers shared by the target
// engine (spinning an image on the arena bridge, respawning a box, vote-reset).
package koth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"os/exec"

	"github.com/cyberkiller/api/internal/db"
	"github.com/cyberkiller/api/internal/targets"
	"github.com/google/uuid"
)

// startHillContainer launches an image as a target container on the arena
// bridge and DNATs its service ports to the target's fixed arena IP. Flag files
// are seeded by the image entrypoint from the CK_* env (empty values fall back
// to placeholders the admin can verify against later).
func startHillContainer(name, image, arenaIP, password, userFlag, rootFlag string) error {
	exec.Command("docker", "rm", "-f", name).Run()
	args := []string{"run", "-d", "--name", name, "--network", "ck-arena",
		"--ip", arenaIP,
		"-e", "CK_ROOT_PASSWORD=" + password,
		"-e", "CK_USER_FLAG=" + userFlag,
		"-e", "CK_ROOT_FLAG=" + rootFlag}
	args = append(args, image)
	out, err := exec.Command("docker", args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%v %s", err, out)
	}
	return nil
}

// ResetHill tears down a target's container and starts a fresh one for the same
// machine record, keeping its arena IP. This re-seeds clean flags and loot.
func ResetHill(ctx context.Context, hillID uuid.UUID) error {
	var cid, imgName, imgDocker, arenaIP string
	err := db.Pool.QueryRow(ctx, `
		SELECT COALESCE(k.container_id,''), k.image_name, ti.docker_image, host(k.arena_ip)
		FROM koth_machines k
		JOIN target_images ti ON ti.id = k.image_id
		WHERE k.id=$1 AND k.status='active'
	`, hillID).Scan(&cid, &imgName, &imgDocker, &arenaIP)
	if err != nil {
		return fmt.Errorf("target not found or inactive: %w", err)
	}

	newPw, _ := randomHex(8)
	db.Pool.Exec(ctx, `
		UPDATE koth_machines
		SET king_player_id=NULL, king_handle=NULL, king_since=NULL,
		    ssh_password=$2, container_id=''
		WHERE id=$1
	`, hillID, newPw)
	db.Pool.Exec(ctx, `DELETE FROM koth_reset_votes WHERE machine_id=$1`, hillID)

	cname := fmt.Sprintf("ck-%s", hillID.String()[:8])
	go func() {
		if err := startHillContainer(cname, imgDocker, arenaIP, newPw, "", ""); err != nil {
			log.Printf("[target] reset container start: %v", err)
			db.Pool.Exec(context.Background(), `UPDATE koth_machines SET status='failed' WHERE id=$1`, hillID)
			return
		}
		bridgeIP, _ := targets.ContainerIP(cname)
		hg := targets.RunHealthGate(targets.GateParams{Container: cname, ArenaIP: arenaIP, BridgeIP: bridgeIP})
		if !hg.OK {
			log.Printf("[target] reset health gate failed %s: %s - %s", cname, hg.FailedStep, hg.Detail)
			exec.Command("docker", "rm", "-f", cname).Run()
			db.Pool.Exec(context.Background(), `UPDATE koth_machines SET status='failed' WHERE id=$1`, hillID)
			return
		}
		db.Pool.Exec(context.Background(), `UPDATE koth_machines SET container_id=$2 WHERE id=$1`, hillID, cname)
		db.Pool.Exec(context.Background(), `INSERT INTO ticker_events (message) VALUES ($1)`,
			fmt.Sprintf("TARGET RESET: %s (%s) respawned", imgName, arenaIP))
		log.Printf("[target] %s reset complete (%s)", arenaIP, cname)
	}()
	return nil
}

// VoteResetThreshold is a strict majority of the players currently online, so a
// reset reflects most of the people present rather than a fixed number. A solo
// player can reset; otherwise floor(online/2)+1.
func VoteResetThreshold(ctx context.Context) int {
	var online int
	db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM players WHERE connected AND NOT banned`).Scan(&online)
	if online <= 1 {
		return 1
	}
	return online/2 + 1
}

func randomHex(n int) (string, error) {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b), nil
}
