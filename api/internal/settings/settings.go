// Package settings is a small key/value store backed by the settings table. It
// holds runtime configuration that can change without a redeploy (bounty
// amounts, intervals, etc).
package settings

import (
	"context"
	"strconv"

	"github.com/cyberkiller/api/internal/db"
)

// GetOr returns the stored value for key, or def if the key is missing or empty.
func GetOr(ctx context.Context, key, def string) string {
	v, ok := Get(ctx, key)
	if !ok || v == "" {
		return def
	}
	return v
}

// Get fetches a single setting and reports whether it was found.
func Get(ctx context.Context, key string) (string, bool) {
	var v string
	err := db.Pool.QueryRow(ctx, `SELECT value FROM settings WHERE key=$1`, key).Scan(&v)
	return v, err == nil
}

// Int reads a setting as an integer, falling back to def if missing or unparseable.
func Int(ctx context.Context, key string, def int) int {
	v, ok := Get(ctx, key)
	if !ok {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

// Set writes (or overwrites) a setting.
func Set(ctx context.Context, key, value string) error {
	_, err := db.Pool.Exec(ctx, `
		INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
		ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()
	`, key, value)
	return err
}

// All returns every setting as a map (used by the admin panel).
func All(ctx context.Context) (map[string]string, error) {
	rows, err := db.Pool.Query(ctx, `SELECT key, value FROM settings ORDER BY key`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var k, v string
		rows.Scan(&k, &v)
		out[k] = v
	}
	return out, nil
}
