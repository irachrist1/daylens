// Full-history export (DEV-196; privacy-retention-and-sync.md §Export).
//
// Proves the export contract on a real production-schema database:
//  - COMPLETE: every table in the live schema is either exported or listed in
//    a manifest omission — nothing is ever silently missing, even for tables
//    added by future migrations.
//  - Round-trip: exported row counts match the database, and the built-in
//    verifier confirms every checksum and row count from disk.
//  - DELETION-HONEST: deleted / tombstoned content is absent from every
//    exported byte and counted in the manifest's omissions.
//  - SENSITIVITY-HONEST: high-sensitivity rows are withheld by default,
//    listed, and included only on explicit selection.
//  - Streamed: a year-scale table exports without buffering in memory.
//  - LOCAL: the engine cannot reach the network (module boundary check).
//  - Failure honesty: a failed export removes its partial folder and names
//    the incomplete section.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type Database from 'better-sqlite3'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import {
  EXPORT_FORMAT,
  planHistoryExport,
  runHistoryExport,
  verifyHistoryExport,
  type HistoryExportManifest,
} from '../src/main/services/historyExport.ts'

const DELETED_MARKER = 'DELETED_SECRET_MARKER_e5b1'
const TOMBSTONED_MARKER = 'TOMBSTONED_PROVIDER_MARKER_9c4f'
const HIGH_SENSITIVITY_MARKER = 'HIGH_SENSITIVITY_MARKER_2a77'

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function seedFixture(db: Database.Database): void {
  const now = Date.now()
  const day = 24 * 3600 * 1000

  const insertSession = db.prepare(`
    INSERT INTO app_sessions (bundle_id, app_name, start_time, end_time, duration_sec, category)
    VALUES (?, ?, ?, ?, ?, 'productive')
  `)
  for (let i = 0; i < 50; i++) {
    insertSession.run('com.example.editor', 'Editor', now - i * day, now - i * day + 3600_000, 3600)
  }

  db.prepare(`
    INSERT INTO website_visits (domain, page_title, url, visit_time)
    VALUES ('example.com', 'Docs', 'https://example.com/docs', ?)
  `).run(now)

  // Memory facts: one live, one deleted tombstone that must never export.
  const factStmt = db.prepare(`
    INSERT INTO work_memory_facts (id, fact_text, origin, status, topic_key, created_at, updated_at)
    VALUES (?, ?, 'drafted', ?, ?, ?, ?)
  `)
  factStmt.run('fact-live', 'Works on the billing service', 'active', 'topic-a', now, now)
  factStmt.run('fact-deleted', `Forgotten fact ${DELETED_MARKER}`, 'deleted', 'topic-b', now, now)

  // Memory records: one live, one soft-deleted via deleted_at.
  const recordStmt = db.prepare(`
    INSERT INTO memory_records (id, record_kind, memory_type, statement, date, start_ms, end_ms, sensitivity, created_at, deleted_at)
    VALUES (?, 'session', 'observed', ?, '2026-07-01', ?, ?, ?, ?, ?)
  `)
  recordStmt.run('rec-live', 'Worked on exports', now, now + 1000, 'standard', now, null)
  recordStmt.run('rec-deleted', `Purged moment ${DELETED_MARKER}`, now, now + 1000, 'standard', now, now)
  recordStmt.run('rec-high', `Private moment ${HIGH_SENSITIVITY_MARKER}`, now, now + 1000, 'high', now, null)

  db.prepare(`
    INSERT INTO supplied_memory_facts (id, statement, confirmed_at, created_at, updated_at)
    VALUES ('supplied-1', 'Prefers morning deep work', ?, ?, ?)
  `).run(now, now, now)

  db.prepare(`
    INSERT INTO entities (id, entity_type, identity_key, canonical_name, created_at, updated_at)
    VALUES ('ent-1', 'project', 'project:daylens', 'Daylens', ?, ?)
  `).run(now, now)
  db.prepare(`
    INSERT INTO entity_evidence_refs (id, entity_id, source_type, source_id, created_at)
    VALUES ('ref-1', 'ent-1', 'app_session', '1', ?)
  `).run(now)

  // A known correction and a timeline block, for the without-Daylens
  // discoverability acceptance.
  db.prepare(`
    INSERT INTO correction_undo_log (id, date, kind, description, snapshot_json, created_at)
    VALUES ('corr-1', '2026-07-01', 'block_label', 'Relabeled the morning block to Billing work', '{}', ?)
  `).run(now)
  const localDay = new Date(now - new Date(now).getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
  db.prepare(`
    INSERT INTO timeline_blocks (id, date, start_time, end_time, block_kind, dominant_category, label_current, heuristic_version, computed_at)
    VALUES ('blk-1', ?, ?, ?, 'work', 'productive', 'Billing work', 'test-v1', ?)
  `).run(localDay, now, now + 3600_000, now)

  // Connector records (DEV-186 stack): live, provider-tombstoned, and
  // high-sensitivity — the export must carry the first, withhold the rest.
  db.prepare(`
    INSERT INTO connector_connections (connector_id, status, account_label, sync_cursor, connected_at, updated_at)
    VALUES ('google_calendar', 'connected', 'you@example.com', 'INTERNAL_CURSOR_MARKER_51d0', ?, ?)
  `).run(now, now)
  const connectorStmt = db.prepare(`
    INSERT INTO connector_records (id, connector_id, source_record_id, kind, retrieved_at, sensitivity, permission_scope, envelope_json, tombstoned_at, created_at, updated_at)
    VALUES (?, 'google_calendar', ?, 'meeting', ?, ?, 'calendar.readonly', ?, ?, ?, ?)
  `)
  connectorStmt.run('conn-live', 'src-1', now, 'standard', '{"title":"Standup"}', null, now, now)
  connectorStmt.run('conn-tomb', 'src-2', now, 'standard', `{"title":"${TOMBSTONED_MARKER}"}`, now, now, now)
  connectorStmt.run('conn-high', 'src-3', now, 'high', `{"title":"${HIGH_SENSITIVITY_MARKER}"}`, null, now, now)
}

function readManifest(exportDir: string): HistoryExportManifest {
  return JSON.parse(fs.readFileSync(path.join(exportDir, 'manifest.json'), 'utf8'))
}

function readAllExportedText(exportDir: string): string {
  const parts: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else parts.push(fs.readFileSync(full, 'utf8'))
    }
  }
  walk(exportDir)
  return parts.join('\n')
}

