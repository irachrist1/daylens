import { getDb } from '../services/database'
import { normalizeUrlForStorage, pageKeyForUrl, resolveCanonicalApp, resolveCanonicalBrowser } from '../lib/appIdentity'

/**
 * Versioned migration system for DaylensWindows.
 *
 * Each migration is a function that runs SQL statements.
 * Migrations are additive-only — never delete columns or tables.
 * Applied versions are tracked in a schema_version table.
 */

interface Migration {
  version: number
  description: string
  up: () => void
}

function hasColumn(table: string, column: string): boolean {
  const db = getDb()
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return rows.some((row) => row.name === column)
}

function getTableSql(table: string): string | null {
  const db = getDb()
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table) as { sql: string | null } | undefined
  return row?.sql ?? null
}

function ensureAppSessionIdentityColumns(): void {
  const db = getDb()

  if (!hasColumn('app_sessions', 'raw_app_name')) {
    db.exec(`ALTER TABLE app_sessions ADD COLUMN raw_app_name TEXT`)
  }
  if (!hasColumn('app_sessions', 'canonical_app_id')) {
    db.exec(`ALTER TABLE app_sessions ADD COLUMN canonical_app_id TEXT`)
  }
  if (!hasColumn('app_sessions', 'app_instance_id')) {
    db.exec(`ALTER TABLE app_sessions ADD COLUMN app_instance_id TEXT`)
  }
}

function ensureWebsiteVisitIdentityColumns(): void {
  const db = getDb()

  if (!hasColumn('website_visits', 'canonical_browser_id')) {
    db.exec(`ALTER TABLE website_visits ADD COLUMN canonical_browser_id TEXT`)
  }
  if (!hasColumn('website_visits', 'browser_profile_id')) {
    db.exec(`ALTER TABLE website_visits ADD COLUMN browser_profile_id TEXT`)
  }
  if (!hasColumn('website_visits', 'normalized_url')) {
    db.exec(`ALTER TABLE website_visits ADD COLUMN normalized_url TEXT`)
  }
  if (!hasColumn('website_visits', 'page_key')) {
    db.exec(`ALTER TABLE website_visits ADD COLUMN page_key TEXT`)
  }
}

