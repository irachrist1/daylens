import type Database from 'better-sqlite3'
import type { AIMessageRating } from '@shared/types'

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return rows.some((row) => row.name === column)
}

function normalizeRating(value: unknown): AIMessageRating | null {
  return value === 'up' || value === 'down' ? value : null
}

function parseMetadata(raw: string | null): { rating?: unknown; ratingUpdatedAt?: unknown } {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function ensureAIMessageFeedbackSchema(db: Database.Database): void {
  if (!hasColumn(db, 'ai_messages', 'rating')) {
    db.exec(`ALTER TABLE ai_messages ADD COLUMN rating TEXT CHECK(rating IN ('up', 'down') OR rating IS NULL)`)
  }
  if (!hasColumn(db, 'ai_messages', 'rating_updated_at')) {
    db.exec(`ALTER TABLE ai_messages ADD COLUMN rating_updated_at INTEGER`)
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_ai_messages_rating ON ai_messages (rating, rating_updated_at DESC)`)

  const rows = db.prepare(`
    SELECT id, metadata_json AS metadataJson
    FROM ai_messages
    WHERE rating IS NULL
      AND metadata_json IS NOT NULL
      AND metadata_json != '{}'
  `).all() as { id: number; metadataJson: string | null }[]

  if (rows.length === 0) return

  const update = db.prepare(`
    UPDATE ai_messages
    SET rating = ?, rating_updated_at = ?
    WHERE id = ?
      AND rating IS NULL
  `)

  const tx = db.transaction(() => {
    for (const row of rows) {
      const metadata = parseMetadata(row.metadataJson)
      const rating = normalizeRating(metadata.rating)
      if (!rating) continue
      const updatedAt = typeof metadata.ratingUpdatedAt === 'number' && Number.isFinite(metadata.ratingUpdatedAt)
        ? metadata.ratingUpdatedAt
        : null
      update.run(rating, updatedAt, row.id)
    }
  })

  tx()
}

export function ensureAIThreadSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_threads (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      title           TEXT    NOT NULL DEFAULT 'New chat',
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL,
      last_message_at INTEGER NOT NULL,
      archived        INTEGER NOT NULL DEFAULT 0,
      metadata_json   TEXT    NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_ai_threads_updated ON ai_threads (updated_at DESC);

    CREATE TABLE IF NOT EXISTS ai_artifacts (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id       INTEGER REFERENCES ai_threads(id) ON DELETE CASCADE,
      message_id      INTEGER REFERENCES ai_messages(id) ON DELETE SET NULL,
      kind            TEXT    NOT NULL,
      title           TEXT    NOT NULL,
      summary         TEXT,
      file_path       TEXT,
      inline_content  TEXT,
      mime_type       TEXT    NOT NULL,
      byte_size       INTEGER NOT NULL DEFAULT 0,
      meta_json       TEXT    NOT NULL DEFAULT '{}',
      created_at      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_artifacts_thread ON ai_artifacts (thread_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_artifacts_message ON ai_artifacts (message_id);
  `)

  if (!hasColumn(db, 'ai_messages', 'metadata_json')) {
    db.exec(`ALTER TABLE ai_messages ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'`)
  }
  if (!hasColumn(db, 'ai_messages', 'thread_id')) {
    db.exec(`ALTER TABLE ai_messages ADD COLUMN thread_id INTEGER`)
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_ai_messages_thread ON ai_messages (thread_id, created_at)`)
  ensureAIMessageFeedbackSchema(db)

  const now = Date.now()
  const convs = db
    .prepare(`SELECT DISTINCT conversation_id FROM ai_messages WHERE thread_id IS NULL`)
    .all() as { conversation_id: number }[]

  if (convs.length === 0) return

  const insertThread = db.prepare(`
    INSERT INTO ai_threads (title, created_at, updated_at, last_message_at, archived, metadata_json)
    VALUES (?, ?, ?, ?, 0, ?)
  `)
  const updateMessages = db.prepare(`
    UPDATE ai_messages SET thread_id = ? WHERE conversation_id = ? AND thread_id IS NULL
  `)

  const tx = db.transaction(() => {
    for (const row of convs) {
      const extrema = db
        .prepare(`SELECT MIN(created_at) AS minAt, MAX(created_at) AS maxAt FROM ai_messages WHERE conversation_id = ?`)
        .get(row.conversation_id) as { minAt: number | null; maxAt: number | null } | undefined
      const createdAt = extrema?.minAt ?? now
      const lastAt = extrema?.maxAt ?? createdAt
      const result = insertThread.run(
        'Imported chat',
        createdAt,
        lastAt,
        lastAt,
        JSON.stringify({ legacyConversationId: row.conversation_id, backfilled: true }),
      )
      updateMessages.run(result.lastInsertRowid as number, row.conversation_id)
    }
  })

  tx()
}
