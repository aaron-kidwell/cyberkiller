package koth

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"time"

	"github.com/cyberkiller/api/internal/chat"
	"github.com/cyberkiller/api/internal/db"
	"github.com/cyberkiller/api/internal/scoring"
	"github.com/cyberkiller/api/internal/settings"
	"github.com/google/uuid"
)

// Automated King-of-the-Hill. Unlike TryHackMe (which makes every player run a
// `koth` client to claim the throne), CyberKiller detects the king server-side:
// the control plane already owns the container, so it reads /root/king.txt
// directly. Whoever's handle is in that file holds the throne; points tick up to
// the current holder every interval, and stealing the throne is just overwriting
// the file (which needs root - that's the game). Nothing to install for players.

const kingFile = "/root/king.txt"

func kingTickSeconds(ctx context.Context) int {
	if n := settings.Int(ctx, "koth_tick_seconds", 60); n > 0 {
		return n
	}
	return 60
}

func kingPointsPerTick(ctx context.Context) int {
	return settings.Int(ctx, "koth_points_per_tick", 10)
}

// StartKingScanner ticks the automated KOTH loop: every interval it reads each
// live KOTH box's throne file, crowns whoever holds it, and awards the holder.
func StartKingScanner(ctx context.Context) {
	if os.Getenv("LOCAL_DOCKER_ORCHESTRATION") != "true" {
		return
	}
	go func() {
		for {
			scanKings(ctx)
			// Re-read the interval every loop so changing koth_tick_seconds in the
			// admin panel takes effect live, without a control-plane restart.
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Duration(kingTickSeconds(ctx)) * time.Second):
			}
		}
	}()
}

var kingHandleRe = regexp.MustCompile(`[^a-zA-Z0-9_-]`)

func scanKings(ctx context.Context) {
	rows, err := db.Pool.Query(ctx, `
		SELECT id::text, container_id, host(arena_ip), image_name, koth_enabled,
			COALESCE(NULLIF(ad_flag_path,''), '/home/ckplayer/user.txt'),
			COALESCE(NULLIF(ad_root_flag_path,''), '/root/root.txt'),
			COALESCE(king_handle,''),
			COALESCE(EXTRACT(EPOCH FROM (NOW()-king_since))::int, 0)
		FROM koth_machines
		WHERE status='active' AND COALESCE(container_id,'') != ''
	`)
	if err != nil {
		return
	}
	type box struct {
		id, cid, ip, img, userPath, rootPath, king string
		koth                                       bool
		kingSecs                                   int
	}
	var boxes []box
	for rows.Next() {
		var b box
		rows.Scan(&b.id, &b.cid, &b.ip, &b.img, &b.koth, &b.userPath, &b.rootPath, &b.king, &b.kingSecs)
		boxes = append(boxes, b)
	}
	rows.Close()

	pts := kingPointsPerTick(ctx)
	for _, b := range boxes {
		// One-time flag captures: a player proves they reached a level by writing
		// their hub handle into the flag file. The platform reads it and awards
		// automatically - no submission, no instructor.
		awardCapture(ctx, b.id, b.ip, b.img, readHandle(b.cid, b.userPath), "user_flag")
		awardCapture(ctx, b.id, b.ip, b.img, readHandle(b.cid, b.rootPath), "root_flag")

		// King-of-the-Hill hold: only for KOTH-mode boxes, tracked via /root/king.txt.
		if !b.koth {
			continue
		}
		holder := readHandle(b.cid, kingFile)
		var pid string
		if holder != "" {
			db.Pool.QueryRow(ctx, `SELECT id::text FROM players WHERE handle=$1 AND NOT banned`, holder).Scan(&pid)
		}
		if pid == "" {
			if b.king != "" {
				db.Pool.Exec(ctx, `UPDATE koth_machines SET king_player_id=NULL, king_handle=NULL, king_since=NULL WHERE id=$1`, b.id)
			}
			continue
		}
		if holder != b.king {
			db.Pool.Exec(ctx, `UPDATE koth_machines SET king_player_id=$1, king_handle=$2, king_since=NOW() WHERE id=$3`, pid, holder, b.id)
			msg := fmt.Sprintf("%s seized the throne on %s", holder, b.img)
			if b.king != "" {
				msg = fmt.Sprintf("%s stole the throne on %s from %s", holder, b.img, b.king)
			}
			db.Pool.Exec(ctx, `INSERT INTO ticker_events (message) VALUES ($1)`, msg)
			chat.BroadcastThrone(b.ip, holder, msg)
		}
		if uid, err := uuid.Parse(pid); err == nil {
			scoring.AwardPoints(ctx, uid, pts)
			if holder == b.king && b.kingSecs > 0 {
				db.Pool.Exec(ctx, `UPDATE scores SET longest_reign_secs=GREATEST(longest_reign_secs,$2) WHERE player_id=$1`, uid, b.kingSecs)
			}
		}
	}
}

