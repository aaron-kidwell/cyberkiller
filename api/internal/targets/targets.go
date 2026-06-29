// Package targets is the target engine: it spins Docker images as range targets
// on the isolated ck-arena bridge, DNATs their ports to fixed arena IPs, plants
// flags, and health-gates them. See modular.go for the add/spin/stop entry points.
package targets

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/cyberkiller/api/internal/db"
	"github.com/cyberkiller/api/internal/flows"
	"github.com/cyberkiller/api/internal/scoring"
	"github.com/google/uuid"
)

var tierImages = map[string]string{
	"easy":   "cyberkiller/target-neon:latest",
	"medium": "cyberkiller/target-neon:latest",
	"hard":   "cyberkiller/target-neon:latest",
}

func UseDocker() bool {
	return os.Getenv("LOCAL_DOCKER_ORCHESTRATION") == "true"
}

// KothOnly disables legacy target pool when true (default for arena play).
func KothOnly() bool {
	return os.Getenv("KOTH_ONLY") != "false"
}

func makeShadowHash(password, salt string) string {
	out, err := exec.Command("openssl", "passwd", "-6", "-salt", salt, password).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func randomSecret() (string, error) {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func randomHex(n int) (string, error) {
	b := make([]byte, n)
	_, err := rand.Read(b)
	return hex.EncodeToString(b), err
}

func SpinTarget(ctx context.Context, tier string) error {
	if !UseDocker() {
		return nil
	}
	img := tierImages[tier]
	plaintext, _ := randomSecret()
	salt, _ := randomHex(8)
	shadow := makeShadowHash(plaintext, salt)
	if shadow == "" {
		return fmt.Errorf("openssl shadow hash failed")
	}

	var arenaIP string
	err := db.Pool.QueryRow(ctx, `
		UPDATE ip_pool SET assigned_at = NOW()
		WHERE arena_ip = (
			SELECT arena_ip FROM ip_pool
			WHERE pool = 'target' AND assigned_at IS NULL
			ORDER BY arena_ip LIMIT 1 FOR UPDATE SKIP LOCKED
		) RETURNING host(arena_ip)
	`).Scan(&arenaIP)
	if err != nil {
		return err
	}

	targetID := uuid.New()
	instanceID := fmt.Sprintf("ck-%s", targetID.String()[:8])

	_, err = db.Pool.Exec(ctx, `
		INSERT INTO targets (id, instance_id, arena_ip, tier, plaintext_secret, shadow_hash, salt,
			ttl_seconds, status, open_ports, cred_hint, image_name)
		VALUES ($1,$2,$3::inet,$4,$5,$6,$7,1800,'rotating',$8,$9,'neon-dvwa')
	`, targetID, instanceID, arenaIP, tier, plaintext, shadow, salt,
		defaultPortsJSON(tier), credHint(tier, plaintext))
	if err != nil {
		return err
	}

	if err := startTargetContainer(ctx, instanceID, img, arenaIP, plaintext, ""); err != nil {
		db.Pool.Exec(ctx, `UPDATE targets SET status='expired' WHERE id=$1`, targetID)
		return err
	}
	bridgeIP, _ := containerIP(instanceID)
	hg := RunHealthGate(GateParams{Container: instanceID, ArenaIP: arenaIP, BridgeIP: bridgeIP})
	if !hg.OK {
		exec.Command("docker", "rm", "-f", instanceID).Run()
		db.Pool.Exec(ctx, `UPDATE targets SET status='expired' WHERE id=$1`, targetID)
		return fmt.Errorf("health gate: %s: %s", hg.FailedStep, hg.Detail)
	}
	_, err = db.Pool.Exec(ctx, `UPDATE targets SET status='active' WHERE id=$1`, targetID)
	return err
}

func startTargetContainer(ctx context.Context, name, image, arenaIP, password, kothToken string) error {
	exec.Command("docker", "rm", "-f", name).Run()
	args := []string{
		"run", "-d", "--name", name,
		"--network", "ck-arena",
		"--ip", arenaIP, // real arena IP, reachable directly (no DNAT)
		// Resource caps - one player hammering a target VM must not be able
		// to consume the whole host. Tuned for typical KOTH/CTF target shape:
		// a single web service + shell. Bump per-image via env if needed.
		"--cpus", "1.0",
		"--memory", "512m",
		"--memory-swap", "512m",
		"--pids-limit", "256",
		"-e", "CK_ROOT_PASSWORD=" + password,
	}
	args = append(args, image)
	out, err := exec.Command("docker", args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("docker run: %v %s", err, out)
	}
	_ = strings.TrimSpace(string(out)) // container id (name is canonical in instance_id)
	db.Pool.Exec(ctx, `UPDATE targets SET instance_id = $1 WHERE arena_ip = $2::inet`, name, arenaIP)
	return nil
}

func ContainerIP(name string) (string, error) {
	out, err := exec.Command("docker", "inspect", "-f",
		`{{range .NetworkSettings.Networks}}{{if .IPAddress}}{{.IPAddress}} {{end}}{{end}}`, name).Output()
	if err != nil {
		return "", err
	}
	parts := strings.Fields(string(out))
	// Prefer the arena IP (matches the active prefix); fall back to first result.
	arenaPrefix := ArenaIPPrefix() + "."
	for _, p := range parts {
		if strings.HasPrefix(p, arenaPrefix) {
			return p, nil
		}
	}
	if len(parts) > 0 {
		return parts[0], nil
	}
	return "", nil
}

func containerIP(name string) (string, error) { return ContainerIP(name) }

func defaultPortsJSON(tier string) []byte {
	ports := []map[string]any{{"port": 80, "service": "http"}, {"port": 22, "service": "ssh"}}
	b, _ := json.Marshal(ports)
	return b
}

func credHint(tier, plain string) string {
	if tier == "easy" && len(plain) >= 4 {
		return plain[:4] + "..."
	}
	return ""
}

type KillRequest struct {
	AttackerID string
	ArenaIP    string
	Value      string
}

type KillResult struct {
	Valid   bool   `json:"valid"`
	Points  int    `json:"points,omitempty"`
	Message string `json:"message,omitempty"`
}

func VerifyTargetKill(ctx context.Context, req KillRequest) (*KillResult, error) {
	attackerID, err := uuid.Parse(req.AttackerID)
	if err != nil {
		return &KillResult{Message: "invalid attacker"}, nil
	}

	var targetID uuid.UUID
	var plain, shadow, attackerIP string
	err = db.Pool.QueryRow(ctx, `
		SELECT t.id, t.plaintext_secret, t.shadow_hash, p.arena_ip::text
		FROM targets t, players p
		WHERE t.arena_ip = $1::inet AND t.status = 'active' AND p.id = $2
	`, req.ArenaIP, attackerID).Scan(&targetID, &plain, &shadow, &attackerIP)
	if err != nil {
		return &KillResult{Message: "no active target at that IP"}, nil
	}

	if !flows.HasFlow(ctx, attackerIP, req.ArenaIP, 15*time.Minute) {
		// Record synthetic flow in LOCAL_MODE for host-port testing
		if os.Getenv("LOCAL_MODE") == "true" {
			db.Pool.Exec(ctx, `INSERT INTO flows (src_ip, dst_ip) VALUES ($1::inet, $2::inet)`, attackerIP, req.ArenaIP)
		} else if !flows.HasFlow(ctx, attackerIP, req.ArenaIP, 15*time.Minute) {
			return &KillResult{Message: "no attack flow found: must actually reach the machine"}, nil
		}
	}

	val := strings.TrimSpace(req.Value)
	matched := val == plain || val == shadow || strings.Contains(shadow, val)
	if !matched {
		return &KillResult{Message: "credential mismatch"}, nil
	}

	if err := scoring.AwardKill(ctx, attackerID, scoring.TargetKillPoints, "target", &targetID, nil); err != nil {
		return nil, err
	}
	db.Pool.Exec(ctx, `UPDATE targets SET status = 'captured' WHERE id = $1`, targetID)
	db.Pool.Exec(ctx, `INSERT INTO ticker_events (message) VALUES ($1)`,
		fmt.Sprintf("TARGET KILL +%d pts", scoring.TargetKillPoints))

	return &KillResult{Valid: true, Points: scoring.TargetKillPoints, Message: "kill confirmed"}, nil
}

func DestroyAllTargets(ctx context.Context) int {
	if KothOnly() {
		return 0
	}
	rows, _ := db.Pool.Query(ctx, `SELECT instance_id, host(arena_ip) FROM targets WHERE status='active'`)
	if rows == nil {
		return 0
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var name, ip string
		rows.Scan(&name, &ip)
		exec.Command("docker", "rm", "-f", name).Run()
		db.Pool.Exec(ctx, `UPDATE targets SET status='expired' WHERE instance_id=$1`, name)
		if ip != "" {
			db.Pool.Exec(ctx, `UPDATE ip_pool SET assigned_at=NULL WHERE pool='target' AND arena_ip=$1::inet`, ip)
		}
		n++
	}
	return n
}

func StartRotation(ctx context.Context) {
	if !UseDocker() || KothOnly() {
		return
	}
	go func() {
		t := time.NewTicker(2 * time.Minute)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				var n int
				db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM targets WHERE status='active'`).Scan(&n)
				for i := n; i < 3; i++ {
					SpinTarget(ctx, "easy")
				}
			}
		}
	}()
}

func EnsureLocalTargets(ctx context.Context) {
	if !UseDocker() {
		return
	}
	InitArenaNetworking()
	KillOrphanContainers(ctx)
	ReconcileStaleMachines(ctx)
	if KothOnly() {
		ReapplyArenaNetworking(ctx)
		return
	}
	var n int
	db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM targets WHERE status='active'`).Scan(&n)
	for i := n; i < 3; i++ {
		if err := SpinTarget(ctx, "easy"); err != nil {
			fmt.Printf("[targets] spin: %v\n", err)
		}
	}
	ReapplyArenaNetworking(ctx)
}
