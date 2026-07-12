// Coverage for the chat agent's tool layer (ADR 0003): Daylens data tools
// (src/main/agent/daylensTools.ts), read-only machine tools
// (src/main/agent/systemTools.ts), and interaction tools
// (src/main/agent/interactionTools.ts). Tool execute signatures are AI SDK v6
// `tool({ execute })` — call `await (tools.foo as any).execute(input, {} as any)`.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import ExcelJS from 'exceljs'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import { ensureSearchSchema } from '../src/main/db/migrations.ts'
import { buildDaylensTools } from '../src/main/agent/daylensTools.ts'
import { buildSystemTools } from '../src/main/agent/systemTools.ts'
import { buildInteractionTools } from '../src/main/agent/interactionTools.ts'
import type { AIMessageArtifact } from '../src/shared/types.ts'

function setupDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  ensureSearchSchema(db)
  return db
}

function localMs(year: number, month: number, day: number, hour: number, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

// ─── daylensTools: list_page_visits ────────────────────────────────────────

test('list_page_visits aggregates repeat visits to the same page and matches domainContains', async () => {
  const db = setupDb()
  const insertVisit = db.prepare(`
    INSERT INTO website_visits (
      domain, page_title, url, visit_time, visit_time_us, duration_sec,
      browser_bundle_id, source
    ) VALUES (?, ?, ?, ?, ?, ?, 'com.google.Chrome', 'history')
  `)
  const visitTimeA = localMs(2026, 6, 10, 9, 0)
  const visitTimeB = localMs(2026, 6, 10, 9, 30)
  insertVisit.run(
    'youtube.com',
    'How I wasted $52,000 in my Dream Smart Home - YouTube',
    'https://www.youtube.com/watch?v=smart',
    visitTimeA,
    visitTimeA * 1000,
    300,
  )
  insertVisit.run(
    'youtube.com',
    'How I wasted $52,000 in my Dream Smart Home - YouTube',
    'https://www.youtube.com/watch?v=smart',
    visitTimeB,
    visitTimeB * 1000,
    180,
  )
  // A page on an unrelated domain in the same range — must not match domainContains 'youtube'.
  insertVisit.run(
    'docs.google.com',
    'Unrelated doc',
    'https://docs.google.com/document/d/unrelated',
    localMs(2026, 6, 10, 10, 0),
    localMs(2026, 6, 10, 10, 0) * 1000,
    60,
  )

  const tools = buildDaylensTools(db)
  const result = await (tools.list_page_visits as any).execute(
    { startDate: '2026-06-10', endDate: '2026-06-10', domainContains: 'youtube' },
    {} as any,
  )

  assert.equal(result.found, true)
  assert.equal(result.pages.length, 1, 'the two visits to the same page must aggregate into one row')
  const page = result.pages[0]
  assert.equal(page.domain, 'youtube.com')
  assert.equal(page.visitCount, 2)
  assert.equal(page.totalSeconds, 480, 'durations of the repeated visits must sum')
  db.close()
})

test('list_page_visits returns found:false with a reason for a disjoint range', async () => {
  const db = setupDb()
  db.prepare(`
    INSERT INTO website_visits (
      domain, page_title, url, visit_time, visit_time_us, duration_sec,
      browser_bundle_id, source
    ) VALUES (?, ?, ?, ?, ?, ?, 'com.google.Chrome', 'history')
  `).run(
    'youtube.com',
    'Some video - YouTube',
    'https://www.youtube.com/watch?v=abc',
    localMs(2026, 6, 10, 9, 0),
    localMs(2026, 6, 10, 9, 0) * 1000,
    120,
  )

  const tools = buildDaylensTools(db)
  const result = await (tools.list_page_visits as any).execute(
    { startDate: '2026-01-01', endDate: '2026-01-02' },
    {} as any,
  )

  assert.equal(result.found, false)
  assert.ok(typeof result.reason === 'string' && result.reason.length > 0)
  db.close()
})

// ─── daylensTools: get_moment ───────────────────────────────────────────────

test('get_moment reports found:false for a malformed time string', async () => {
  const db = setupDb()
  const tools = buildDaylensTools(db)
  const result = await (tools.get_moment as any).execute(
    { date: '2026-06-10', time: 'not-a-time' },
    {} as any,
  )
  assert.equal(result.found, false)
  assert.ok(typeof result.reason === 'string' && result.reason.length > 0)
  db.close()
})

// ─── systemTools: git allowlist ─────────────────────────────────────────────

test('git tool rejects a subcommand off the read-only allowlist', async () => {
  const tools = buildSystemTools()
  const result = await (tools.git as any).execute(
    { repoPath: process.cwd(), subcommand: 'push', args: [] },
    {} as any,
  )
  assert.equal(result.found, false)
  assert.match(result.reason, /not on the read-only allowlist/)
})

test('git tool rejects a denylisted argument even on an allowed subcommand', async () => {
  const tools = buildSystemTools()
  const result = await (tools.git as any).execute(
    { repoPath: process.cwd(), subcommand: 'log', args: ['--output=x'] },
    {} as any,
  )
  assert.equal(result.found, false)
  assert.match(result.reason, /deny list/)
})

// ─── interactionTools: create_artifact ──────────────────────────────────────

function makeInteractionDeps(artifactDir: string) {
  const artifacts: AIMessageArtifact[] = []
  const deps = {
    askUser: async () => { throw new Error('not used in this test') },
    artifactDir,
    onArtifact: (artifact: AIMessageArtifact) => { artifacts.push(artifact) },
  }
  return { deps, artifacts }
}

test('create_artifact writes a real CSV file and fires onArtifact with format csv', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-agent-tools-'))
  const { deps, artifacts } = makeInteractionDeps(tmpDir)
  const tools = buildInteractionTools(deps)

  const result = await (tools.create_artifact as any).execute(
    {
      title: 'YouTube July 2026',
      format: 'csv',
      columns: ['Title', 'Seconds'],
      rows: [['Video A', 120], ['Video B', 300]],
    },
    {} as any,
  )

  assert.equal(result.found, true)
  assert.ok(fs.existsSync(result.savedTo), 'the CSV file must actually exist on disk')
  const contents = fs.readFileSync(result.savedTo, 'utf8')
  assert.match(contents, /Title,Seconds/)
  assert.match(contents, /Video A,120/)
  assert.equal(artifacts.length, 1)
  assert.equal(artifacts[0].format, 'csv')
})

