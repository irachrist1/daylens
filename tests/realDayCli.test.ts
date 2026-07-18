import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import {
  acceptReviewedCandidate,
  assertLocalOnly,
  comparisonFailureLines,
  compareObservations,
  createConsistentSnapshot,
  loadRealDayManifest,
  selectRecentCompleteDay,
  sha256File,
  type RealDayObservation,
} from '../scripts/real-day/lib.ts'

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-real-day-test-'))
}

test('real-day harness refuses CI and repository-local private data', () => {
  const previous = process.env.CI
  try {
    process.env.CI = '1'
    assert.throws(() => assertLocalOnly('/tmp/private', '/repo'), /refuse to run in CI/)

    delete process.env.CI
    assert.throws(
      () => assertLocalOnly('/repo/private/real-day', '/repo'),
      /outside the Git workspace/,
    )
    assert.doesNotThrow(() => assertLocalOnly('/tmp/daylens-private', '/repo'))
  } finally {
    if (previous == null) delete process.env.CI
    else process.env.CI = previous
  }
})

test('private manifest uses the shared day-fixture format', () => {
  const dir = tempDir()
  const manifestPath = path.join(dir, 'manifest.json')
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      id: 'real-2026-07-13',
      name: 'Reviewed real day',
      date: '2026-07-13',
      timezone: 'Africa/Kigali',
      input: {
        kind: 'private-database-copy',
        database: { relativePath: 'pristine/daylens.sqlite', sha256: 'a'.repeat(64) },
        privateReplay: {
          configRelativePath: 'pristine/config.json',
          capturedAt: '2026-07-14T00:00:00.000Z',
          source: {
            selector: 'production-user-data',
            userDataPath: '/private/user-data',
            databasePath: '/private/user-data/daylens.sqlite',
          },
        },
      },
      review: { state: 'draft', sourceHash: 'a'.repeat(64) },
      privacy: { localOnly: true, ciAllowed: false, containsRealUserData: true },
    }),
  )
  assert.equal(loadRealDayManifest(manifestPath).input.kind, 'private-database-copy')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('SQLite online backup reads WAL state without changing the source', async () => {
  const dir = tempDir()
  const sourcePath = path.join(dir, 'source.sqlite')
  const destinationPath = path.join(dir, 'copy.sqlite')
  const source = new Database(sourcePath)
  source.pragma('journal_mode = WAL')
  source.exec('CREATE TABLE evidence (value TEXT NOT NULL)')
  source.prepare('INSERT INTO evidence (value) VALUES (?)').run('captured')
  const before = fs.statSync(sourcePath)
  await createConsistentSnapshot(sourcePath, destinationPath)
  const after = fs.statSync(sourcePath)
  const copy = new Database(destinationPath, { readonly: true })
  assert.equal(
    (copy.prepare('SELECT value FROM evidence').get() as { value: string }).value,
    'captured',
  )
  assert.equal(before.size, after.size)
  assert.equal(before.mtimeMs, after.mtimeMs)
  assert.equal(sha256File(destinationPath).length, 64)
  copy.close()
  source.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('recent complete day excludes the live date and rejects thin days', () => {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE app_sessions (
      bundle_id TEXT, canonical_app_id TEXT, start_time INTEGER,
      end_time INTEGER, duration_sec INTEGER
    )
  `)
  const insert = db.prepare('INSERT INTO app_sessions VALUES (?, ?, ?, ?, ?)')
  const add = (date: string, count: number, seconds: number) => {
    const start = new Date(`${date}T09:00:00`).getTime()
    for (let index = 0; index < count; index += 1) {
      insert.run(
        'app',
        'app',
        start + index * 60_000,
        start + index * 60_000 + seconds * 1000,
        seconds,
      )
    }
  }
  add('2026-07-12', 20, 400)
  add('2026-07-13', 2, 30)
  add('2026-07-14', 30, 400)
  assert.equal(selectRecentCompleteDay(db, { beforeDate: '2026-07-14' }).date, '2026-07-12')
  db.close()
})

function observation(label: string, appSeconds = 120): RealDayObservation {
  const episode = {
    id: 'one',
    startMs: 1_000,
    endMs: 121_000,
    activeSeconds: 120,
    label,
    category: 'development',
    kind: 'work',
    apps: [],
    pages: [],
  }
  return {
    timeline: { productionProjection: { episodes: [episode] } },
    apps: {
      items: [
        { id: 'app', name: 'App', category: 'development', seconds: appSeconds, sessionCount: 1 },
      ],
    },
    meetings: [],
  } as unknown as RealDayObservation
}

test('accepted comparison reports label and Apps regressions', () => {
  const result = compareObservations(observation('Expected'), observation('Invented', 60))
  assert.equal(result.incorrectLabels, 1)
  assert.equal(result.appDisagreements, 1)
})

test('accepted comparison covers search, memory, AI facts, totals, and hourly reconstruction', () => {
  const expected = observation('Expected')
  Object.assign(expected, {
    search: [{ query: 'expected', resultCount: 1, kinds: ['session'], topTitles: ['Expected'] }],
    memory: { activeFactCount: 1, relevantFacts: ['Expected'], promptExcerpt: 'Expected' },
    aiFacts: { dayOverview: { total: 120 }, topAppUsage: {}, historySearch: {} },
    hours: [{ hour: '09:00–10:00', capturedActiveSeconds: 120 }],
    agreement: { timelineAppsDeltaSeconds: 0, aiTimelineDeltaSeconds: 0 },
  })
  Object.assign(expected.timeline, { directPayload: { totalSeconds: 120, episodes: [] } })
  Object.assign(expected.apps, { totalSeconds: 120 })

  const actual = structuredClone(expected)
  actual.search[0].resultCount = 0
  actual.memory.relevantFacts = []
  actual.aiFacts.dayOverview = { total: 60 }
  actual.hours[0].capturedActiveSeconds = 60
  actual.apps.totalSeconds = 60
  actual.agreement.timelineAppsDeltaSeconds = 60

  const result = compareObservations(expected, actual)
  assert.equal(result.searchDisagreements, 1)
  assert.equal(result.memoryDisagreements, 1)
  assert.equal(result.aiFactDisagreements, 1)
  assert.equal(result.hourlyDisagreements, 1)
  assert.equal(result.totalDisagreements, 2)
  assert.match(comparisonFailureLines(result).join('\n'), /AI-facing tool fact changes/)
})

test('accept refuses implicit approval and persists only confirmed reviews', () => {
  const dir = tempDir()
  const reviewPath = path.join(dir, 'review.json')
  const baselinePath = path.join(dir, 'accepted.json')
  const candidate = { ...observation('Expected'), fixtureId: 'real-2026-07-13', date: '2026-07-13' }
  fs.writeFileSync(reviewPath, JSON.stringify({ decision: 'pending', candidate }))
  assert.throws(
    () => acceptReviewedCandidate(reviewPath, baselinePath, { confirmed: true }),
    /decision.*confirmed/,
  )
  fs.writeFileSync(
    reviewPath,
    JSON.stringify({ decision: 'confirmed', notes: 'Matches my day.', candidate }),
  )
  assert.throws(
    () => acceptReviewedCandidate(reviewPath, baselinePath, { confirmed: false }),
    /--confirmed/,
  )
  const accepted = acceptReviewedCandidate(reviewPath, baselinePath, {
    confirmed: true,
    now: new Date('2026-07-14T12:00:00Z'),
  })
  assert.equal(accepted.review.notes, 'Matches my day.')
  assert.ok(fs.existsSync(baselinePath))
  fs.rmSync(dir, { recursive: true, force: true })
})
