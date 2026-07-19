// DEV-220: pre-update backup restores must not resurrect deleted data. Every
// user-initiated destructive deletion appends to a durable journal that lives
// inside the backup root (so a restore never overwrites it and a backup never
// captures it), and both restore paths replay the journal against the
// restored database.

import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  BACKUP_ROOT_DIRNAME,
  DELETION_JOURNAL_FILENAME,
  appendDeletionJournalEntry,
  deletionJournalPath,
  parseBackupDirTimestampMs,
  pruneDeletionJournalOlderThan,
  readDeletionJournal,
  replayDeletionJournal,
  selectBackupSourceEntries,
} from '../src/main/services/deletionJournal.ts'
import { deleteHistoryForSite } from '../src/main/services/trackingHistory.ts'
import { bootstrapProductionTestDatabase } from './support/testDatabase.ts'
import { clearTestDb, setTestDb } from './support/database-stub.mjs'

function makeTempUserData(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-deletion-journal-'))
}

const SEED_START = new Date(2026, 5, 18, 10, 0, 0, 0).getTime()

// Same shape as the trackingExclusionsHistory seed: one browser app session,
// one focus event, and one website visit for private.example.com.
function seed(db: Database.Database): void {
  db.prepare(`
    INSERT INTO app_sessions (
      bundle_id, app_name, start_time, end_time, duration_sec, category,
      is_focused, window_title, raw_app_name, capture_source, capture_version
    ) VALUES ('app.zen-browser.zen', 'Zen', ?, ?, 1200, 'browsing', 0, 'Deep work', 'Zen', 'test', 2)
  `).run(SEED_START, SEED_START + 20 * 60_000)
  db.prepare(`
    INSERT INTO focus_events (
      ts_ms, mono_ns, event_type, app_bundle_id, app_name, pid,
      window_title, url, page_title, source, confidence, platform, schema_ver
    ) VALUES (?, ?, 'tab_changed', 'app.zen-browser.zen', 'Zen', 42, 'Deep work',
      'https://private.example.com/plan', 'Confidential plan', 'apple_events_tab', 'observed', 'darwin', 2)
  `).run(SEED_START, SEED_START)
  db.prepare(`
    INSERT INTO website_visits (
      domain, page_title, url, normalized_url, page_key,
      visit_time, visit_time_us, duration_sec, browser_bundle_id,
      canonical_browser_id, browser_profile_id, source
    ) VALUES ('private.example.com', 'Confidential plan', 'https://private.example.com/plan',
      'https://private.example.com/plan', 'https://private.example.com/plan',
      ?, ?, 1200, 'app.zen-browser.zen:default', 'app.zen-browser.zen', 'default', 'test')
  `).run(SEED_START, BigInt(SEED_START) * 1_000n)
}

function createSeededDatabaseFile(dbPath: string): void {
  const db = bootstrapProductionTestDatabase(new Database(dbPath))
  seed(db)
  db.close()
}

function count(db: Database.Database, sql: string, ...params: unknown[]): number {
  return (db.prepare(sql).get(...params) as { count: number }).count
}

test('journal entries roundtrip through append and read', () => {
  const userData = makeTempUserData()

  assert.ok(appendDeletionJournalEntry(userData, {
    kind: 'site-history',
    params: { domain: 'private.example.com' },
  }, 1_000))
  assert.ok(appendDeletionJournalEntry(userData, {
    kind: 'purge-block',
    params: { fromMs: 10, toMs: 20 },
  }, 2_000))

  const entries = readDeletionJournal(userData)
  assert.deepEqual(entries, [
    { kind: 'site-history', recordedAtMs: 1_000, params: { domain: 'private.example.com' } },
    { kind: 'purge-block', recordedAtMs: 2_000, params: { fromMs: 10, toMs: 20 } },
  ])

  // The journal lives inside the backup root — the one directory both restore
  // paths skip when copying back, so a restore can never roll the journal back.
  assert.equal(
    deletionJournalPath(userData),
    path.join(userData, BACKUP_ROOT_DIRNAME, DELETION_JOURNAL_FILENAME),
  )
})

