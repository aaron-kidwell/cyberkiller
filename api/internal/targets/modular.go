package targets

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"net"
	"os/exec"
	"strings"
	"time"

	"github.com/cyberkiller/api/internal/db"
	"github.com/google/uuid"
)

// Modular targets: the instructor adds a Docker image to the catalog (by
// registry reference or by uploading a saved tarball), then spins it as a live
// target. Spinning runs the image on the arena bridge at a fixed arena IP,
// auto-plants user/root flags, and health-gates it. Scoring is awarded manually
// by the admin once a player proves a capture.

func bountyForTier(tier string) int {
	switch tier {
	case "hard":
		return 750
	case "medium":
		return 500
	default:
		return 300
	}
}

func randHex(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func newFlag() string { return "CK{" + randHex(12) + "}" }

// AddReference registers a catalog image that will be pulled from a registry.
// The pull happens here so an unreachable/typo'd reference fails fast with a
// clear error instead of at spin time.
func AddReference(ctx context.Context, id, name, image, tier string, sshPort, webPort int, rootPassword string, needsInject, kothEnabled bool, userFlagPath, rootFlagPath string) error {
	if out, err := exec.Command("docker", "pull", image).CombinedOutput(); err != nil {
		return fmt.Errorf("docker pull %s: %v %s", image, err, strings.TrimSpace(string(out)))
	}
	return insertImage(ctx, id, name, image, tier, sshPort, webPort, rootPassword, needsInject, kothEnabled, userFlagPath, rootFlagPath, "reference")
}

// LoadUpload loads a `docker save` tarball, derives the image tag it contains,
// and registers it. Used for air-gapped / custom images that aren't on a
// registry.
func LoadUpload(ctx context.Context, id, name, tarPath, tier string, sshPort, webPort int, rootPassword string, needsInject, kothEnabled bool, userFlagPath, rootFlagPath string) (string, error) {
	out, err := exec.Command("docker", "load", "-i", tarPath).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("docker load: %v %s", err, strings.TrimSpace(string(out)))
	}
	// `docker load` prints "Loaded image: repo:tag" (or "Loaded image ID: sha256:..").
	image := ""
	for _, line := range strings.Split(string(out), "\n") {
		if i := strings.Index(line, "Loaded image: "); i >= 0 {
			image = strings.TrimSpace(line[i+len("Loaded image: "):])
			break
		}
	}
	if image == "" {
		return "", fmt.Errorf("could not determine image tag from upload (image must be tagged: docker save repo:tag)")
	}
	if err := insertImage(ctx, id, name, image, tier, sshPort, webPort, rootPassword, needsInject, kothEnabled, userFlagPath, rootFlagPath, "upload"); err != nil {
		return "", err
	}
	return image, nil
}

func insertImage(ctx context.Context, id, name, image, tier string, sshPort, webPort int, rootPassword string, needsInject, kothEnabled bool, userFlagPath, rootFlagPath, source string) error {
	if sshPort == 0 {
		sshPort = 22
	}
	if webPort == 0 {
		webPort = 80
	}
	if userFlagPath == "" {
		userFlagPath = defaultUserFlagPath
	}
	if rootFlagPath == "" {
		rootFlagPath = defaultRootFlagPath
	}
	_, err := db.Pool.Exec(ctx, `
		INSERT INTO target_images (id, name, docker_image, tier, ssh_port, web_port, enabled, root_password, source, needs_flag_inject, koth_enabled, user_flag_path, root_flag_path)
		VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8,$9,$10,$11,$12)
		ON CONFLICT (id) DO UPDATE SET
			name=$2, docker_image=$3, tier=$4, ssh_port=$5, web_port=$6,
			root_password=$7, source=$8, needs_flag_inject=$9, koth_enabled=$10,
			user_flag_path=$11, root_flag_path=$12
	`, id, name, image, tier, sshPort, webPort, rootPassword, source, needsInject, kothEnabled, userFlagPath, rootFlagPath)
	return err
}

