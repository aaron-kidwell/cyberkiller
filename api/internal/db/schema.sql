-- CyberKiller range-only schema
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS players (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  handle          VARCHAR(32) UNIQUE NOT NULL,
  invite_token    TEXT UNIQUE,
  password_hash   TEXT,
  wg_pubkey       TEXT,
  arena_ip        INET,
  connected       BOOLEAN NOT NULL DEFAULT FALSE,
  last_heartbeat  TIMESTAMPTZ,
  avatar_url      TEXT,
  bio             VARCHAR(280),
  title           VARCHAR(64),
  custom_css      TEXT,
  theme_preset    VARCHAR(32) DEFAULT 'neon_ghost',
  color_bg        VARCHAR(16),
  color_card      VARCHAR(16),
  color_accent    VARCHAR(16),
  color_text      VARCHAR(16),
  color_text_dim  VARCHAR(16),
  banned          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE players ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS profile_ext JSONB;

CREATE TABLE IF NOT EXISTS ip_pool (
  arena_ip    INET PRIMARY KEY,
  pool        VARCHAR(8) NOT NULL CHECK (pool IN ('player','target')),
  assigned_to UUID,
  assigned_at TIMESTAMPTZ
);

-- The target IP pool is seeded at startup from the active network mode
-- (ARENA_IP_PREFIX/ARENA_BOX_BASE) by targets.SeedIPPool - see api/internal/targets/arena.go.

CREATE TABLE IF NOT EXISTS targets (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  instance_id      TEXT UNIQUE NOT NULL,
  arena_ip         INET UNIQUE NOT NULL,
  tier             VARCHAR(16) NOT NULL CHECK (tier IN ('easy','medium','hard')),
  plaintext_secret TEXT NOT NULL,
  shadow_hash      TEXT NOT NULL,
  salt             TEXT NOT NULL,
  issued_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ttl_seconds      INT NOT NULL DEFAULT 1800,
  status           VARCHAR(16) NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','captured','expired','rotating')),
  open_ports       JSONB,
  cred_hint        TEXT,
  intel_hint       TEXT,
  image_name       TEXT,
  submitter_handle TEXT
);

CREATE INDEX IF NOT EXISTS idx_targets_status ON targets(status);
CREATE INDEX IF NOT EXISTS idx_targets_arena_ip ON targets(arena_ip);

CREATE TABLE IF NOT EXISTS flows (
  id          BIGSERIAL PRIMARY KEY,
  src_ip      INET NOT NULL,
  dst_ip      INET NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flows_src_dst_time ON flows(src_ip, dst_ip, observed_at DESC);

CREATE OR REPLACE FUNCTION purge_old_flows() RETURNS void AS $$
  DELETE FROM flows WHERE observed_at < NOW() - INTERVAL '24 hours';
$$ LANGUAGE sql;

CREATE TABLE IF NOT EXISTS scores (
  player_id  UUID PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  points     INT NOT NULL DEFAULT 0,
  kills      INT NOT NULL DEFAULT 0,
  deaths     INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS target_images (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  docker_image TEXT NOT NULL,
  tier         VARCHAR(16) NOT NULL CHECK (tier IN ('easy','medium','hard')),
  difficulty   VARCHAR(8) NOT NULL DEFAULT 'easy',
  description  TEXT,
  ssh_port     INT NOT NULL DEFAULT 22,
  web_port     INT NOT NULL DEFAULT 80,
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  fail_count   INT NOT NULL DEFAULT 0,
  added_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS image_submissions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  player_id     UUID NOT NULL REFERENCES players(id),
  docker_image  TEXT NOT NULL,
  machine_name  TEXT NOT NULL,
  tier          VARCHAR(16) NOT NULL,
  description   TEXT,
  status        VARCHAR(12) NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected')),
  admin_note    TEXT,
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS koth_machines (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  image_id        TEXT REFERENCES target_images(id),
  image_name      TEXT NOT NULL,
  arena_ip        INET,
  container_id    TEXT,
  tier            VARCHAR(16) NOT NULL,
  status          VARCHAR(16) NOT NULL DEFAULT 'spinning'
                  CHECK (status IN ('spinning','active','expired','failed')),
  claim_token     TEXT NOT NULL,
  token_issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  king_player_id  UUID REFERENCES players(id),
  king_handle     TEXT,
  king_since      TIMESTAMPTZ,
  bounty_pts      INT NOT NULL DEFAULT 500,
  user_flag       TEXT,
  root_flag       TEXT,
  intel_hint      TEXT,
  intel_level       INT NOT NULL DEFAULT 0,
  health_ok       BOOLEAN NOT NULL DEFAULT FALSE,
  ssh_password    TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_koth_active ON koth_machines(status) WHERE status = 'active';

-- kills references both targets and koth_machines, so it must be defined after them.
CREATE TABLE IF NOT EXISTS kills (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  attacker_id  UUID NOT NULL REFERENCES players(id),
  kind         VARCHAR(12) NOT NULL CHECK (kind IN ('target','community','koth','user_flag','root_flag')),
  target_id    UUID REFERENCES targets(id),
  koth_id      UUID REFERENCES koth_machines(id),
  points       INT NOT NULL DEFAULT 0,
  verified     BOOLEAN NOT NULL DEFAULT FALSE,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT kill_target_kind CHECK (
    (kind IN ('target','community') AND target_id IS NOT NULL) OR
    (kind IN ('koth','user_flag','root_flag') AND koth_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_kills_attacker ON kills(attacker_id);
CREATE INDEX IF NOT EXISTS idx_kills_submitted ON kills(submitted_at DESC);

CREATE TABLE IF NOT EXISTS koth_holds (
  id              BIGSERIAL PRIMARY KEY,
  machine_id      UUID NOT NULL REFERENCES koth_machines(id),
  player_id       UUID NOT NULL REFERENCES players(id),
  crowned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  held_until      TIMESTAMPTZ,
  bounty_pts      INT NOT NULL DEFAULT 0,
  survived_expiry BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS intel_drops (
  id          BIGSERIAL PRIMARY KEY,
  object_id   UUID NOT NULL,
  object_type VARCHAR(16) NOT NULL CHECK (object_type IN ('target','koth')),
  hint        TEXT NOT NULL,
  dropped_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (object_id, object_type)
);

CREATE TABLE IF NOT EXISTS sitrep_events (
  id         BIGSERIAL PRIMARY KEY,
  message    TEXT NOT NULL,
  event_type VARCHAR(32) NOT NULL DEFAULT 'intel_drop',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ticker_events (
  id         BIGSERIAL PRIMARY KEY,
  message    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS machine_feedback (
  id          BIGSERIAL PRIMARY KEY,
  player_id   UUID REFERENCES players(id) ON DELETE SET NULL,
  handle      VARCHAR(32),
  arena_ip    INET NOT NULL,
  image_name  TEXT NOT NULL,
  stars       SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  body        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id          BIGSERIAL PRIMARY KEY,
  message_id  TEXT NOT NULL,
  handle      TEXT NOT NULL,
  text        TEXT NOT NULL,
  is_system   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL PRIMARY KEY,
  actor      TEXT NOT NULL DEFAULT 'system',
  action     TEXT NOT NULL,
  detail     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS page_content (
  id         TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS site_theme (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS health_check_log (
  id           BIGSERIAL PRIMARY KEY,
  image_id     TEXT,
  machine_id   UUID,
  passed       BOOLEAN NOT NULL,
  failed_step  TEXT,
  error_detail TEXT,
  checked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Admin-editable known issues shown on /known-issues.
CREATE TABLE IF NOT EXISTS known_issues (
  id         BIGSERIAL PRIMARY KEY,
  severity   TEXT NOT NULL DEFAULT 'LOW',  -- CRITICAL | HIGH | LOW
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Player-submitted feature requests + upvote/downvote.
CREATE TABLE IF NOT EXISTS feature_requests (
  id         BIGSERIAL PRIMARY KEY,
  player_id  UUID REFERENCES players(id) ON DELETE SET NULL,
  handle     TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'open',  -- open | planned | in_progress | done | declined
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS feature_votes (
  feature_id BIGINT NOT NULL REFERENCES feature_requests(id) ON DELETE CASCADE,
  player_id  UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  vote       SMALLINT NOT NULL CHECK (vote IN (-1, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (feature_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_feature_votes_feature ON feature_votes(feature_id);

-- Remove legacy placeholder images that no longer have real Docker images.
UPDATE koth_machines SET image_id = NULL
  WHERE image_id IN ('neon-dvwa','sqli-login','xss-reflected','cmd-ping','upload-unsafe',
                     'lfi-include','creds-leak','shadow-suid','sudo-misconfig','citadel-chain');
DELETE FROM target_images
  WHERE id IN ('neon-dvwa','sqli-login','xss-reflected','cmd-ping','upload-unsafe',
               'lfi-include','creds-leak','shadow-suid','sudo-misconfig','citadel-chain');

INSERT INTO target_images (id, name, docker_image, tier, difficulty, description, ssh_port, web_port, enabled) VALUES
  ('apache-rce',        'Apache Path Traversal',  'cyberkiller/target-apache-rce:latest',        'easy',    'easy',   'CVE-2021-41773 · Apache 2.4.49 path traversal + CGI RCE', 22, 80, true),
  ('shellshock',        'Shellshock CGI',          'cyberkiller/target-shellshock:latest',        'easy',    'easy',   'CVE-2014-6271 · Bash 4.3 shellshock via HTTP headers in Apache CGI', 22, 80, true),
  ('tomcat-upload',     'Tomcat JSP Upload',       'cyberkiller/target-tomcat-upload:latest',     'easy',    'easy',   'CVE-2017-12615 · Tomcat 8.5.19 HTTP PUT arbitrary JSP upload', 22, 80, true),
  ('struts-ognl',       'Struts OGNL Injection',   'cyberkiller/target-struts-ognl:latest',       'medium',  'medium', 'CVE-2017-5638 · Apache Struts 2.5.10 Content-Type OGNL RCE', 22, 80, true),
  ('log4shell',         'Log4Shell',               'cyberkiller/target-log4shell:latest',         'medium',  'medium', 'CVE-2021-44228 · Log4j 2.14.1 JNDI injection via Solr query params', 22, 80, true),
  ('spring4shell',      'Spring4Shell',            'cyberkiller/target-spring4shell:latest',      'medium',  'medium', 'CVE-2022-22965 · Spring Framework 5.3.17 classLoader manipulation RCE', 22, 80, true),
  ('jenkins-rce',       'Jenkins Groovy RCE',      'cyberkiller/target-jenkins-rce:latest',       'medium',  'medium', 'CVE-2018-1000861 · Jenkins 2.138 unauthenticated Groovy script execution', 22, 80, true),
  ('elasticsearch-rce', 'Elasticsearch Groovy',    'cyberkiller/target-elasticsearch-rce:latest', 'hard', 'hard',   'CVE-2015-1427 · Elasticsearch 1.4.2 Groovy sandbox escape via script_fields', 22, 80, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO settings (key, value) VALUES
  ('user_flag_points', '150'),
  ('root_flag_points', '400'),
  ('hub_default_sitrep', 'Arena standing by. Connect your attack VM to engage.'),
  ('hub_connect_warning', 'Use a dedicated attack VM (Kali/Parrot). Attack platform machines only - not other players'' personal machines.'),
  ('koth_bounty_neon', '300'),
  ('koth_bounty_shadow', '500'),
  ('koth_bounty_citadel', '750')
ON CONFLICT DO NOTHING;