async function exportFixture(db: Database.Database, options: { includeHighSensitivity?: boolean } = {}) {
  const dest = tmpDir('daylens-export-test-')
  const result = await runHistoryExport(db, {
    destinationDir: dest,
    appVersion: '1.0.0-test',
    ...options,
  })
  assert.ok(result.ok, `export must succeed: ${result.ok ? '' : result.error}`)
  return { dest, result }
}

test('round-trip: counts match the database, the manifest is honest, and verification passes from disk', async () => {
  const db = createProductionTestDatabase()
  seedFixture(db)

  const plan = planHistoryExport(db)
  assert.ok(plan.totalRows > 0)
  assert.ok(plan.firstDay !== null && plan.lastDay !== null, 'plan reports the evidence date range')
  assert.ok(plan.sections.some((s) => s.id === 'activity'), 'captured activity section exists')
  assert.ok(plan.sections.some((s) => s.id === 'connected'), 'connected sources section exists (DEV-186 stack)')

  const { result } = await exportFixture(db)
  const manifest = readManifest(result.exportDir)

  assert.equal(manifest.format, EXPORT_FORMAT)
  assert.equal(manifest.appVersion, '1.0.0-test')
  assert.ok(manifest.schemaVersion >= 56, 'schema version recorded (v56 = connector foundation)')
  assert.ok(manifest.timezone.length > 0, 'timezone metadata recorded (spec)')

  // Every exported table's on-disk row count equals the database's filtered count.
  for (const entry of manifest.files.filter((f) => f.table)) {
    const filePath = path.join(result.exportDir, ...entry.file.split('/'))
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean)
    assert.equal(lines.length, entry.rows, `${entry.table}: manifest rows match file`)
    for (const line of lines) JSON.parse(line) // every line is valid JSON
  }

  const sessionsEntry = manifest.files.find((f) => f.table === 'app_sessions')!
  assert.equal(sessionsEntry.rows, 50)
  const connectorEntry = manifest.files.find((f) => f.table === 'connector_records')!
  assert.equal(connectorEntry.rows, 1, 'only the live, standard-sensitivity connector record exports')

  // Summaries, README, index, and the shipped schema exist and are covered by
  // the manifest (so tampering with any of them fails verification).
  for (const file of ['summary/daily-time.csv', 'summary/entity-totals.csv', 'summary/overview.md', 'README.md', 'index.md', 'schema/tables.json']) {
    assert.ok(manifest.files.some((f) => f.file === file), `${file} is in the manifest`)
  }
  assert.match(fs.readFileSync(path.join(result.exportDir, 'summary', 'entity-totals.csv'), 'utf8'), /Daylens/)

  // The shipped schema matches the live database's declared schema, table by
  // table, column by column — the export's JSON validates against ITS OWN
  // schema version, checkable without Daylens.
  const shipped = JSON.parse(fs.readFileSync(path.join(result.exportDir, 'schema', 'tables.json'), 'utf8'))
  assert.equal(shipped.schemaVersion, manifest.schemaVersion)
  for (const entry of manifest.files.filter((f) => f.table)) {
    const declared = shipped.tables[entry.table!]
    assert.ok(declared, `${entry.table} is declared in the shipped schema`)
    const live = db.prepare(`PRAGMA table_info(${entry.table})`).all() as Array<{ name: string; notnull: number }>
    const liveNames = new Set(live.map((c) => c.name))
    for (const column of declared.columns) {
      assert.ok(liveNames.has(column.name), `${entry.table}.${column.name} exists in the live schema`)
    }
  }

  // The verifier proves completeness from disk alone.
  const verification = await verifyHistoryExport(result.exportDir)
  assert.equal(verification.ok, true, verification.issues.join('; '))
  assert.equal(verification.tablesChecked, manifest.totals.tables)
  assert.equal(verification.rowsChecked, manifest.totals.rows)
  assert.deepEqual(result.verification.issues, [])

  // No .partial residue next to the finished export.
  const siblings = fs.readdirSync(path.dirname(result.exportDir))
  assert.ok(!siblings.some((name) => name.endsWith('.partial')), 'no partial folder remains')
})

