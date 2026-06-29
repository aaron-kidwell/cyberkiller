// Package corp implements the MERIDIAN corporate-network example scenario: a
// fixed 10-machine Linux enterprise built from Docker containers with a designed
// lateral-movement breach chain (see docker/corp/CHAIN.md). It ships as a
// ready-made example of how a multi-box scenario is assembled on top of the
// generic target engine.
package corp

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"time"

	"github.com/cyberkiller/api/internal/db"
	"github.com/cyberkiller/api/internal/settings"
	"github.com/cyberkiller/api/internal/targets"
)

// InitRoster sets each box's arena IP from the active network mode (bridge or
// LAN ipvlan) so MERIDIAN follows ARENA_IP_PREFIX/ARENA_BOX_BASE instead of a
// hardcoded subnet. Call once at startup before RegisterMachines.
func InitRoster() {
	for i := range Roster {
		Roster[i].ArenaIP = targets.BoxIP(i)
	}
}

// Machine is one box in the MERIDIAN network. The roster below is the source of
// truth (the credential/pivot chain is documented in docker/corp/CHAIN.md).
type Machine struct {
	Name         string   // hostname, e.g. mer-web01
	Display      string   // radar label
	Role         string   // short role description
	ArenaIP      string   // fixed arena IP (10.66.20.50-59)
	Image        string   // docker image tag
	Tier         string   // easy | medium | hard
	Ports        []string // ports to DNAT to the arena IP (always includes 22)
	HealthPort   string   // primary service port to gate on ("" = SSH only)
	UserFlagPath string   // where user.txt lives (foothold account home)
	UserOwner    string   // foothold account that owns user.txt
}

// Roster is the 10 MERIDIAN machines, all Docker containers on the arena bridge
// at fixed IPs in the .50-.59 band.
var Roster = []Machine{
	{"mer-web01", "Meridian DMZ Web Portal", "public web app", "10.66.20.50", "cyberkiller/corp-mer-web01:latest", "easy", []string{"22", "80"}, "80", "/var/www/user.txt", "www-data"},
	{"mer-web02", "Meridian Intranet", "internal CMS", "10.66.20.51", "cyberkiller/corp-mer-web02:latest", "easy", []string{"22", "8080"}, "8080", "/home/webadmin/user.txt", "webadmin"},
	{"mer-db01", "Meridian Primary DB", "MySQL database", "10.66.20.52", "cyberkiller/corp-mer-db01:latest", "hard", []string{"22", "3306"}, "3306", "/home/dbadmin/user.txt", "dbadmin"},
	{"mer-db02", "Meridian Cache", "Redis cache", "10.66.20.53", "cyberkiller/corp-mer-db02:latest", "medium", []string{"22", "6379"}, "6379", "/home/svc-cache/user.txt", "svc-cache"},
	{"mer-app01", "Meridian CI", "Jenkins build server", "10.66.20.54", "cyberkiller/corp-mer-app01:latest", "medium", []string{"22", "8080"}, "8080", "/var/jenkins_home/user.txt", "jenkins"},
	{"mer-ws01", "Dev Workstation", "developer workstation", "10.66.20.55", "cyberkiller/corp-mer-ws01:latest", "easy", []string{"22"}, "", "/home/jdev/user.txt", "jdev"},
	{"mer-ws02", "IT Admin Workstation", "IT admin workstation", "10.66.20.56", "cyberkiller/corp-mer-ws02:latest", "medium", []string{"22"}, "", "/home/itadmin/user.txt", "itadmin"},
	{"mer-fs01", "Meridian File Server", "Samba file server", "10.66.20.57", "cyberkiller/corp-mer-fs01:latest", "medium", []string{"22", "445"}, "445", "/home/itadmin/user.txt", "itadmin"},
	{"mer-log01", "Meridian SIEM", "log collector / SIEM", "10.66.20.58", "cyberkiller/corp-mer-log01:latest", "hard", []string{"22", "8983"}, "8983", "/home/solr/user.txt", "solr"},
	{"mer-ipa01", "Meridian Central Auth", "LDAP directory (objective)", "10.66.20.59", "cyberkiller/corp-mer-ipa01:latest", "hard", []string{"22", "389"}, "389", "/home/ldapadmin/user.txt", "ldapadmin"},
}

const rootFlagPath = "/root/root.txt"

// Enabled reports whether the MERIDIAN example scenario is provisioned on boot.
func Enabled() bool { return os.Getenv("CORP_ORCHESTRATION") == "true" }

