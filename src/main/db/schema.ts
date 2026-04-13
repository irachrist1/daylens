// Raw SQL schema — will be replaced by Drizzle in Phase 2a (see docs/next-steps.md)

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_sessions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  bundle_id       TEXT    NOT NULL,
  app_name        TEXT    NOT NULL,
  start_time      INTEGER NOT NULL,
  end_time        INTEGER,
  duration_sec    INTEGER NOT NULL DEFAULT 0,
  category        TEXT    NOT NULL DEFAULT 'uncategorized',
  is_focused      INTEGER NOT NULL DEFAULT 0,
  window_title    TEXT,
  raw_app_name    TEXT,
  canonical_app_id TEXT,
  app_instance_id TEXT,
  capture_source  TEXT    NOT NULL DEFAULT 'foreground_poll',
  ended_reason    TEXT,
  capture_version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_app_sessions_start ON app_sessions (start_time);

CREATE TABLE IF NOT EXISTS focus_sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  start_time   INTEGER NOT NULL,
  end_time     INTEGER,
  duration_sec INTEGER NOT NULL DEFAULT 0,
  label        TEXT,
  target_minutes INTEGER,
  planned_apps TEXT NOT NULL DEFAULT '[]',
  reflection_note TEXT
);

CREATE TABLE IF NOT EXISTS ai_conversations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  messages   TEXT    NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);

-- Normalised AI message storage — appends one row per message instead of
-- rewriting the entire JSON blob on every chat turn.
CREATE TABLE IF NOT EXISTS ai_messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES ai_conversations(id),
  role            TEXT    NOT NULL CHECK(role IN ('user', 'assistant')),
  content         TEXT    NOT NULL,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conv ON ai_messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS distraction_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER REFERENCES focus_sessions(id) ON DELETE SET NULL,
  app_name TEXT NOT NULL,
  bundle_id TEXT NOT NULL,
  triggered_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_distraction_events_session ON distraction_events (session_id, triggered_at);

CREATE TABLE IF NOT EXISTS category_overrides (
  bundle_id TEXT PRIMARY KEY,
  category  TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Website visits from local browser history files (browser.ts service).
-- visit_time_us stores the raw microsecond timestamp from the source browser
-- (Chrome epoch µs for Chromium, Unix epoch µs for Firefox).
-- The UNIQUE constraint uses (browser_bundle_id, visit_time_us, url) so that
-- distinct visits with the same millisecond timestamp are preserved.
CREATE TABLE IF NOT EXISTS website_visits (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  domain            TEXT    NOT NULL,
  page_title        TEXT,
  url               TEXT,
  visit_time        INTEGER NOT NULL,
  visit_time_us     INTEGER NOT NULL DEFAULT 0,
  duration_sec      INTEGER NOT NULL DEFAULT 0,
  browser_bundle_id TEXT,
  canonical_browser_id TEXT,
  browser_profile_id TEXT,
  normalized_url    TEXT,
  page_key          TEXT,
  source            TEXT    NOT NULL DEFAULT 'history',
  UNIQUE (browser_bundle_id, visit_time_us, url)
);

CREATE INDEX IF NOT EXISTS idx_website_visits_time   ON website_visits (visit_time);
CREATE INDEX IF NOT EXISTS idx_website_visits_domain ON website_visits (domain, visit_time);

CREATE TABLE IF NOT EXISTS activity_state_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_ts INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'system',
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_activity_state_events_time ON activity_state_events (event_ts);

CREATE TABLE IF NOT EXISTS work_context_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_ts INTEGER NOT NULL,
  end_ts INTEGER NOT NULL,
  observation TEXT NOT NULL,
  source_block_ids TEXT NOT NULL DEFAULT '[]',
  UNIQUE(start_ts, end_ts)
);

CREATE INDEX IF NOT EXISTS idx_work_context_observations_range ON work_context_observations (start_ts, end_ts);

CREATE TABLE IF NOT EXISTS timeline_blocks (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  block_kind TEXT NOT NULL,
  dominant_category TEXT NOT NULL,
  category_distribution_json TEXT NOT NULL DEFAULT '{}',
  switch_count INTEGER NOT NULL DEFAULT 0,
  label_current TEXT NOT NULL,
  label_source TEXT NOT NULL DEFAULT 'rule',
  label_confidence REAL NOT NULL DEFAULT 0.5,
  narrative_current TEXT,
  evidence_summary_json TEXT NOT NULL DEFAULT '{}',
  is_live INTEGER NOT NULL DEFAULT 0,
  heuristic_version TEXT NOT NULL,
  computed_at INTEGER NOT NULL,
  invalidated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_timeline_blocks_date ON timeline_blocks (date, start_time);
CREATE INDEX IF NOT EXISTS idx_timeline_blocks_valid ON timeline_blocks (date, invalidated_at, start_time);

CREATE TABLE IF NOT EXISTS timeline_block_members (
  block_id TEXT NOT NULL REFERENCES timeline_blocks(id) ON DELETE CASCADE,
  member_type TEXT NOT NULL,
  member_id TEXT NOT NULL,
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  weight_seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (block_id, member_type, member_id)
);

CREATE INDEX IF NOT EXISTS idx_timeline_block_members_member ON timeline_block_members (member_type, member_id);

CREATE TABLE IF NOT EXISTS timeline_block_labels (
  id TEXT PRIMARY KEY,
  block_id TEXT NOT NULL REFERENCES timeline_blocks(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  narrative TEXT,
  source TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  created_at INTEGER NOT NULL,
  model_info_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_timeline_block_labels_block ON timeline_block_labels (block_id, created_at);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  artifact_type TEXT NOT NULL,
  canonical_key TEXT NOT NULL UNIQUE,
  display_title TEXT NOT NULL,
  url TEXT,
  path TEXT,
  host TEXT,
  canonical_app_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artifacts_type ON artifacts (artifact_type, last_seen_at);

CREATE TABLE IF NOT EXISTS artifact_mentions (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  evidence_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_artifact_mentions_source ON artifact_mentions (source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_artifact_mentions_artifact ON artifact_mentions (artifact_id, start_time);

CREATE TABLE IF NOT EXISTS app_profile_cache (
  canonical_app_id TEXT NOT NULL,
  range_key TEXT NOT NULL,
  character_json TEXT NOT NULL DEFAULT '{}',
  top_artifacts_json TEXT NOT NULL DEFAULT '[]',
  paired_apps_json TEXT NOT NULL DEFAULT '[]',
  top_block_ids_json TEXT NOT NULL DEFAULT '[]',
  computed_at INTEGER NOT NULL,
  PRIMARY KEY (canonical_app_id, range_key)
);

CREATE TABLE IF NOT EXISTS workflow_signatures (
  id TEXT PRIMARY KEY,
  signature_key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  dominant_category TEXT NOT NULL,
  canonical_apps_json TEXT NOT NULL DEFAULT '[]',
  artifact_keys_json TEXT NOT NULL DEFAULT '[]',
  rule_version TEXT NOT NULL,
  computed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_occurrences (
  workflow_id TEXT NOT NULL REFERENCES workflow_signatures(id) ON DELETE CASCADE,
  block_id TEXT NOT NULL REFERENCES timeline_blocks(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  PRIMARY KEY (workflow_id, block_id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_occurrences_date ON workflow_occurrences (date, workflow_id);

CREATE TABLE IF NOT EXISTS block_label_overrides (
  block_id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  narrative TEXT,
  updated_at INTEGER NOT NULL
);
`