test('reading tolerates corrupt, foreign, and torn journal lines', () => {
  const userData = makeTempUserData()
  const journalPath = deletionJournalPath(userData)
  fs.mkdirSync(path.dirname(journalPath), { recursive: true })
  fs.writeFileSync(journalPath, [
    '{"kind":"site-history","recordedAtMs":1000,"params":{"domain":"private.example.com"}}',
    'not json at all',
    '{"kind":"unknown-kind","recordedAtMs":2000,"params":{}}',
    '{"kind":"app-history","params":{"appName":"Zen"}}',
    '{"kind":"purge-block","recordedAtMs":3000,"params":{"fromMs":1,"to',
    '',
  ].join('\n'), 'utf8')

  assert.deepEqual(readDeletionJournal(userData), [
    { kind: 'site-history', recordedAtMs: 1_000, params: { domain: 'private.example.com' } },
  ])
})

test('pruning drops only entries older than the cutoff', () => {
  const userData = makeTempUserData()
  appendDeletionJournalEntry(userData, { kind: 'site-history', params: { domain: 'a.example' } }, 1_000)
  appendDeletionJournalEntry(userData, { kind: 'site-history', params: { domain: 'b.example' } }, 2_000)
  appendDeletionJournalEntry(userData, { kind: 'site-history', params: { domain: 'c.example' } }, 3_000)

  assert.equal(pruneDeletionJournalOlderThan(userData, 2_000), 1)
  assert.deepEqual(
    readDeletionJournal(userData).map((entry) => entry.recordedAtMs),
    [2_000, 3_000],
  )

  // Idempotent: a second prune with the same cutoff removes nothing.
  assert.equal(pruneDeletionJournalOlderThan(userData, 2_000), 0)
})

test('the backup copy never captures the journal, and rotation never deletes it', () => {
  // backupUserDataForUpdate copies exactly the entries this helper selects:
  // the backup root (which contains the journal) must be excluded.
  assert.deepEqual(
    selectBackupSourceEntries(['config.json', 'daylens.sqlite', BACKUP_ROOT_DIRNAME, 'artifacts']),
    ['config.json', 'daylens.sqlite', 'artifacts'],
  )

  // Backup rotation only considers entries that parse as backup timestamps,
  // so the journal file sitting next to the backup dirs is never rotated away.
  assert.equal(
    parseBackupDirTimestampMs('2026-07-18T00-30-15-250Z'),
    Date.parse('2026-07-18T00:30:15.250Z'),
  )
  assert.equal(parseBackupDirTimestampMs(DELETION_JOURNAL_FILENAME), null)
  assert.equal(parseBackupDirTimestampMs('backup-manifest.json'), null)
})

// THE regression this ticket exists for: delete a record, restore a
// pre-update backup taken before the deletion, and the deleted data must not
// come back.
test('restoring a pre-update backup replays a journaled site deletion instead of resurrecting it', () => {
  const userData = makeTempUserData()
  const dbPath = path.join(userData, 'daylens.sqlite')
  createSeededDatabaseFile(dbPath)

  // Simulate backupUserDataForUpdate capturing the database pre-deletion.
  const backupDir = path.join(userData, BACKUP_ROOT_DIRNAME, '2026-07-18T00-00-00-000Z')
  fs.mkdirSync(backupDir, { recursive: true })
  fs.copyFileSync(dbPath, path.join(backupDir, 'daylens.sqlite'))

  // Delete the site's history through the real deletion function, journaling
  // it the same way the IPC handler does.
  const live = new Database(dbPath)
  setTestDb(live)
  try {
    const result = deleteHistoryForSite({ domain: 'example.com' })
    assert.ok(result.deletedRows >= 2)
    assert.equal(count(live, 'SELECT COUNT(*) AS count FROM website_visits'), 0)
  } finally {
    clearTestDb()
    live.close()
  }
  assert.ok(appendDeletionJournalEntry(userData, {
    kind: 'site-history',
    params: { domain: 'example.com' },
  }))

  // Simulate the blank-state restore copying the backup database back.
  fs.copyFileSync(path.join(backupDir, 'daylens.sqlite'), dbPath)

  const restored = new Database(dbPath)
  try {
    // The restore alone resurrects the deleted domain — the defect.
    assert.ok(count(restored, `SELECT COUNT(*) AS count FROM website_visits WHERE lower(domain) LIKE '%example.com'`) >= 1)

    const outcome = replayDeletionJournal(restored, userData)
    assert.ok(outcome.replayed >= 1)
    assert.equal(outcome.failed, 0)

    // Same assertions the exclusion purge test makes: URL evidence gone,
    // unrelated app session intact.
    assert.equal(count(restored, 'SELECT COUNT(*) AS count FROM website_visits'), 0)
    assert.equal(count(restored, 'SELECT COUNT(*) AS count FROM focus_events'), 0)
    assert.equal(count(restored, 'SELECT COUNT(*) AS count FROM app_sessions'), 1)
    assert.equal(count(restored, `
      SELECT COUNT(*) AS count FROM website_visits_fts WHERE website_visits_fts MATCH '"Confidential plan"'
    `), 0)
  } finally {
    restored.close()
  }
})