test('deleted and tombstoned content is absent from every exported byte, and counted in omissions', async () => {
  const db = createProductionTestDatabase()
  seedFixture(db)
  const { result } = await exportFixture(db)

  const everything = readAllExportedText(result.exportDir)
  assert.ok(!everything.includes(DELETED_MARKER), 'user-deleted content must not export')
  assert.ok(!everything.includes(TOMBSTONED_MARKER), 'provider-tombstoned content must not export')
  assert.ok(!everything.includes('INTERNAL_CURSOR_MARKER_51d0'), 'internal sync cursors must not export')

  const manifest = readManifest(result.exportDir)
  const deleted = manifest.omissions.find((o) => o.category === 'deleted-content')!
  assert.ok(deleted.rows! >= 3, 'deleted fact + deleted record + tombstoned connector record are counted')
  assert.ok(deleted.tables!.includes('work_memory_facts'))
  assert.ok(deleted.tables!.includes('memory_records'))
  assert.ok(deleted.tables!.includes('connector_records'))
})

test('high-sensitivity rows are withheld by default, listed, and included only on explicit selection', async () => {
  const db = createProductionTestDatabase()
  seedFixture(db)

  const defaultPlan = planHistoryExport(db)
  assert.ok(defaultPlan.highSensitivityRows >= 2, 'plan surfaces the withheld high-sensitivity count')

  const { result } = await exportFixture(db)
  const withheldText = readAllExportedText(result.exportDir)
  assert.ok(!withheldText.includes(HIGH_SENSITIVITY_MARKER), 'high-sensitivity content withheld by default')
  const manifest = readManifest(result.exportDir)
  const omission = manifest.omissions.find((o) => o.category === 'high-sensitivity')!
  assert.ok(omission.rows! >= 2)
  assert.equal(manifest.includeHighSensitivity, false)

  const { result: optedIn } = await exportFixture(db, { includeHighSensitivity: true })
  const optedInText = readAllExportedText(optedIn.exportDir)
  assert.ok(optedInText.includes(HIGH_SENSITIVITY_MARKER), 'explicit selection includes high-sensitivity rows')
  const optedInManifest = readManifest(optedIn.exportDir)
  assert.equal(optedInManifest.includeHighSensitivity, true)
  assert.ok(!optedInManifest.omissions.some((o) => o.category === 'high-sensitivity'))
  // Even opted in, deleted content stays out.
  assert.ok(!optedInText.includes(DELETED_MARKER))
})

