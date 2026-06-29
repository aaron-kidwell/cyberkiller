// Package scoring centralises every points/kills award. Keeping the rules in one
// place means the leaderboard and flag captures agree on what a "user flag" or a
// "root flag" is worth.
package scoring

import (
	"context"

	"github.com/google/uuid"

	"github.com/cyberkiller/api/internal/db"
)

// Point values for each scoring event, exported so callers award consistent amounts.
const (
	TargetKillPoints    = 100 // standalone target box
	CommunityKillPoints = 100 // community-submitted box
	UserFlagPoints      = 150 // foothold (user.txt)
	AdminFlagPoints     = 250 // admin flag (legacy)
	RootFlagPoints      = 400 // full root (root.txt)
)

// ClaimRoundFirstBlood atomically returns true for exactly ONE capture per round
// (the round is keyed on the last_arena_rotation timestamp). First blood is the
// FIRST flag captured in the whole round, NOT the first capture per target. The
// conditional upsert flips the stored round id only for the first new capture of
// the round; every later capture this round sees RowsAffected==0 and loses.
func ClaimRoundFirstBlood(ctx context.Context) bool {
	var rot string
	db.Pool.QueryRow(ctx, `SELECT value FROM settings WHERE key='last_arena_rotation'`).Scan(&rot)
	if rot == "" {
		rot = "bootstrap"
	}
	tag, err := db.Pool.Exec(ctx, `
		INSERT INTO settings (key, value, updated_at) VALUES ('first_blood_round', $1, NOW())
		ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()
		WHERE settings.value IS DISTINCT FROM EXCLUDED.value
	`, rot)
	if err != nil {
		return false
	}
	return tag.RowsAffected() == 1
}

// AwardKill records a verified capture in the kills table and bumps the player's
// score. targetID/kothID are pointers so the unused one can be nil (SQL NULL): a
// kill is against either a target or a koth machine, never both.
func AwardKill(ctx context.Context, playerID uuid.UUID, points int, kind string, targetID, kothID *uuid.UUID) error {
	_, err := db.Pool.Exec(ctx, `
		INSERT INTO kills (attacker_id, kind, target_id, koth_id, points, verified)
		VALUES ($1, $2, $3, $4, $5, true)
	`, playerID, kind, targetID, kothID, points)
	if err != nil {
		return err
	}

	// user_flag is a foothold: it awards points but does not count as a kill.
	killDelta := 0
	if kind != "user_flag" {
		killDelta = 1
	}

	_, err = db.Pool.Exec(ctx, `
		INSERT INTO scores (player_id, points, kills)
		VALUES ($1, $2, $3)
		ON CONFLICT (player_id) DO UPDATE
		  SET points = scores.points + EXCLUDED.points,
		      kills = scores.kills + EXCLUDED.kills,
		      updated_at = NOW()
	`, playerID, points, killDelta)
	return err // nil on success; the caller checks this
}

// AwardPoints bumps a player's score without recording a kill (used for things
// like KOTH "tick" rewards that aren't a capture). Same UPSERT pattern, minus
// the kills column.
func AwardPoints(ctx context.Context, playerID uuid.UUID, points int) error {
	_, err := db.Pool.Exec(ctx, `
		INSERT INTO scores (player_id, points)
		VALUES ($1, $2)
		ON CONFLICT (player_id) DO UPDATE
		  SET points = scores.points + EXCLUDED.points, updated_at = NOW()
	`, playerID, points)
	return err
}