func machineByArenaIP(ip string) *Machine {
	for i := range Roster {
		if Roster[i].ArenaIP == ip {
			return &Roster[i]
		}
	}
	return nil
}

func randomHex(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// RegisterMachines ensures a koth_machines row exists for every MERIDIAN box.
// Rows are created dormant (status='expired'); Provision() brings them live.
// machine_type='corp' keeps them out of the random-hill scheduler and the
// docker flag scanner; the corp scanner handles them with per-machine paths.
func RegisterMachines(ctx context.Context) {
	for _, m := range Roster {
		bounty := settings.Int(ctx, "koth_bounty_"+m.Tier, tierDefault(m.Tier))
		// Container boxes: the scanner reads flags via `docker exec`, so no SSH
		// host/key is stored on the row.
		host := ""
		port := 0
		user := ""
		key := ""
		isLinux := false
		// Idempotent upsert keyed on (machine_type='corp', arena_ip). The
		// koth_machines unique index on arena_ip is PARTIAL (status != 'expired'),
		// so dormant corp rows aren't covered by it - an ON CONFLICT upsert would
		// insert a duplicate on every restart. Update-then-insert-if-absent avoids
		// that. Only touches dormant rows so an active corp box isn't disturbed.
		_, err := db.Pool.Exec(ctx, `
			WITH upd AS (
				UPDATE koth_machines SET
					image_name=$1, tier=$3, bounty_pts=$4,
					ad_flag_path=$5, ad_root_flag_path=$6, expires_at='infinity',
					winrm_host=$7, winrm_port=$8, winrm_user=$9, ssh_key_path=$10, linux_machine=$11
				WHERE machine_type='corp' AND arena_ip=$2::inet
				RETURNING id
			)
			INSERT INTO koth_machines
				(image_name, arena_ip, machine_type, status, tier, bounty_pts,
				 ad_flag_path, ad_root_flag_path, claim_token, user_flag, root_flag, expires_at,
				 winrm_host, winrm_port, winrm_user, ssh_key_path, linux_machine)
			SELECT $1, $2::inet, 'corp', 'expired', $3, $4, $5, $6, '', '', '', 'infinity',
			       $7, $8, $9, $10, $11
			WHERE NOT EXISTS (SELECT 1 FROM upd)
		`, m.Display, m.ArenaIP, m.Tier, bounty, m.UserFlagPath, rootFlagPath,
			host, port, user, key, isLinux)
		if err != nil {
			log.Printf("[corp] register %s (%s): %v", m.Name, m.ArenaIP, err)
		}
		// Reserve this fixed IP in the pool so the modular spinner never hands it
		// out to another target and collides with MERIDIAN.
		db.Pool.Exec(ctx, `UPDATE ip_pool SET assigned_at=NOW() WHERE pool='target' AND arena_ip=$1::inet`, m.ArenaIP)
	}
	log.Printf("[corp] registered %d MERIDIAN machines (dormant)", len(Roster))
}

func tierDefault(tier string) int {
	switch tier {
	case "hard":
		return 750
	case "medium":
		return 500
	default:
		return 300
	}
}

// Provision spins up every MERIDIAN container, wires DNAT to its fixed arena IP,
// and marks it active. Called when the scenario becomes live.
func Provision(ctx context.Context) {
	log.Printf("[corp] provisioning MERIDIAN network (%d machines)...", len(Roster))
	db.Pool.Exec(ctx, `INSERT INTO ticker_events (message) VALUES ('MERIDIAN corporate network provisioning...')`)
	for _, m := range Roster {
		go provisionMachine(context.Background(), m)
	}
}

func provisionMachine(ctx context.Context, m Machine) {
	cname := "corp-" + m.Name
	exec.Command("docker", "rm", "-f", cname).Run()

	pw := randomHex(8)
	// Plant real per-box flags so the instructor can verify a player's capture in
	// the admin panel before awarding (same scheme as the modular spinner).
	userFlag := "CK{" + randomHex(12) + "}"
	rootFlag := "CK{" + randomHex(12) + "}"
	// Real IP on the ck-arena bridge (10.66.20.0/24): players nmap/reach it
	// directly, no DNAT or host-port mapping needed.
	args := []string{"run", "-d", "--name", cname, "--network", "ck-arena",
		"--ip", m.ArenaIP, "--hostname", m.Name,
		"--cpus=1", "--memory=512m", "--pids-limit=512",
		"-e", "CK_ROOT_PASSWORD=" + pw,
		"-e", "CK_ROLE=" + m.Role,
		"-e", "CK_USER_FLAG=" + userFlag,
		"-e", "CK_ROOT_FLAG=" + rootFlag}
	args = append(args, m.Image)
	if out, err := exec.Command("docker", args...).CombinedOutput(); err != nil {
		log.Printf("[corp] run %s: %v %s", cname, err, out)
		db.Pool.Exec(ctx, `UPDATE koth_machines SET status='failed' WHERE arena_ip=$1::inet`, m.ArenaIP)
		return
	}

	if !waitHealthy(m.ArenaIP, m.HealthPort) {
		log.Printf("[corp] %s health gate failed (ssh/%s on %s)", cname, m.HealthPort, m.ArenaIP)
		exec.Command("docker", "rm", "-f", cname).Run()
		db.Pool.Exec(ctx, `UPDATE koth_machines SET status='failed' WHERE arena_ip=$1::inet`, m.ArenaIP)
		return
	}

	db.Pool.Exec(ctx, `
		UPDATE koth_machines SET status='active', health_ok=true, container_id=$2,
			ssh_password=$3, user_flag=$4, root_flag=$5,
			king_player_id=NULL, king_handle=NULL, king_since=NULL
		WHERE arena_ip=$1::inet
	`, m.ArenaIP, cname, pw, userFlag, rootFlag)
	log.Printf("[corp] %s live at %s", m.Name, m.ArenaIP)
}

// waitHealthy waits up to ~60s for SSH (22) and the primary service port to
// accept TCP on the container bridge IP.
func waitHealthy(bridgeIP, healthPort string) bool {
	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		if dialOK(bridgeIP, "22") && (healthPort == "" || dialOK(bridgeIP, healthPort)) {
			return true
		}
		time.Sleep(time.Second)
	}
	return false
}