test('completeness: every table in the live schema is either exported or explicitly listed as an omission', async () => {
  const db = createProductionTestDatabase()
  seedFixture(db)
  const { result } = await exportFixture(db)
  const manifest = readManifest(result.exportDir)

  const exported = new Set(manifest.files.filter((f) => f.table).map((f) => f.table))
  const omitted = new Set<string>()
  for (const omission of manifest.omissions) {
    for (const t of omission.tables ?? []) omitted.add(t.replace(/ \(.*\)$/, ''))
  }

  const allTables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all() as Array<{ name: string }>
  for (const { name } of allTables) {
    assert.ok(
      exported.has(name) || omitted.has(name),
      `table ${name} must be exported or listed as an omission — never silently missing`,
    )
  }

  // The spec-mandated exclusion categories are all declared out loud.
  for (const category of ['credentials', 'billing-secrets', 'raw-screen-frames', 'deleted-content']) {
    assert.ok(manifest.omissions.some((o) => o.category === category), `omission category ${category} declared`)
  }
})

test('verification catches tampering: a corrupted data file and a falsified manifest count both fail', async () => {
  const db = createProductionTestDatabase()
  seedFixture(db)
  const { result } = await exportFixture(db)

  // 1. Corrupt a data file → checksum mismatch.
  const sessionsFile = path.join(result.exportDir, 'data', 'app_sessions.jsonl')
  fs.appendFileSync(sessionsFile, '{"forged":true}\n')
  const corrupted = await verifyHistoryExport(result.exportDir)
  assert.equal(corrupted.ok, false)
  assert.ok(corrupted.issues.some((issue) => issue.includes('app_sessions')))

  // 2. Fresh export, falsify the manifest's claimed totals → caught too.
  const { result: second } = await exportFixture(db)
  const manifestPath = path.join(second.exportDir, 'manifest.json')
  const manifest = readManifest(second.exportDir)
  manifest.totals.rows += 1
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  const falsified = await verifyHistoryExport(second.exportDir)
  assert.equal(falsified.ok, false)

  // 3. A missing folder reports honestly instead of throwing.
  const missing = await verifyHistoryExport(path.join(os.tmpdir(), 'not-a-real-export'))
  assert.equal(missing.ok, false)
})