// SpinImage launches a catalog image as a live target: allocate an arena IP,
// create the machine row, run the container with planted flags, DNAT its ports,
// and health-gate it. Returns once the row is created; the container comes up in
// the background.
func SpinImage(ctx context.Context, imageID string) error {
	var name, image, tier string
	var sshPort, webPort int
	var rootPassword, userFlagPath, rootFlagPath string
	var needsInject, kothEnabled bool
	err := db.Pool.QueryRow(ctx, `
		SELECT name, docker_image, tier, ssh_port, web_port, COALESCE(root_password,''), needs_flag_inject, koth_enabled,
			COALESCE(user_flag_path,''), COALESCE(root_flag_path,'')
		FROM target_images WHERE id=$1 AND enabled=true
	`, imageID).Scan(&name, &image, &tier, &sshPort, &webPort, &rootPassword, &needsInject, &kothEnabled, &userFlagPath, &rootFlagPath)
	if err != nil {
		return fmt.Errorf("image not found or disabled: %w", err)
	}

	var arenaIP string
	err = db.Pool.QueryRow(ctx, `
		UPDATE ip_pool SET assigned_at = NOW()
		WHERE arena_ip = (
			SELECT arena_ip FROM ip_pool
			WHERE pool = 'target' AND assigned_at IS NULL
			ORDER BY arena_ip LIMIT 1 FOR UPDATE SKIP LOCKED
		) RETURNING host(arena_ip)
	`).Scan(&arenaIP)
	if err != nil {
		return fmt.Errorf("no free arena IP: %w", err)
	}

	if rootPassword == "" {
		rootPassword = randHex(10)
	}
	userFlag, rootFlag := newFlag(), newFlag()

	uPath, rPath := userFlagPath, rootFlagPath
	if uPath == "" {
		uPath = defaultUserFlagPath
	}
	if rPath == "" {
		rPath = defaultRootFlagPath
	}
	var machineID uuid.UUID
	err = db.Pool.QueryRow(ctx, `
		INSERT INTO koth_machines (image_id, image_name, arena_ip, tier, status, machine_type,
			bounty_pts, user_flag, root_flag, ssh_password, expires_at, koth_enabled,
			ad_flag_path, ad_root_flag_path)
		VALUES ($1,$2,$3::inet,$4,'spinning','docker',$5,$6,$7,$8,'infinity',$9,$10,$11)
		RETURNING id
	`, imageID, name, arenaIP, tier, bountyForTier(tier), userFlag, rootFlag, rootPassword, kothEnabled, uPath, rPath).Scan(&machineID)
	if err != nil {
		db.Pool.Exec(ctx, `UPDATE ip_pool SET assigned_at=NULL WHERE pool='target' AND arena_ip=$1::inet`, arenaIP)
		return err
	}

	go func() {
		cname := fmt.Sprintf("ck-%s", machineID.String()[:8])
		exec.Command("docker", "rm", "-f", cname).Run()
		ssh := fmt.Sprintf("%d", sshPort)
		web := fmt.Sprintf("%d", webPort)
		// Real IP on the ck-arena bridge: players reach it directly (no DNAT).
		args := []string{"run", "-d", "--name", cname, "--network", "ck-arena",
			"--ip", arenaIP,
			"--cpus=1", "--memory=512m", "--memory-swap=512m", "--pids-limit=256",
			"-e", "CK_ROOT_PASSWORD=" + rootPassword,
			"-e", "CK_USER_FLAG=" + userFlag,
			"-e", "CK_ROOT_FLAG=" + rootFlag}
		args = append(args, image)
		if out, err := exec.Command("docker", args...).CombinedOutput(); err != nil {
			log.Printf("[target] run %s: %v %s", cname, err, out)
			failSpin(machineID, arenaIP)
			return
		}

		if needsInject {
			plantFlags(cname, userFlagPath, rootFlagPath)
		}

		// Readiness: the container is running and at least one of its service
		// ports answers on its arena IP. Targets can be SSH-only, web-only, or
		// both, so we don't demand a specific port - just that it's serving.
		if !waitTargetReady(cname, arenaIP, ssh, web) {
			log.Printf("[target] %s never became reachable on %s (%s/%s)", cname, arenaIP, ssh, web)
			exec.Command("docker", "rm", "-f", cname).Run()
			failSpin(machineID, arenaIP)
			return
		}
		db.Pool.Exec(context.Background(), `
			UPDATE koth_machines SET status='active', health_ok=true, container_id=$2 WHERE id=$1
		`, machineID, cname)
		db.Pool.Exec(context.Background(), `INSERT INTO ticker_events (message) VALUES ($1)`,
			fmt.Sprintf("TARGET ONLINE: %s at %s", name, arenaIP))
		log.Printf("[target] %s live at %s", name, arenaIP)
	}()
	return nil
}

// waitTargetReady waits up to ~60s for the container to be running and at least
// one of its service ports to accept TCP on the bridge IP.
func waitTargetReady(container, bridgeIP, sshPort, webPort string) bool {
	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		out, _ := exec.Command("docker", "inspect", "-f", "{{.State.Running}}", container).Output()
		if strings.TrimSpace(string(out)) == "true" {
			if dialPort(bridgeIP, sshPort) || dialPort(bridgeIP, webPort) {
				return true
			}
		}
		time.Sleep(time.Second)
	}
	return false
}