test('restoring a pre-update backup replays a journaled block purge', () => {
  const userData = makeTempUserData()
  const dbPath = path.join(userData, 'daylens.sqlite')
  createSeededDatabaseFile(dbPath)

  const backupDir = path.join(userData, BACKUP_ROOT_DIRNAME, '2026-07-18T00-00-00-000Z')
  fs.mkdirSync(backupDir, { recursive: true })
  fs.copyFileSync(dbPath, path.join(backupDir, 'daylens.sqlite'))

  // The span the purged block covered — everything seeded falls inside it.
  const fromMs = SEED_START - 60_000
  const toMs = SEED_START + 30 * 60_000
  appendDeletionJournalEntry(userData, { kind: 'purge-block', params: { fromMs, toMs } })

  fs.copyFileSync(path.join(backupDir, 'daylens.sqlite'), dbPath)

  const restored = new Database(dbPath)
  try {
    assert.ok(count(restored, 'SELECT COUNT(*) AS count FROM app_sessions WHERE start_time >= ? AND start_time < ?', fromMs, toMs) >= 1)

    const outcome = replayDeletionJournal(restored, userData)
    assert.equal(outcome.failed, 0)
    assert.equal(outcome.replayed, 1)

    assert.equal(count(restored, 'SELECT COUNT(*) AS count FROM app_sessions WHERE start_time >= ? AND start_time < ?', fromMs, toMs), 0)
    assert.equal(count(restored, 'SELECT COUNT(*) AS count FROM website_visits WHERE visit_time >= ? AND visit_time < ?', fromMs, toMs), 0)
    assert.equal(count(restored, 'SELECT COUNT(*) AS count FROM focus_events WHERE ts_ms >= ? AND ts_ms < ?', fromMs, toMs), 0)
  } finally {
    restored.close()
  }
})

test('replay is idempotent and a bad entry never aborts the rest', () => {
  const userData = makeTempUserData()
  const dbPath = path.join(userData, 'daylens.sqlite')
  createSeededDatabaseFile(dbPath)

  // A purge-block entry pointing at a table that exists, plus a poisoned
  // tracked-activity entry (params of the wrong shape survive parsing but
  // fail replay-side validation gracefully as a no-op or error).
  const journalPath = deletionJournalPath(userData)
  fs.mkdirSync(path.dirname(journalPath), { recursive: true })
  fs.writeFileSync(journalPath, [
    // Malformed params: domain must be a string, this replays as a no-op or fails alone.
    '{"kind":"site-history","recordedAtMs":1000,"params":{"domain":{"nested":"junk"}}}',
    `{"kind":"purge-block","recordedAtMs":2000,"params":{"fromMs":${SEED_START - 60_000},"toMs":${SEED_START + 30 * 60_000}}}`,
    '',
  ].join('\n'), 'utf8')

  const db = new Database(dbPath)
  try {
    const first = replayDeletionJournal(db, userData)
    assert.equal(first.replayed + first.failed, 2)
    assert.equal(count(db, 'SELECT COUNT(*) AS count FROM app_sessions'), 0)

    // Replaying again over an already-clean database is a harmless no-op.
    const second = replayDeletionJournal(db, userData)
    assert.equal(second.replayed, first.replayed)
    assert.equal(count(db, 'SELECT COUNT(*) AS count FROM app_sessions'), 0)
  } finally {
    db.close()
  }
})
