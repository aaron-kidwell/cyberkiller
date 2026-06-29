package db

import (
	"context"
	"log"
	"os"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

var RDB *redis.Client

// fallback in-memory rate limiter used when Redis is unavailable.
var (
	fbMu    sync.Mutex
	fbStore = make(map[string][]time.Time)
)

func fallbackRateLimit(key string, limit int, window time.Duration) bool {
	fbMu.Lock()
	defer fbMu.Unlock()
	now := time.Now()
	cutoff := now.Add(-window)
	var recent []time.Time
	for _, t := range fbStore[key] {
		if t.After(cutoff) {
			recent = append(recent, t)
		}
	}
	fbStore[key] = recent
	if len(recent) >= limit {
		return false
	}
	fbStore[key] = append(fbStore[key], now)
	return true
}

// fallbackRateLimitCount counts entries in the last minute without adding one.
func fallbackRateLimitCount(key string) int {
	fbMu.Lock()
	defer fbMu.Unlock()
	cutoff := time.Now().Add(-time.Minute)
	n := 0
	for _, t := range fbStore[key] {
		if t.After(cutoff) {
			n++
		}
	}
	return n
}

func ConnectRedis(ctx context.Context) {
	url := os.Getenv("REDIS_URL")
	if url == "" {
		url = "redis://localhost:6379"
	}
	opts, err := redis.ParseURL(url)
	if err != nil {
		log.Printf("[redis] bad REDIS_URL: %v - rate limiting will use in-memory fallback", err)
		return
	}
	RDB = redis.NewClient(opts)
	if err := RDB.Ping(ctx).Err(); err != nil {
		log.Printf("[redis] ping failed: %v - rate limiting will use in-memory fallback", err)
		RDB = nil
	}
}

// RateLimit returns true if the action is allowed, false if the limit is exceeded.
// Uses Redis INCR+EXPIRE when available; falls back to in-memory (never fail-open).
func RateLimit(ctx context.Context, key string, limit int, window time.Duration) bool {
	if RDB == nil {
		return fallbackRateLimit(key, limit, window)
	}
	rkey := "rl:" + key
	count, err := RDB.Incr(ctx, rkey).Result()
	if err != nil {
		// Redis error - fall back to in-memory rather than fail open
		return fallbackRateLimit(key, limit, window)
	}
	if count == 1 {
		RDB.Expire(ctx, rkey, window)
	}
	return count <= int64(limit)
}

// RateLimitCount returns the current count for a key WITHOUT incrementing it.
// Used to check a failure-counter before doing work (e.g. admin auth) so that
// successful requests don't consume the bucket. 0 if the key doesn't exist.
func RateLimitCount(ctx context.Context, key string) int {
	if RDB == nil {
		return fallbackRateLimitCount(key)
	}
	n, err := RDB.Get(ctx, "rl:"+key).Int()
	if err != nil {
		return 0
	}
	return n
}