test('streaming bounds: a year-scale table exports without buffering in memory', async () => {
  const db = createProductionTestDatabase()
  const insert = db.prepare(`
    INSERT INTO app_sessions (bundle_id, app_name, start_time, end_time, duration_sec, category, window_title)
    VALUES (?, ?, ?, ?, ?, 'productive', ?)
  `)
  const title = 'Working on something fairly long-winded so each row carries realistic weight — '.repeat(4)
  const seedMany = db.transaction(() => {
    for (let i = 0; i < 150_000; i++) {
      insert.run('com.example.editor', 'Editor', 1_700_000_000_000 + i * 60_000, 1_700_000_000_000 + i * 60_000 + 59_000, 59, `${title}${i}`)
    }
  })
  seedMany()

  const dest = tmpDir('daylens-export-stream-')
  const before = process.memoryUsage().heapUsed
  let peak = before
  const result = await runHistoryExport(db, {
    destinationDir: dest,
    appVersion: '1.0.0-test',
    onProgress: () => {
      const used = process.memoryUsage().heapUsed
      if (used > peak) peak = used
    },
  })
  assert.ok(result.ok, `export must succeed: ${result.ok ? '' : result.error}`)

  const sessionsBytes = fs.statSync(path.join(result.exportDir, 'data', 'app_sessions.jsonl')).size
  assert.ok(sessionsBytes > 50 * 1024 * 1024, `fixture is year-scale (${sessionsBytes} bytes)`)
  const heapGrowth = peak - before
  assert.ok(
    heapGrowth < sessionsBytes / 2,
    `heap growth (${Math.round(heapGrowth / 1024 / 1024)} MB) must stay far below the exported size (${Math.round(sessionsBytes / 1024 / 1024)} MB) — rows must stream, not buffer`,
  )

  const verification = await verifyHistoryExport(result.exportDir)
  assert.equal(verification.ok, true, verification.issues.join('; '))
})

test('failure honesty: an unwritable destination fails cleanly with no partial folder left behind', async () => {
  const db = createProductionTestDatabase()
  seedFixture(db)

  // Occupy the destination path with a FILE so directory creation fails
  // deterministically on every platform (chmod is unreliable as root/CI).
  const dest = tmpDir('daylens-export-fail-')
  const blocker = path.join(dest, 'blocker')
  fs.writeFileSync(blocker, 'not a directory')
  const result = await runHistoryExport(db, {
    destinationDir: path.join(blocker, 'nested'),
    appVersion: '1.0.0-test',
  })
  assert.equal(result.ok, false)
  if (!result.ok) assert.ok(result.error.length > 0)
  assert.deepEqual(fs.readdirSync(dest), ['blocker'], 'nothing was created next to the blocker')
})

test('failure honesty: a mid-stream failure names the incomplete section and removes the partial export', async () => {
  const db = createProductionTestDatabase()
  seedFixture(db)

  const dest = tmpDir('daylens-export-midfail-')
  let calls = 0
  const result = await runHistoryExport(db, {
    destinationDir: dest,
    appVersion: '1.0.0-test',
    onProgress: () => {
      calls += 1
      // Simulates any mid-stream failure (disk full, I/O error) once tables
      // have started streaming.
      if (calls === 3) throw new Error('simulated disk failure')
    },
  })
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.match(result.error, /simulated disk failure/)
    assert.ok(result.incompleteSections.length > 0, 'the incomplete section is identified (spec: failure behavior)')
  }
  assert.deepEqual(fs.readdirSync(dest), [], 'the partial export folder was removed')
})

