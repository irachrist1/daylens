import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import { ensureSearchSchema } from '../src/main/db/migrations.ts'
import {
  searchArtifacts,
  searchBlocks,
  searchBrowser,
  searchSessions,
} from '../src/main/db/queries.ts'

function localMs(year: number, month: number, day: number, hour: number, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

function setupDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  ensureSearchSchema(db)
  return db
}

function insertSession(db: Database.Database, overrides: {
  appName?: string
  windowTitle?: string | null
  startTime?: number
  durationSec?: number
} = {}): number {
  const startTime = overrides.startTime ?? localMs(2026, 4, 24, 9)
  const durationSec = overrides.durationSec ?? 1800
  const result = db.prepare(`
    INSERT INTO app_sessions (
      bundle_id,
      app_name,
      start_time,
      end_time,
      duration_sec,
      category,
      is_focused,
      window_title,
      raw_app_name,
      capture_source,
      capture_version
    ) VALUES (?, ?, ?, ?, ?, 'design', 1, ?, ?, 'test', 1)
  `).run(
    'com.figma.Desktop',
    overrides.appName ?? 'Figma',
    startTime,
    startTime + durationSec * 1000,
    durationSec,
    overrides.windowTitle ?? 'Figma - Daylens recall board',
    overrides.appName ?? 'Figma',
  )
  return result.lastInsertRowid as number
}

function insertBlock(db: Database.Database, id: string, label: string, startTime: number): void {
  db.prepare(`
    INSERT INTO timeline_blocks (
      id,
      date,
      start_time,
      end_time,
      block_kind,
      dominant_category,
      category_distribution_json,
      switch_count,
      label_current,
      label_source,
      label_confidence,
      narrative_current,
      evidence_summary_json,
      is_live,
      heuristic_version,
      computed_at,
      invalidated_at
    ) VALUES (?, ?, ?, ?, 'work', 'design', '{}', 0, ?, 'rule', 0.8, NULL, '{}', 0, 'test', ?, NULL)
  `).run(id, '2026-04-24', startTime, startTime + 1800_000, label, startTime)
}

function insertVisit(db: Database.Database, title: string, visitTime: number): void {
  db.prepare(`
    INSERT INTO website_visits (domain, page_title, url, visit_time, visit_time_us, duration_sec, browser_bundle_id)
    VALUES ('figma.com', ?, 'https://figma.com/file/daylens', ?, ?, 120, 'com.google.Chrome')
  `).run(title, visitTime, visitTime * 1000)
}

function insertArtifact(db: Database.Database, title: string, content: string, createdAt: number): void {
  db.prepare(`
    INSERT INTO ai_artifacts (kind, title, summary, file_path, inline_content, mime_type, byte_size, meta_json, created_at)
    VALUES ('report', ?, NULL, NULL, ?, 'text/markdown', ?, '{}', ?)
  `).run(title, content, Buffer.byteLength(content), createdAt)
}

test('searchSessions returns newly inserted app sessions with highlighted excerpts', () => {
  const db = setupDb()
  insertSession(db)

  const results = searchSessions(db, 'Figma', { limit: 5 })

  assert.equal(results.length, 1)
  assert.equal(results[0].appName, 'Figma')
  assert.match(results[0].excerpt, /\[\[mark\]\]Figma\[\[\/mark\]\]/)
  db.close()
})

test('searchSessions reflects app session title updates', () => {
  const db = setupDb()
  const id = insertSession(db, { windowTitle: 'Figma - Old board' })
  db.prepare(`UPDATE app_sessions SET window_title = 'Figma - Invoice redesign' WHERE id = ?`).run(id)

  assert.equal(searchSessions(db, 'Invoice').length, 1)
  assert.equal(searchSessions(db, 'Old').length, 0)
  db.close()
})

test('searchSessions removes deleted app sessions from the index', () => {
  const db = setupDb()
  const id = insertSession(db, { windowTitle: 'Figma - Delete me' })
  db.prepare(`DELETE FROM app_sessions WHERE id = ?`).run(id)

  assert.equal(searchSessions(db, 'Delete').length, 0)
  db.close()
})

test('searchBrowser applies date filters against base visit timestamps', () => {
  const db = setupDb()
  insertVisit(db, 'Figma design handoff', localMs(2026, 4, 23, 10))
  insertVisit(db, 'Figma launch board', localMs(2026, 4, 24, 11))

  const results = searchBrowser(db, 'Figma', {
    startDate: '2026-04-24',
    endDate: '2026-04-24',
  })

  assert.equal(results.length, 1)
  assert.equal(results[0].pageTitle, 'Figma launch board')
  db.close()
})

test('each search function queries real SQLite FTS tables', () => {
  const db = setupDb()
  const startTime = localMs(2026, 4, 24, 13)
  insertSession(db, { windowTitle: 'Figma - Search function coverage', startTime })
  insertBlock(db, 'block-search', 'Figma prototype review', startTime + 60_000)
  insertVisit(db, 'Figma browser result', startTime + 120_000)
  insertArtifact(db, 'Figma artifact report', 'Inline notes about the Figma prototype.', startTime + 180_000)

  assert.equal(searchSessions(db, 'coverage').length, 1)
  assert.equal(searchBlocks(db, 'prototype').length, 1)
  assert.equal(searchBrowser(db, 'browser').length, 1)
  assert.equal(searchArtifacts(db, 'Inline').length, 1)
  db.close()
})