const migrations: Migration[] = [
  {
    version: 1,
    description: 'Baseline schema — matches initial CREATE TABLE IF NOT EXISTS',
    up: () => {
      // Baseline: tables already created by SCHEMA_SQL.
      // This migration just records that v1 is applied.
    },
  },
  {
    version: 2,
    description: 'Add daily_summaries table',
    up: () => {
      const db = getDb()
      db.exec(`
        CREATE TABLE IF NOT EXISTS daily_summaries (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          date              TEXT    NOT NULL UNIQUE,
          total_active_sec  INTEGER NOT NULL DEFAULT 0,
          focus_sec         INTEGER NOT NULL DEFAULT 0,
          app_count         INTEGER NOT NULL DEFAULT 0,
          domain_count      INTEGER NOT NULL DEFAULT 0,
          session_count     INTEGER NOT NULL DEFAULT 0,
          context_switches  INTEGER NOT NULL DEFAULT 0,
          focus_score       INTEGER NOT NULL DEFAULT 0,
          top_app_bundle_id TEXT,
          top_domain        TEXT,
          ai_summary        TEXT,
          computed_at       INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_daily_summaries_date ON daily_summaries (date);
      `)
    },
  },
  {
    version: 3,
    description: 'Deduplicate app_sessions and add unique index for idempotent inserts',
    up: () => {
      const db = getDb()
      // Remove any exact duplicates (same bundle_id + start_time) keeping the lowest rowid
      db.exec(`
        DELETE FROM app_sessions
        WHERE rowid NOT IN (
          SELECT MIN(rowid) FROM app_sessions GROUP BY bundle_id, start_time
        )
      `)
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_app_sessions_dedup
        ON app_sessions (bundle_id, start_time)
      `)
    },
  },
  {
    version: 4,
    description: 'Recompute daily summaries after tracking fixes',
    up: () => {
      const db = getDb()
      db.exec('DELETE FROM daily_summaries')
    },
  },
  {
    version: 5,
    description: 'Add visit_time_us column and richer UNIQUE constraint to website_visits',
    up: () => {
      const db = getDb()
      const hasVisitTimeUs = hasColumn('website_visits', 'visit_time_us')
      const websiteVisitsSql = getTableSql('website_visits') ?? ''
      const hasCorrectUniqueConstraint = /UNIQUE\s*\(\s*browser_bundle_id\s*,\s*visit_time_us\s*,\s*url\s*\)/i.test(
        websiteVisitsSql
      )

      // Fresh installs already get the correct v5 shape from SCHEMA_SQL.
      if (hasVisitTimeUs && hasCorrectUniqueConstraint) return

      if (!hasVisitTimeUs) {
        // Add visit_time_us column (microsecond timestamp from source browser)
        db.exec(`ALTER TABLE website_visits ADD COLUMN visit_time_us INTEGER NOT NULL DEFAULT 0`)
      }

      // Drop the old (browser_bundle_id, visit_time) unique constraint by recreating the table.
      // SQLite does not support DROP CONSTRAINT — we rename, copy, drop old, create index.
      db.exec(`
        DROP TABLE IF EXISTS website_visits_new;
        CREATE TABLE website_visits_new (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          domain            TEXT    NOT NULL,
          page_title        TEXT,
          url               TEXT,
          visit_time        INTEGER NOT NULL,
          visit_time_us     INTEGER NOT NULL DEFAULT 0,
          duration_sec      INTEGER NOT NULL DEFAULT 0,
          browser_bundle_id TEXT,
          source            TEXT    NOT NULL DEFAULT 'history',
          UNIQUE (browser_bundle_id, visit_time_us, url)
        );
        INSERT OR IGNORE INTO website_visits_new
          (id, domain, page_title, url, visit_time, visit_time_us, duration_sec, browser_bundle_id, source)
        SELECT
          id,
          domain,
          page_title,
          url,
          visit_time,
          CASE
            WHEN visit_time_us IS NOT NULL AND visit_time_us != 0 THEN visit_time_us
            ELSE visit_time * 1000
          END,
          duration_sec,
          browser_bundle_id,
          source
        FROM website_visits;
        DROP TABLE website_visits;
        ALTER TABLE website_visits_new RENAME TO website_visits;
        CREATE INDEX IF NOT EXISTS idx_website_visits_time   ON website_visits (visit_time);
        CREATE INDEX IF NOT EXISTS idx_website_visits_domain ON website_visits (domain, visit_time);
      `)
    },
  },
  {
    version: 6,
    description: 'Add ai_messages table for normalised AI conversation storage',
    up: () => {
      const db = getDb()
      db.exec(`
        CREATE TABLE IF NOT EXISTS ai_messages (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id INTEGER NOT NULL REFERENCES ai_conversations(id),
          role            TEXT    NOT NULL CHECK(role IN ('user', 'assistant')),
          content         TEXT    NOT NULL,
          created_at      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ai_messages_conv ON ai_messages (conversation_id, created_at);
      `)
      // Migrate existing messages from the JSON blob into ai_messages rows
      const rows = db
        .prepare('SELECT id, messages FROM ai_conversations')
        .all() as { id: number; messages: string }[]
      const insert = db.prepare(
        'INSERT INTO ai_messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)'
      )
      const migrate = db.transaction(() => {
        for (const conv of rows) {
          try {
            const msgs = JSON.parse(conv.messages) as { role: string; content: string; timestamp?: number }[]
            let ts = Date.now()
            for (const msg of msgs) {
              insert.run(conv.id, msg.role, msg.content, msg.timestamp ?? ts++)
            }
          } catch { /* skip malformed blobs */ }
        }
      })
      migrate()
    },
  },
  {
    version: 7,
    description: 'Add focus session targets and planned apps metadata',
    up: () => {
      const db = getDb()
      if (!hasColumn('focus_sessions', 'target_minutes')) {
        db.exec(`ALTER TABLE focus_sessions ADD COLUMN target_minutes INTEGER`)
      }
      if (!hasColumn('focus_sessions', 'planned_apps')) {
        db.exec(`ALTER TABLE focus_sessions ADD COLUMN planned_apps TEXT NOT NULL DEFAULT '[]'`)
      }
    },
  },
  {
    version: 8,
    description: 'Add focus reflections, distraction events, and work context observations',
    up: () => {
      const db = getDb()
      if (!hasColumn('focus_sessions', 'reflection_note')) {
        db.exec(`ALTER TABLE focus_sessions ADD COLUMN reflection_note TEXT`)
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS distraction_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id INTEGER REFERENCES focus_sessions(id) ON DELETE SET NULL,
          app_name TEXT NOT NULL,
          bundle_id TEXT NOT NULL,
          triggered_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_distraction_events_session
          ON distraction_events (session_id, triggered_at);

        CREATE TABLE IF NOT EXISTS work_context_observations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          start_ts INTEGER NOT NULL,
          end_ts INTEGER NOT NULL,
          observation TEXT NOT NULL,
          source_block_ids TEXT NOT NULL DEFAULT '[]',
          UNIQUE(start_ts, end_ts)
        );
        CREATE INDEX IF NOT EXISTS idx_work_context_observations_range
          ON work_context_observations (start_ts, end_ts);
      `)
    },
  },
  {
    version: 9,
    description: 'Add raw capture identity columns and activity/browser normalization tables',
    up: () => {
      const db = getDb()
      if (!hasColumn('app_sessions', 'window_title')) {
        db.exec(`ALTER TABLE app_sessions ADD COLUMN window_title TEXT`)
      }
      ensureAppSessionIdentityColumns()
      if (!hasColumn('app_sessions', 'capture_source')) {
        db.exec(`ALTER TABLE app_sessions ADD COLUMN capture_source TEXT NOT NULL DEFAULT 'foreground_poll'`)
      }
      if (!hasColumn('app_sessions', 'ended_reason')) {
        db.exec(`ALTER TABLE app_sessions ADD COLUMN ended_reason TEXT`)
      }
      if (!hasColumn('app_sessions', 'capture_version')) {
        db.exec(`ALTER TABLE app_sessions ADD COLUMN capture_version INTEGER NOT NULL DEFAULT 1`)
      }

      ensureWebsiteVisitIdentityColumns()

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_app_sessions_canonical_app
          ON app_sessions (canonical_app_id, start_time);
        CREATE INDEX IF NOT EXISTS idx_website_visits_browser
          ON website_visits (canonical_browser_id, visit_time);
        CREATE INDEX IF NOT EXISTS idx_website_visits_page_key
          ON website_visits (page_key, visit_time);

        CREATE TABLE IF NOT EXISTS activity_state_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_ts INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT 'system',
          metadata_json TEXT NOT NULL DEFAULT '{}'
        );
        CREATE INDEX IF NOT EXISTS idx_activity_state_events_time
          ON activity_state_events (event_ts);
      `)
    },
  },
  {
    version: 10,
    description: 'Add persisted timeline, artifacts, workflows, caches, and block label overrides',
    up: () => {
      const db = getDb()
      db.exec(`
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
        CREATE INDEX IF NOT EXISTS idx_timeline_blocks_date
          ON timeline_blocks (date, start_time);
        CREATE INDEX IF NOT EXISTS idx_timeline_blocks_valid
          ON timeline_blocks (date, invalidated_at, start_time);

        CREATE TABLE IF NOT EXISTS timeline_block_members (
          block_id TEXT NOT NULL REFERENCES timeline_blocks(id) ON DELETE CASCADE,
          member_type TEXT NOT NULL,
          member_id TEXT NOT NULL,
          start_time INTEGER NOT NULL,
          end_time INTEGER NOT NULL,
          weight_seconds INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (block_id, member_type, member_id)
        );
        CREATE INDEX IF NOT EXISTS idx_timeline_block_members_member
          ON timeline_block_members (member_type, member_id);

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
        CREATE INDEX IF NOT EXISTS idx_timeline_block_labels_block
          ON timeline_block_labels (block_id, created_at);

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
        CREATE INDEX IF NOT EXISTS idx_artifacts_type
          ON artifacts (artifact_type, last_seen_at);

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
        CREATE INDEX IF NOT EXISTS idx_artifact_mentions_source
          ON artifact_mentions (source_type, source_id);
        CREATE INDEX IF NOT EXISTS idx_artifact_mentions_artifact
          ON artifact_mentions (artifact_id, start_time);

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
        CREATE INDEX IF NOT EXISTS idx_workflow_occurrences_date
          ON workflow_occurrences (date, workflow_id);

        CREATE TABLE IF NOT EXISTS block_label_overrides (
          block_id TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          narrative TEXT,
          updated_at INTEGER NOT NULL
        );
      `)
    },
  },
  {
    version: 11,
    description: 'Backfill canonical app/browser identity and normalized page keys',
    up: () => {
      const db = getDb()

      // Some older local databases report earlier versions as applied but still
      // lack the identity columns. Repair those schemas before backfilling.
      ensureAppSessionIdentityColumns()
      ensureWebsiteVisitIdentityColumns()

      const sessionRows = db.prepare(`
        SELECT id, bundle_id, app_name
        FROM app_sessions
        WHERE canonical_app_id IS NULL OR app_instance_id IS NULL OR raw_app_name IS NULL
      `).all() as { id: number; bundle_id: string; app_name: string }[]

      const updateSession = db.prepare(`
        UPDATE app_sessions
        SET raw_app_name = ?,
            canonical_app_id = ?,
            app_instance_id = ?
        WHERE id = ?
      `)

      for (const row of sessionRows) {
        const identity = resolveCanonicalApp(row.bundle_id, row.app_name)
        updateSession.run(identity.rawAppName, identity.canonicalAppId, identity.appInstanceId, row.id)
      }

      const visitRows = db.prepare(`
        SELECT id, browser_bundle_id, url
        FROM website_visits
        WHERE canonical_browser_id IS NULL OR browser_profile_id IS NULL OR normalized_url IS NULL OR page_key IS NULL
      `).all() as { id: number; browser_bundle_id: string | null; url: string | null }[]

      const updateVisit = db.prepare(`
        UPDATE website_visits
        SET canonical_browser_id = ?,
            browser_profile_id = ?,
            normalized_url = ?,
            page_key = ?
        WHERE id = ?
      `)

      for (const row of visitRows) {
        const browserIdentity = resolveCanonicalBrowser(row.browser_bundle_id)
        updateVisit.run(
          browserIdentity.canonicalBrowserId,
          browserIdentity.browserProfileId,
          normalizeUrlForStorage(row.url),
          pageKeyForUrl(row.url),
          row.id,
        )
      }
    },
  },
  {
    version: 12,
    description: 'Clear workflow signatures so labels regenerate with display names',
    up: () => {
      const db = getDb()
      db.exec('DELETE FROM workflow_occurrences')
      db.exec('DELETE FROM workflow_signatures')
    },
  },
]

export function runMigrations(): void {
  const db = getDb()

  // Ensure schema_version table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `)

  // Get current version
  const row = db.prepare('SELECT MAX(version) as v FROM schema_version').get() as
    | { v: number | null }
    | undefined
  const currentVersion = row?.v ?? 0

  // Apply pending migrations
  const pending = migrations.filter((m) => m.version > currentVersion)
  if (pending.length === 0) {
    console.log('[migrations] schema up to date at v' + currentVersion)
    return
  }

  for (const migration of pending) {
    console.log(`[migrations] applying v${migration.version}: ${migration.description}`)
    const tx = db.transaction(() => {
      migration.up()
      db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
        migration.version,
        Date.now()
      )
    })
    tx()
  }

  console.log(`[migrations] migrated to v${pending[pending.length - 1].version}`)
}
