package db

import (
	"context"
	"log"
)

// ApplyMigrations runs idempotent ALTERs for existing local volumes.
func ApplyMigrations(ctx context.Context) {
	stmts := []string{
		`ALTER TABLE koth_machines ADD COLUMN IF NOT EXISTS user_flag TEXT`,
		`ALTER TABLE koth_machines ADD COLUMN IF NOT EXISTS root_flag TEXT`,
		`ALTER TABLE koth_machines ADD COLUMN IF NOT EXISTS intel_hint TEXT`,
		`ALTER TABLE koth_machines ADD COLUMN IF NOT EXISTS intel_level INT NOT NULL DEFAULT 0`,
		`ALTER TABLE koth_machines ADD COLUMN IF NOT EXISTS user_flag_handle TEXT`,
		`CREATE TABLE IF NOT EXISTS capture_log (
			id BIGSERIAL PRIMARY KEY,
			attacker_id UUID,
			handle TEXT NOT NULL,
			kind TEXT NOT NULL,
			koth_id UUID,
			target_id UUID,
			arena_ip TEXT,
			points INT NOT NULL DEFAULT 0,
			first_blood BOOLEAN NOT NULL DEFAULT false,
			captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`,
		`CREATE INDEX IF NOT EXISTS capture_log_recent ON capture_log (captured_at DESC)`,
		`CREATE TABLE IF NOT EXISTS foothold_creds (
			id BIGSERIAL PRIMARY KEY,
			domain TEXT NOT NULL,
			username TEXT NOT NULL,
			password TEXT NOT NULL,
			note TEXT,
			UNIQUE (domain, username)
		)`,
		`ALTER TABLE kills DROP CONSTRAINT IF EXISTS kills_kind_check`,
		`ALTER TABLE kills ADD CONSTRAINT kills_kind_check
			CHECK (kind IN ('target','community','koth','user_flag','root_flag'))`,
		`ALTER TABLE kills DROP CONSTRAINT IF EXISTS kill_target_kind`,
		`ALTER TABLE kills ADD CONSTRAINT kill_target_kind CHECK (
			(kind IN ('target','community') AND target_id IS NOT NULL) OR
			(kind IN ('koth','user_flag','root_flag') AND koth_id IS NOT NULL)
		)`,
		`INSERT INTO settings (key, value) VALUES ('user_flag_points', '150') ON CONFLICT DO NOTHING`,
		`INSERT INTO settings (key, value) VALUES ('root_flag_points', '400') ON CONFLICT DO NOTHING`,
		`INSERT INTO settings (key, value) VALUES ('hub_default_sitrep', 'Arena standing by. Connect your attack VM to engage.') ON CONFLICT DO NOTHING`,
		`INSERT INTO settings (key, value) VALUES ('hub_connect_warning', 'Use a dedicated attack VM (Kali/Parrot). Attack platform machines only, not other players'' personal machines.') ON CONFLICT DO NOTHING`,
		`INSERT INTO settings (key, value) VALUES ('heartbeat_timeout_s', '15') ON CONFLICT DO NOTHING`,
		`INSERT INTO settings (key, value) VALUES ('signup_mode', 'open') ON CONFLICT DO NOTHING`,
		`INSERT INTO settings (key, value) VALUES ('signup_invite_code', '') ON CONFLICT DO NOTHING`,
		// Purge settings keys from removed features (GOAD/AD scoring, rotation,
		// hill TTL, bounties, intel drops) so the admin panel + API never surface
		// dead knobs. Idempotent: cleans existing databases on the next boot.
		`DELETE FROM settings WHERE key LIKE '%_neon' OR key LIKE '%_shadow' OR key LIKE '%_citadel'
			OR key LIKE 'goad_%' OR key LIKE 'ad_bounty%' OR key LIKE 'koth_bounty%' OR key LIKE 'hill_ttl%'
			OR key IN ('active_scenario','arena_rotation_interval_s','intel_drop_interval_s',
				'max_active_hills','min_active_hills','community_kill_points','admin_flag_points',
				'target_kill_points')`,
		// Extended profile fields
		`ALTER TABLE players ALTER COLUMN bio TYPE TEXT`,
		`ALTER TABLE players ADD COLUMN IF NOT EXISTS profile_ext JSONB NOT NULL DEFAULT '{}'`,
		// SSH credentials for KOTH containers
		`ALTER TABLE koth_machines ADD COLUMN IF NOT EXISTS ssh_password TEXT`,
		// Machine feedback
		`CREATE TABLE IF NOT EXISTS machine_feedback (
			id         BIGSERIAL PRIMARY KEY,
			player_id  UUID REFERENCES players(id) ON DELETE SET NULL,
			handle     VARCHAR(32),
			arena_ip   INET NOT NULL,
			image_name TEXT NOT NULL,
			stars      SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
			body       TEXT,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		// Player admin access
		`ALTER TABLE players ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false`,
		// Blog posts
		`CREATE TABLE IF NOT EXISTS player_posts (
			id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			player_id  UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
			title      TEXT NOT NULL,
			body       TEXT NOT NULL,
			published  BOOLEAN NOT NULL DEFAULT true,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		// Target reset voting
		`CREATE TABLE IF NOT EXISTS koth_reset_votes (
			machine_id UUID REFERENCES koth_machines(id) ON DELETE CASCADE,
			player_id  UUID REFERENCES players(id) ON DELETE CASCADE,
			voted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			PRIMARY KEY (machine_id, player_id)
		)`,
		// CMS tables for edit mode
		`CREATE TABLE IF NOT EXISTS page_content (
			id         TEXT PRIMARY KEY,
			value      TEXT NOT NULL,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS site_theme (
			key   TEXT PRIMARY KEY,
			value TEXT NOT NULL
		)`,
		// Fix FK constraints to cascade properly on player delete
		`ALTER TABLE kills DROP CONSTRAINT IF EXISTS kills_attacker_id_fkey`,
		`ALTER TABLE kills ADD CONSTRAINT kills_attacker_id_fkey FOREIGN KEY (attacker_id) REFERENCES players(id) ON DELETE CASCADE`,
		`ALTER TABLE koth_holds DROP CONSTRAINT IF EXISTS koth_holds_player_id_fkey`,
		`ALTER TABLE koth_holds ADD CONSTRAINT koth_holds_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE`,
		`ALTER TABLE koth_machines DROP CONSTRAINT IF EXISTS koth_machines_king_player_id_fkey`,
		`ALTER TABLE koth_machines ADD CONSTRAINT koth_machines_king_player_id_fkey FOREIGN KEY (king_player_id) REFERENCES players(id) ON DELETE SET NULL`,
		`ALTER TABLE image_submissions DROP CONSTRAINT IF EXISTS image_submissions_player_id_fkey`,
		`ALTER TABLE image_submissions ADD CONSTRAINT image_submissions_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE SET NULL`,
		// AD VM columns - machine_type='ad' rows never expire via Docker
		`ALTER TABLE koth_machines ADD COLUMN IF NOT EXISTS machine_type TEXT NOT NULL DEFAULT 'docker'`,
		`ALTER TABLE koth_machines ADD COLUMN IF NOT EXISTS winrm_host TEXT`,
		`ALTER TABLE koth_machines ADD COLUMN IF NOT EXISTS winrm_port INT NOT NULL DEFAULT 5985`,
		`ALTER TABLE koth_machines ADD COLUMN IF NOT EXISTS winrm_user TEXT`,
		`ALTER TABLE koth_machines ADD COLUMN IF NOT EXISTS winrm_pass TEXT`,
		`ALTER TABLE koth_machines ADD COLUMN IF NOT EXISTS goad_domain TEXT`,
		`ALTER TABLE koth_machines ADD COLUMN IF NOT EXISTS goad_flag_path TEXT`,
		`ALTER TABLE koth_machines ADD COLUMN IF NOT EXISTS goad_root_flag_path TEXT`,
		`ALTER TABLE koth_machines ADD COLUMN IF NOT EXISTS goad_token_path TEXT`,
		// Allow expires_at to be NULL/infinity for always-on AD machines
		`ALTER TABLE koth_machines ALTER COLUMN expires_at DROP NOT NULL`,
		// Unique constraint on arena_ip for AD machine upsert
		`CREATE UNIQUE INDEX IF NOT EXISTS koth_machines_arena_ip_unique ON koth_machines (arena_ip) WHERE status != 'expired'`,
		// AD re-provision event log (legacy table name; renamed to ad_provision_log below)
		`CREATE TABLE IF NOT EXISTS goad_provision_log (
			id         BIGSERIAL PRIMARY KEY,
			started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			finished_at TIMESTAMPTZ,
			success    BOOLEAN,
			output     TEXT
		)`,
		// Local-admin flag (C:\koth\admin.txt) - separate from domain-admin flag (root.txt / da.txt)
		`ALTER TABLE koth_machines ADD COLUMN IF NOT EXISTS goad_admin_flag_path TEXT`,
		// Whether this machine is a domain controller (adds the DA flag on top of user+admin)
		`ALTER TABLE koth_machines ADD COLUMN IF NOT EXISTS is_domain_controller BOOLEAN NOT NULL DEFAULT false`,
		// Extend kills constraints to include admin_flag
		`ALTER TABLE kills DROP CONSTRAINT IF EXISTS kills_kind_check`,
		`ALTER TABLE kills ADD CONSTRAINT kills_kind_check
			CHECK (kind IN ('target','community','koth','user_flag','admin_flag','root_flag'))`,
		`ALTER TABLE kills DROP CONSTRAINT IF EXISTS kill_target_kind`,
		`ALTER TABLE kills ADD CONSTRAINT kill_target_kind CHECK (
			(kind IN ('target','community') AND target_id IS NOT NULL) OR
			(kind IN ('koth','user_flag','admin_flag','root_flag') AND koth_id IS NOT NULL)
		)`,
		// Linux machine SSH fields (lx01/lx02/lx03)
		`ALTER TABLE koth_machines ADD COLUMN IF NOT EXISTS linux_machine BOOLEAN NOT NULL DEFAULT false`,
		`ALTER TABLE koth_machines ADD COLUMN IF NOT EXISTS ssh_key_path TEXT`,
		// Per-machine port config for hub display (JSONB, null = use OS default)
		// Enables plug-and-play target swaps without code changes
		`ALTER TABLE koth_machines ADD COLUMN IF NOT EXISTS open_ports_config JSONB`,
		// Range-wide reset votes (players vote to reset ALL machines)
		`CREATE TABLE IF NOT EXISTS range_reset_votes (
			player_id UUID REFERENCES players(id) ON DELETE CASCADE PRIMARY KEY,
			voted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		// Problem reports submitted by players
		`CREATE TABLE IF NOT EXISTS bug_reports (
			id         BIGSERIAL PRIMARY KEY,
			player_id  UUID REFERENCES players(id) ON DELETE SET NULL,
			handle     VARCHAR(32),
			category   VARCHAR(64) NOT NULL DEFAULT 'general',
			body       TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		// Agent version tracking for hub version gate
		`ALTER TABLE players ADD COLUMN IF NOT EXISTS agent_version VARCHAR(32) NOT NULL DEFAULT ''`,
		// Add ad_* columns and copy data from legacy goad_* columns (idempotent)
		`ALTER TABLE koth_machines ADD COLUMN IF NOT EXISTS ad_domain TEXT`,
		`ALTER TABLE koth_machines ADD COLUMN IF NOT EXISTS ad_flag_path TEXT`,
		`ALTER TABLE koth_machines ADD COLUMN IF NOT EXISTS ad_root_flag_path TEXT`,
		`ALTER TABLE koth_machines ADD COLUMN IF NOT EXISTS ad_token_path TEXT`,
		`ALTER TABLE koth_machines ADD COLUMN IF NOT EXISTS ad_admin_flag_path TEXT`,
		`UPDATE koth_machines SET ad_domain=goad_domain WHERE ad_domain IS NULL AND goad_domain IS NOT NULL`,
		`UPDATE koth_machines SET ad_flag_path=goad_flag_path WHERE ad_flag_path IS NULL AND goad_flag_path IS NOT NULL`,
		`UPDATE koth_machines SET ad_root_flag_path=goad_root_flag_path WHERE ad_root_flag_path IS NULL AND goad_root_flag_path IS NOT NULL`,
		`UPDATE koth_machines SET ad_token_path=goad_token_path WHERE ad_token_path IS NULL AND goad_token_path IS NOT NULL`,
		`UPDATE koth_machines SET ad_admin_flag_path=goad_admin_flag_path WHERE ad_admin_flag_path IS NULL AND goad_admin_flag_path IS NOT NULL`,
		`DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='goad_provision_log') THEN ALTER TABLE goad_provision_log RENAME TO ad_provision_log; END IF; END $$`,
		// Rotating session token for single-session browser auth (separate from invite_token used by the agent)
		`ALTER TABLE players ADD COLUMN IF NOT EXISTS session_token TEXT UNIQUE`,
		// Backfill session tokens for players that existed before this migration
		`UPDATE players SET session_token = 'SES-' || encode(sha256(random()::text::bytea || id::text::bytea), 'hex') WHERE session_token IS NULL`,
		// Browser session expiry (24-hour window; minted fresh on each web login).
		`ALTER TABLE players ADD COLUMN IF NOT EXISTS session_token_expires_at TIMESTAMPTZ`,
		`UPDATE players SET session_token_expires_at = NOW() + INTERVAL '24 hours' WHERE session_token_expires_at IS NULL`,
		// When the current browser session began. Chat replay shows only messages
		// from this point on, so a fresh login starts with a clean slate.
		`ALTER TABLE players ADD COLUMN IF NOT EXISTS session_started_at TIMESTAMPTZ`,
		// Cap any pre-existing long-lived (30-day) session at the new 24h window so
		// the tightened policy applies immediately rather than only on next login.
		`UPDATE players SET session_token_expires_at = NOW() + INTERVAL '24 hours'
		   WHERE session_token_expires_at > NOW() + INTERVAL '24 hours'`,
		// Active range scenario (goad | corp). Alternated on each arena wave when
		// the MERIDIAN corp scenario is enabled. Default goad.
		// Invite token expiry (1-year rolling window; renewed on each successful agent auth)
		`ALTER TABLE players ADD COLUMN IF NOT EXISTS invite_token_expires_at TIMESTAMPTZ`,
		`UPDATE players SET invite_token_expires_at = NOW() + INTERVAL '1 year' WHERE invite_token_expires_at IS NULL`,
		// Prevent double-awarding flags via race condition - each player can only earn each flag type once per machine
		`DELETE FROM kills WHERE id IN (
			SELECT id FROM (
				SELECT id, ROW_NUMBER() OVER (PARTITION BY attacker_id, koth_id, kind ORDER BY id) AS rn
				FROM kills WHERE kind IN ('user_flag','admin_flag','root_flag') AND koth_id IS NOT NULL
			) t WHERE rn > 1
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS kills_flag_once ON kills (attacker_id, koth_id, kind)
			WHERE kind IN ('user_flag','admin_flag','root_flag') AND koth_id IS NOT NULL`,
		// Allow foothold intel drops alongside target/koth drops in intel_drops table
		`ALTER TABLE intel_drops DROP CONSTRAINT IF EXISTS intel_drops_object_type_check`,
		`ALTER TABLE intel_drops ADD CONSTRAINT intel_drops_object_type_check
			CHECK (object_type IN ('target','koth','foothold'))`,
		// Rename tier values from neon/shadow/citadel to easy/medium/hard
		`ALTER TABLE targets DROP CONSTRAINT IF EXISTS targets_tier_check`,
		`UPDATE koth_machines SET tier='easy'   WHERE tier='neon'`,
		`UPDATE koth_machines SET tier='medium' WHERE tier='shadow'`,
		`UPDATE koth_machines SET tier='hard'   WHERE tier='citadel'`,
		`UPDATE targets        SET tier='easy'   WHERE tier='neon'`,
		`UPDATE targets        SET tier='medium' WHERE tier='shadow'`,
		`UPDATE targets        SET tier='hard'   WHERE tier='citadel'`,
		`ALTER TABLE targets DROP CONSTRAINT IF EXISTS targets_tier_check`,
		`ALTER TABLE targets ADD CONSTRAINT targets_tier_check
			CHECK (tier IN ('easy','medium','hard'))`,
		// Rename settings keys to match new tier names
		// Insert fallbacks in case old keys didn't exist yet
		// Assign canonical GOAD difficulties: DCs=hard, member servers=medium, workstations+Linux=easy
		`UPDATE koth_machines SET tier='hard'   WHERE image_name IN ('kingslanding','winterfell','meereen')`,
		`UPDATE koth_machines SET tier='medium' WHERE image_name IN ('castelblack','braavos')`,
		`UPDATE koth_machines SET tier='easy'   WHERE image_name IN ('casterlyrock','stonedoor','dragonstone','deepwood','pentos')`,
		// target_images tier was historically neon/shadow/citadel; align it with the
		// easy/medium/hard values the rest of the app + the modular add use.
		`UPDATE target_images SET tier='easy'   WHERE tier='neon'`,
		`UPDATE target_images SET tier='medium' WHERE tier='shadow'`,
		`UPDATE target_images SET tier='hard'   WHERE tier='citadel'`,
		`ALTER TABLE target_images DROP CONSTRAINT IF EXISTS target_images_tier_check`,
		`ALTER TABLE target_images ADD CONSTRAINT target_images_tier_check CHECK (tier IN ('easy','medium','hard'))`,
		// Modular targets: per-image creds the platform sets in the container (and
		// players use), and how the image got here (a pulled registry reference or
		// an uploaded tarball). NULL/empty root_password means "generate random".
		`ALTER TABLE target_images ADD COLUMN IF NOT EXISTS root_password TEXT`,
		`ALTER TABLE target_images ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'reference'`,
		// Track whether an image needs the CK flag-plant overlay injected at runtime
		// (arbitrary images that don't ship the entrypoint contract).
		`ALTER TABLE target_images ADD COLUMN IF NOT EXISTS needs_flag_inject BOOLEAN NOT NULL DEFAULT false`,
		// claim_token is a leftover from the removed KotH-token mechanism; modular
		// targets do not set it, so make it optional.
		`ALTER TABLE koth_machines ALTER COLUMN claim_token DROP NOT NULL`,
		`ALTER TABLE koth_machines ALTER COLUMN claim_token SET DEFAULT ''`,
		// Automated King-of-the-Hill: a target in KOTH mode is polled for who holds
		// /root/king.txt, and the holder ticks up points. CTF/manual targets leave
		// this false. Default the MERIDIAN/example boxes to false (they're a chain).
		`ALTER TABLE target_images ADD COLUMN IF NOT EXISTS koth_enabled BOOLEAN NOT NULL DEFAULT false`,
		`ALTER TABLE koth_machines ADD COLUMN IF NOT EXISTS koth_enabled BOOLEAN NOT NULL DEFAULT false`,
		// Where the planted flags land (admin-configurable when flags are injected).
		`ALTER TABLE target_images ADD COLUMN IF NOT EXISTS user_flag_path TEXT NOT NULL DEFAULT '/home/ckplayer/user.txt'`,
		`ALTER TABLE target_images ADD COLUMN IF NOT EXISTS root_flag_path TEXT NOT NULL DEFAULT '/root/root.txt'`,
		`INSERT INTO settings (key, value) VALUES ('koth_tick_seconds', '60') ON CONFLICT DO NOTHING`,
		`INSERT INTO settings (key, value) VALUES ('koth_points_per_tick', '10') ON CONFLICT DO NOTHING`,
		// Longest continuous KOTH reign (seconds) a player has ever held - a leaderboard stat.
		`ALTER TABLE scores ADD COLUMN IF NOT EXISTS longest_reign_secs INT NOT NULL DEFAULT 0`,
		// Daily login streak shown on the player profile (read by handleGetPlayer).
		`ALTER TABLE players ADD COLUMN IF NOT EXISTS login_streak INT NOT NULL DEFAULT 0`,
		`ALTER TABLE players ADD COLUMN IF NOT EXISTS login_streak_max INT NOT NULL DEFAULT 0`,
		`ALTER TABLE players ADD COLUMN IF NOT EXISTS last_login_date DATE`,
	}
	for _, s := range stmts {
		if _, err := Pool.Exec(ctx, s); err != nil {
			log.Printf("[db] migration: %v", err)
		}
	}
}