func dialPort(host, port string) bool {
	if host == "" || port == "" || port == "0" {
		return false
	}
	c, err := net.DialTimeout("tcp", net.JoinHostPort(host, port), 2*time.Second)
	if err != nil {
		return false
	}
	c.Close()
	return true
}

func failSpin(machineID uuid.UUID, arenaIP string) {
	ctx := context.Background()
	// Expire (not 'failed') so the row leaves the partial unique index on arena_ip
	// and the freed IP can be reused on the next spin.
	db.Pool.Exec(ctx, `UPDATE koth_machines SET status='expired' WHERE id=$1`, machineID)
	db.Pool.Exec(ctx, `UPDATE ip_pool SET assigned_at=NULL WHERE pool='target' AND arena_ip=$1::inet`, arenaIP)
}

// plantFlags injects the CK contract into an arbitrary image that does not ship
// the entrypoint overlay: ensure a ckplayer user, set the shared password, make
// sure sshd allows password login if present, and write the flag files. Each
// step is best-effort so an image missing one tool (e.g. no useradd) still gets
// whatever can be applied.
// Default flag locations when the admin doesn't override them. The shared
// entrypoint (CK-overlay images) writes here too; keep them in sync.
const (
	defaultUserFlagPath = "/home/ckplayer/user.txt"
	defaultRootFlagPath = "/root/root.txt"
)

// plantFlags sets up the flag files in an arbitrary target image as handle-write
// capture points: a placeholder a player overwrites with their hub handle to prove
// they reached that level (the scanner reads it and auto-awards). No accounts or
// SSH are created - the box's own vulnerability is the foothold. The user flag is
// world-writable (any foothold can drop their handle); the root flag is root-only;
// the KOTH throne file is created for hold-mode scoring.
func plantFlags(container, userPath, rootPath string) {
	if userPath == "" {
		userPath = defaultUserFlagPath
	}
	if rootPath == "" {
		rootPath = defaultRootFlagPath
	}
	const userPlaceholder = "# write your hub handle here to capture the user flag"
	const rootPlaceholder = "# write your hub handle here to capture the root flag"
	script := fmt.Sprintf(`
set +e
mkdir -p "$(dirname '%s')" 2>/dev/null
printf '%%s\n' '%s' > '%s' 2>/dev/null
chmod 666 '%s' 2>/dev/null
mkdir -p "$(dirname '%s')" 2>/dev/null
printf '%%s\n' '%s' > '%s' 2>/dev/null
chmod 600 '%s' 2>/dev/null
[ -f /root/king.txt ] || printf 'unclaimed\n' > /root/king.txt 2>/dev/null
chmod 644 /root/king.txt 2>/dev/null
true
`, userPath, userPlaceholder, userPath, userPath, rootPath, rootPlaceholder, rootPath, rootPath)
	exec.Command("docker", "exec", "-u", "0", container, "sh", "-c", script).Run()
}

// StopTarget stops a live modular target, frees its arena IP, and expires the row.
// The admin route passes the catalog image id (the slug), so we resolve the live
// koth_machines row by image_id rather than the machine UUID.
func StopTarget(ctx context.Context, imageID string) error {
	var mid, cid, arenaIP string
	err := db.Pool.QueryRow(ctx, `
		SELECT id::text, COALESCE(container_id,''), host(arena_ip)
		FROM koth_machines WHERE image_id=$1 AND status IN ('active','spinning')
		ORDER BY id DESC LIMIT 1
	`, imageID).Scan(&mid, &cid, &arenaIP)
	if err != nil {
		return fmt.Errorf("no live target for that image: %w", err)
	}
	if cid != "" {
		exec.Command("docker", "rm", "-f", cid).Run()
	}
	if arenaIP != "" {
		db.Pool.Exec(ctx, `UPDATE ip_pool SET assigned_at=NULL WHERE pool='target' AND arena_ip=$1::inet`, arenaIP)
	}
	db.Pool.Exec(ctx, `UPDATE koth_machines SET status='expired', container_id='' WHERE id=$1`, mid)
	return nil
}

// TeardownAll stops every live target container and frees its arena IP. Used by
// the deploy teardown command.
func TeardownAll(ctx context.Context) int {
	rows, _ := db.Pool.Query(ctx, `SELECT id::text FROM koth_machines WHERE status IN ('active','spinning')`)
	if rows == nil {
		return 0
	}
	var ids []string
	for rows.Next() {
		var id string
		rows.Scan(&id)
		ids = append(ids, id)
	}
	rows.Close()
	for _, id := range ids {
		StopTarget(ctx, id)
	}
	return len(ids)
}
