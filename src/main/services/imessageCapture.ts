// iMessage capture — optional, macOS-only, opt-in.
//
// Reads ~/Library/Messages/chat.db (plain SQLite, no auth) and mirrors the
// minimum fields Daylens needs to answer "what did I message X about today"
// into our own `imessage_events` table. Never touches chat.db with a write.
//
// Permission model:
// - Apple requires Full Disk Access (System Settings → Privacy & Security →
//   Full Disk Access) for any non-Messages.app process to read chat.db.
// - Without that permission, the read fails with a permission error; the
//   service surfaces the error and does not retry every tick.
//
// Privacy is not the constraint here (per docs/AI-PRODUCT-DIRECTION.md D6):
// speed and usefulness are. The setting is OFF by default; turning it on is
// an explicit signal that the user wants Daylens to know what's in their
// messages.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { getDb } from './database'

const APPLE_EPOCH_OFFSET_MS = Date.UTC(2001, 0, 1)

interface MessageRow {
  ROWID: number
  guid_chat: string | null
  display_name: string | null
  handle_id: string | null
  is_from_me: number
  text: string | null
  date: number
}

export interface ImessageSyncResult {
  ok: boolean
  inserted: number
  lastSentAt: number | null
  error?: string
}

function chatDbPath(): string {
  return path.join(os.homedir(), 'Library', 'Messages', 'chat.db')
}

export function imessageCaptureSupportedOnPlatform(): boolean {
  return process.platform === 'darwin'
}

function lastSyncedAt(): number {
  const db = getDb()
  const row = db.prepare('SELECT MAX(sent_at) as t FROM imessage_events').get() as { t: number | null } | undefined
  return row?.t ?? 0
}

// Apple stores `date` as nanoseconds-since-2001 in newer macOS versions and as
// seconds-since-2001 in older ones. Detect by magnitude: any plausible
// nanosecond value is > 10^17.
function appleDateToMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return value > 1_000_000_000_000_000
    ? Math.round(value / 1_000_000) + APPLE_EPOCH_OFFSET_MS
    : value * 1_000 + APPLE_EPOCH_OFFSET_MS
}

let pollTimer: ReturnType<typeof setInterval> | null = null
const POLL_MS = 5 * 60_000

export function startImessageCaptureScheduler(): void {
  if (!imessageCaptureSupportedOnPlatform()) return
  if (pollTimer) return
  // Immediate first sync, then periodic. Errors are swallowed by syncImessageCapture
  // (returns ok:false) so a missing-permission state never crashes the scheduler.
  void syncImessageCapture()
  pollTimer = setInterval(() => { void syncImessageCapture() }, POLL_MS)
}

export function stopImessageCaptureScheduler(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

export function syncImessageCapture(): ImessageSyncResult {
  if (!imessageCaptureSupportedOnPlatform()) {
    return { ok: false, inserted: 0, lastSentAt: null, error: 'iMessage capture is macOS-only.' }
  }

  const dbPath = chatDbPath()
  if (!fs.existsSync(dbPath)) {
    return { ok: false, inserted: 0, lastSentAt: null, error: `chat.db not found at ${dbPath}` }
  }

  let source: Database.Database | null = null
  try {
    source = new Database(dbPath, { readonly: true, fileMustExist: true })
  } catch (error) {
    return {
      ok: false,
      inserted: 0,
      lastSentAt: null,
      error: `Could not open chat.db (likely missing Full Disk Access): ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  try {
    const since = lastSyncedAt()
    const sinceAppleSec = since > 0 ? Math.max(0, (since - APPLE_EPOCH_OFFSET_MS) / 1000) : 0

    const rows = source.prepare(`
      SELECT
        m.ROWID                AS ROWID,
        c.guid                 AS guid_chat,
        c.display_name         AS display_name,
        h.id                   AS handle_id,
        m.is_from_me           AS is_from_me,
        m.text                 AS text,
        m.date                 AS date
      FROM message m
      LEFT JOIN handle h ON h.ROWID = m.handle_id
      LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
      LEFT JOIN chat c ON c.ROWID = cmj.chat_id
      WHERE m.date / 1000000000 > ?
      ORDER BY m.date ASC
    `).all(sinceAppleSec) as MessageRow[]

    const target = getDb()
    const insert = target.prepare(`
      INSERT OR IGNORE INTO imessage_events
        (rowid, chat_guid, chat_label, handle_id, is_from_me, text, sent_at, captured_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    let inserted = 0
    let lastSentAt: number | null = null
    const capturedAt = Date.now()

    const tx = target.transaction(() => {
      for (const row of rows) {
        const sentAt = appleDateToMs(row.date)
        if (sentAt <= since) continue
        const result = insert.run(
          row.ROWID,
          row.guid_chat,
          row.display_name,
          row.handle_id,
          row.is_from_me ? 1 : 0,
          row.text,
          sentAt,
          capturedAt,
        )
        if (result.changes > 0) {
          inserted += 1
          if (lastSentAt === null || sentAt > lastSentAt) lastSentAt = sentAt
        }
      }
    })
    tx()

    return { ok: true, inserted, lastSentAt }
  } catch (error) {
    return {
      ok: false,
      inserted: 0,
      lastSentAt: null,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    try { source?.close() } catch { /* noop */ }
  }
}