// awardCapture grants a one-time user/root flag capture to the player whose handle
// is in the flag file, mirroring the admin award path. Per-player, per-box, per-kind
// (a player only captures each flag on a box once); the first capture is first blood.
func awardCapture(ctx context.Context, boxID, ip, img, handle, kind string) {
	if handle == "" {
		return
	}
	var pid string
	db.Pool.QueryRow(ctx, `SELECT id::text FROM players WHERE handle=$1 AND NOT banned`, handle).Scan(&pid)
	if pid == "" {
		return
	}
	uid, err := uuid.Parse(pid)
	if err != nil {
		return
	}
	var already bool
	db.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM kills WHERE koth_id=$1::uuid AND attacker_id=$2 AND kind=$3)`, boxID, uid, kind).Scan(&already)
	if already {
		return
	}
	var firstBlood bool
	db.Pool.QueryRow(ctx, `SELECT NOT EXISTS(SELECT 1 FROM kills WHERE koth_id=$1::uuid AND kind=$2)`, boxID, kind).Scan(&firstBlood)

	pts := settings.Int(ctx, "user_flag_points", scoring.UserFlagPoints)
	label := "user"
	if kind == "root_flag" {
		pts = settings.Int(ctx, "root_flag_points", scoring.RootFlagPoints)
		label = "root"
	}
	kid, _ := uuid.Parse(boxID)
	if err := scoring.AwardKill(ctx, uid, pts, kind, nil, &kid); err != nil {
		return
	}
	if firstBlood {
		db.Pool.Exec(ctx, `UPDATE kills SET first_blood=true WHERE koth_id=$1::uuid AND attacker_id=$2 AND kind=$3`, boxID, uid, kind)
	}
	if kind == "user_flag" {
		db.Pool.Exec(ctx, `UPDATE koth_machines SET user_flag_handle=$1 WHERE id=$2::uuid`, handle, boxID)
	}
	// Record in capture_log, which powers the hub Activity feed.
	db.Pool.Exec(ctx, `
		INSERT INTO capture_log (attacker_id, handle, kind, koth_id, arena_ip, points, first_blood)
		VALUES ($1,$2,$3,$4::uuid,$5,$6,$7)
	`, uid, handle, kind, boxID, ip, pts, firstBlood)
	msg := fmt.Sprintf("%s captured %s on %s (+%d pts)", handle, label, img, pts)
	if firstBlood {
		msg = fmt.Sprintf("FIRST BLOOD: %s captured %s on %s (+%d pts)", handle, label, img, pts)
	}
	db.Pool.Exec(ctx, `INSERT INTO ticker_events (message) VALUES ($1)`, msg)
}

// readHandle reads the first line of a file inside the container and normalizes it
// to a candidate hub handle. Used to detect who wrote their handle into a flag file
// (user.txt / root.txt) or the KOTH throne file. Returns "" if the file is missing,
// empty, or holds only the placeholder/non-handle text.
func readHandle(container, path string) string {
	out, err := exec.Command("docker", "exec", container, "cat", path).Output()
	if err != nil {
		return ""
	}
	h := strings.TrimSpace(string(out))
	if i := strings.IndexAny(h, "\r\n"); i >= 0 {
		h = h[:i]
	}
	if strings.HasPrefix(h, "#") { // placeholder line ("# write your handle here")
		return ""
	}
	h = kingHandleRe.ReplaceAllString(h, "")
	if len(h) > 32 {
		h = h[:32]
	}
	return h
}