test('create_artifact writes a real non-empty xlsx file', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-agent-tools-'))
  const { deps, artifacts } = makeInteractionDeps(tmpDir)
  const tools = buildInteractionTools(deps)

  const result = await (tools.create_artifact as any).execute(
    {
      title: 'YouTube July 2026',
      format: 'xlsx',
      columns: ['Title', 'Seconds'],
      rows: [['Video A', 120], ['Video B', 300]],
    },
    {} as any,
  )

  assert.equal(result.found, true)
  const stat = await fsp.stat(result.savedTo)
  assert.ok(stat.size > 0, 'the xlsx file must be non-empty')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(result.savedTo)
  const sheet = workbook.worksheets[0]
  assert.ok(sheet, 'the workbook must have a sheet')
  assert.equal(sheet!.getRow(1).getCell(1).value, 'Title')
  assert.equal(artifacts.length, 1)
  assert.equal(artifacts[0].format, 'xlsx')
})

test('create_artifact rejects a markdown request with no content', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-agent-tools-'))
  const { deps, artifacts } = makeInteractionDeps(tmpDir)
  const tools = buildInteractionTools(deps)

  const result = await (tools.create_artifact as any).execute(
    { title: 'Empty report', format: 'markdown' },
    {} as any,
  )

  assert.equal(result.found, false)
  assert.ok(typeof result.reason === 'string' && result.reason.length > 0)
  assert.equal(artifacts.length, 0, 'no artifact should be recorded when the tool declines')
})
