// Package flows records observed network connections in the arena (who talked to
// whom), which powers the radar's flow view. It periodically runs conntrack,
// parses its output, and stores the relevant src->dst pairs.
package flows

import (
	"bufio"
	"context"
	"log"
	"os/exec"
	"strings"
	"time"

	"github.com/cyberkiller/api/internal/db"
)

// StartSampler runs a background loop that samples flows every interval until the
// context is cancelled.
func StartSampler(ctx context.Context, interval time.Duration) {
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				sample(ctx)
			}
		}
	}()
}

func sample(ctx context.Context) {
	out, err := exec.Command("conntrack", "-L").Output()
	if err != nil {
		return
	}
	sc := bufio.NewScanner(strings.NewReader(string(out)))
	var batch [][2]string
	for sc.Scan() {
		line := sc.Text()
		if !strings.Contains(line, "src=") {
			continue
		}
		src, dst := parseConntrackLine(line)
		if src == "" || dst == "" {
			continue
		}
		// Keep player(10.66.10.x) -> arena(10.66.20.x) / docker(172.20.x) traffic.
		if strings.HasPrefix(src, "10.66.10.") && (strings.HasPrefix(dst, "10.66.20.") || strings.HasPrefix(dst, "172.20.")) {
			batch = append(batch, [2]string{src, dst})
		}
	}
	for _, p := range batch {
		db.Pool.Exec(ctx, `INSERT INTO flows (src_ip, dst_ip) VALUES ($1::inet, $2::inet)`, p[0], p[1])
	}
	if len(batch) > 0 {
		log.Printf("[flows] sampled %d flows", len(batch))
	}
	db.Pool.Exec(ctx, `SELECT purge_old_flows()`)
}

func parseConntrackLine(line string) (src, dst string) {
	for _, part := range strings.Fields(line) {
		if strings.HasPrefix(part, "src=") {
			src = strings.TrimPrefix(part, "src=")
		}
		if strings.HasPrefix(part, "dst=") {
			dst = strings.TrimPrefix(part, "dst=")
		}
	}
	return
}

// HasFlow reports whether a src->dst connection was seen within the given window.
func HasFlow(ctx context.Context, srcIP, dstIP string, within time.Duration) bool {
	var n int
	db.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM flows
		WHERE src_ip = $1::inet AND dst_ip = $2::inet
		  AND observed_at > NOW() - ($3 * interval '1 second')
	`, srcIP, dstIP, int(within.Seconds())).Scan(&n)
	return n > 0
}
