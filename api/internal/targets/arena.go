package targets

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/cyberkiller/api/internal/db"
)

// Arena addressing is mode-driven so the same code serves two network layouts:
//
//   bridge mode  - targets on a private Docker bridge (10.66.20.0/24). Reachable
//                  from the host with zero config; good for single-host/cloud.
//   lan mode     - targets on an ipvlan attached to the physical LAN, so each box
//                  gets a real LAN IP and any machine on the LAN reaches it with
//                  no routing. deploy.sh fills ARENA_IP_PREFIX/ARENA_BOX_BASE.
//
// Box slot i (0-based) lives at <prefix>.<base+i>. The MERIDIAN roster + the
// modular target pool both derive their IPs from this, so switching modes is a
// matter of changing two env vars - nothing hardcodes 10.66.20 any more.

// arenaTargetSlots is how many target IPs we reserve (10 MERIDIAN boxes + room
// for modular targets the instructor spins).
const arenaTargetSlots = 24

func ArenaIPPrefix() string {
	if p := strings.TrimSpace(os.Getenv("ARENA_IP_PREFIX")); p != "" {
		return p
	}
	return "10.66.20"
}

func ArenaBoxBase() int {
	if n, err := strconv.Atoi(strings.TrimSpace(os.Getenv("ARENA_BOX_BASE"))); err == nil && n > 1 && n < 250 {
		return n
	}
	return 50
}

// BoxIP returns the arena IP for a fixed roster slot (0-based).
func BoxIP(slot int) string {
	return fmt.Sprintf("%s.%d", ArenaIPPrefix(), ArenaBoxBase()+slot)
}

// SeedIPPool fills the target IP pool for the active mode. Idempotent: only adds
// rows that don't exist, so it's safe to run on every boot. Replaces the static
// 10.66.20.x seed that used to live in schema.sql.
func SeedIPPool(ctx context.Context) {
	if db.Pool == nil {
		return
	}
	base := ArenaBoxBase()
	for i := 0; i < arenaTargetSlots; i++ {
		ip := fmt.Sprintf("%s.%d", ArenaIPPrefix(), base+i)
		db.Pool.Exec(ctx, `INSERT INTO ip_pool (arena_ip, pool) VALUES ($1::inet, 'target') ON CONFLICT DO NOTHING`, ip)
	}
}
