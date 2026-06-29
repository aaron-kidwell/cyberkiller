// Package db owns the Postgres connection pool and Redis client, the schema/
// migrations applied at boot, and small query helpers shared across the app.
package db

import (
	"context"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
)

var Pool *pgxpool.Pool

func Connect(ctx context.Context) error {
	dsn := os.Getenv("DB_DSN")
	if dsn == "" {
		dsn = "postgres://cyberkiller:localdev@localhost:5432/cyberkiller?sslmode=disable"
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return err
	}
	Pool = pool
	if err := Pool.Ping(ctx); err != nil {
		return err
	}
	ApplyMigrations(ctx)
	return nil
}