func dialOK(host, port string) bool {
	c, err := net.DialTimeout("tcp", net.JoinHostPort(host, port), 2*time.Second)
	if err != nil {
		return false
	}
	c.Close()
	return true
}

// Teardown stops every MERIDIAN container. Called when the scenario goes dormant.
func Teardown(ctx context.Context) {
	log.Printf("[corp] tearing down MERIDIAN network...")
	for _, m := range Roster {
		cname := "corp-" + m.Name
		exec.Command("docker", "rm", "-f", cname).Run()
		db.Pool.Exec(ctx, `
			UPDATE koth_machines SET status='expired', health_ok=false, container_id='',
				king_player_id=NULL, king_handle=NULL, king_since=NULL
			WHERE arena_ip=$1::inet AND machine_type='corp'
		`, m.ArenaIP)
	}
}

// ResetMachine respawns a single MERIDIAN container from its image, which
// re-seeds clean flags and loot, then clears that box's game state.
func ResetMachine(ctx context.Context, arenaIP string) error {
	m := machineByArenaIP(arenaIP)
	if m == nil {
		return fmt.Errorf("no corp machine at %s", arenaIP)
	}
	db.Pool.Exec(ctx, `INSERT INTO ticker_events (message) VALUES ($1)`,
		"MACHINE RESET: "+m.Name+" respawning, back shortly")
	provisionMachine(ctx, *m)
	return nil
}

// TestMachine probes SSH (22) on a MERIDIAN box at its arena IP (via DNAT).
// Returns reachability plus a detail string.
func TestMachine(arenaIP string) (bool, string) {
	m := machineByArenaIP(arenaIP)
	if m == nil {
		return false, "no corp machine at " + arenaIP
	}
	if dialOK(m.ArenaIP, "22") {
		return true, "ssh reachable on " + m.ArenaIP + ":22"
	}
	return false, "no route / ssh closed on " + m.ArenaIP + ":22"
}

// ClearKing drops the current king on a single MERIDIAN box without a full
// reset (parallels the AD clear-king control).
func ClearKing(ctx context.Context, arenaIP string) error {
	if machineByArenaIP(arenaIP) == nil {
		return fmt.Errorf("no corp machine at %s", arenaIP)
	}
	db.Pool.Exec(ctx, `
		UPDATE koth_machines SET king_player_id=NULL, king_handle=NULL, king_since=NULL
		WHERE arena_ip=$1::inet AND machine_type='corp'`, arenaIP)
	return nil
}