test('without Daylens: a person can locate a known day, entity, and correction from the export alone', async () => {
  const db = createProductionTestDatabase()
  seedFixture(db)
  const { result } = await exportFixture(db)

  // The entry point tells you where everything lives.
  const index = fs.readFileSync(path.join(result.exportDir, 'index.md'), 'utf8')
  assert.match(index, /correction_undo_log\.jsonl/, 'index points at corrections')
  assert.match(index, /entity-totals\.csv/, 'index points at the entity listing')
  assert.match(index, /days\//, 'index links the dated day pages')

  // A known day: a dated, readable file naming what happened.
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
  const dayPage = fs.readFileSync(path.join(result.exportDir, 'days', today.slice(0, 4), `${today}.md`), 'utf8')
  assert.match(dayPage, /Editor/, 'the day page names the application used that day')
  assert.match(dayPage, /Billing work/, 'the day page shows the timeline block label')
  assert.ok(index.includes(`days/${today.slice(0, 4)}/${today}.md`), 'the index links that day')

  // A known entity: findable by name in the human listing, then in the data.
  assert.match(fs.readFileSync(path.join(result.exportDir, 'summary', 'entity-totals.csv'), 'utf8'), /Daylens/)
  assert.match(fs.readFileSync(path.join(result.exportDir, 'data', 'entities.jsonl'), 'utf8'), /"canonical_name":"Daylens"/)

  // A known correction: in exactly the file the index names.
  const corrections = fs.readFileSync(path.join(result.exportDir, 'data', 'correction_undo_log.jsonl'), 'utf8')
  assert.match(corrections, /Relabeled the morning block to Billing work/)
})

test('the exported JSON validates against the shipped schema, and verification catches a schema-violating row', async () => {
  const db = createProductionTestDatabase()
  seedFixture(db)
  const { result } = await exportFixture(db)

  // A row with a column the shipped schema does not declare fails verification
  // (checksum aside — recompute nothing, just corrupt then check the message).
  const file = path.join(result.exportDir, 'data', 'work_memory_facts.jsonl')
  const original = fs.readFileSync(file, 'utf8').trimEnd().split('\n')
  const forged = { ...JSON.parse(original[0]), smuggled_column: 1 }
  fs.writeFileSync(file, [...original, JSON.stringify(forged)].join('\n') + '\n')
  const verification = await verifyHistoryExport(result.exportDir)
  assert.equal(verification.ok, false)
  assert.ok(
    verification.issues.some((issue) => issue.includes('unexpected column "smuggled_column"')),
    `row-level schema validation reports the violation: ${verification.issues.join('; ')}`,
  )
})

test('privacy boundary: no credential-shaped content anywhere in the export', async () => {
  const db = createProductionTestDatabase()
  seedFixture(db)
  const { result } = await exportFixture(db, { includeHighSensitivity: true })
  const everything = readAllExportedText(result.exportDir)

  // Provider-specific credential shapes (from the shared credential corpus)
  // must never appear — credentials live only in the OS secure store, which
  // the engine cannot even import (see the module-boundary test below).
  const credentialShapes: Array<[string, RegExp]> = [
    ['openai_key', /sk-[A-Za-z0-9_-]{20,}/],
    ['slack_token', /xox[abprs]-[A-Za-z0-9-]{10,}/],
    ['google_oauth', /ya29\.[A-Za-z0-9_.-]+/],
    ['github_pat', /gh[pousr]_[A-Za-z0-9]{30,}/],
    ['aws_access_key', /\bAKIA[0-9A-Z]{16}\b/],
    ['jwt', /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ]
  for (const [name, regex] of credentialShapes) {
    assert.ok(!regex.test(everything), `export must contain no ${name}-shaped value`)
  }

  // And the manifest says out loud that credentials are excluded by design.
  const manifest = readManifest(result.exportDir)
  assert.ok(manifest.omissions.some((o) => o.category === 'credentials'))
})

test('privacy boundary: the export engine cannot reach the network', () => {
  const modulePath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..', 'src', 'main', 'services', 'historyExport.ts',
  )
  const source = fs.readFileSync(modulePath, 'utf8')
  for (const forbidden of ["'node:http'", "'node:https'", "'node:net'", "'node:dgram'", "'node:tls'", 'fetch(', 'XMLHttpRequest', "'electron'", 'secureStore', 'keytar', 'safeStorage']) {
    assert.ok(!source.includes(forbidden), `historyExport.ts must not reference ${forbidden} — exports are local-only and can never see the credential store`)
  }
})
