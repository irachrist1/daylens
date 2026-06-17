import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LOADER = path.join(ROOT, 'tests/support/ts-loader.mjs')
const EVAL_RUNNER = path.join(ROOT, 'tests/timeline-eval/run.ts')
const EXPORTER = path.join(ROOT, 'tests/timeline-eval/export-founder-fixture.ts')

function runElectronScript(script: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(
    process.execPath,
    ['--loader', LOADER, script, ...args],
    {
      cwd: ROOT,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...env },
      encoding: 'utf8',
    },
  )
}

function localMs(date: string, clock: string): number {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute, second] = clock.split(':').map(Number)
  return new Date(year, month - 1, day, hour, minute, second, 0).getTime()
}

test('strict eval does not require Phase 0 witnesses for a non-Phase-0 fixture', () => {
  const result = runElectronScript(EVAL_RUNNER, ['--strict', 'coding-day'])
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /Score: segmentation 3\/3 .* wraps 1\/1/)
})

test('duration invariant sums every block session rather than capped top apps', () => {
  const result = runElectronScript(EVAL_RUNNER, ['--strict', 'founder-real', 'phase0-contract'])
  assert.equal(result.status, 1, 'the Phase 0 contract should remain expected-red')
  assert.doesNotMatch(result.stdout, /active \d+s != app sum \d+s/)
  assert.match(result.stdout, /one-duration total \d+m != observed truth 361m/)
})

test('founder exporter uses opaque aliases and stable repeated-page fixture URLs', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-export-test-'))
  const dbPath = path.join(tempDir, 'source.sqlite')
  const outputPath = path.join(tempDir, 'fixture.json')
  const db = new Database(dbPath)
  try {
    db.exec(SCHEMA_SQL)
    const sessionStart = localMs('2026-06-16', '09:00:00')
    db.prepare(`
      INSERT INTO app_sessions (
        bundle_id, app_name, start_time, end_time, duration_sec, category, window_title,
        raw_app_name, canonical_app_id, app_instance_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'com.private.SecretApp',
      'Fixture App',
      sessionStart,
      sessionStart + 60_000,
      60,
      'development',
      'Daylens',
      'Fixture App',
      'com.private.SecretApp',
      'com.private.SecretApp',
    )

    const insertVisit = db.prepare(`
      INSERT INTO website_visits (
        domain, page_title, url, visit_time, visit_time_us, duration_sec,
        browser_bundle_id, canonical_browser_id, normalized_url, page_key, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'test')
    `)
    const repeatedPage = 'https://private-product.invalid/project/alpha'
    insertVisit.run(
      'private-product.invalid',
      'Private project renamed',
      repeatedPage,
      sessionStart,
      sessionStart * 1000,
      30,
      'com.private.Browser',
      'private-browser',
      repeatedPage,
      'private-product.invalid/project/alpha',
    )
    insertVisit.run(
      'private-product.invalid',
      'Private project',
      repeatedPage,
      sessionStart + 60_000,
      (sessionStart + 60_000) * 1000,
      30,
      'com.private.Browser',
      'private-browser',
      repeatedPage,
      'private-product.invalid/project/alpha',
    )
    insertVisit.run(
      'private-product.invalid',
      'Another private project',
      'https://private-product.invalid/project/beta',
      sessionStart + 120_000,
      (sessionStart + 120_000) * 1000,
      30,
      'com.private.Browser',
      'private-browser',
      'https://private-product.invalid/project/beta',
      'private-product.invalid/project/beta',
    )
  } finally {
    db.close()
  }

  try {
    const result = runElectronScript(EXPORTER, [], {
      DAYLENS_TIMELINE_EVAL_SOURCE_DB: dbPath,
      DAYLENS_TIMELINE_EVAL_OUTPUT: outputPath,
    })
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const serialized = fs.readFileSync(outputPath, 'utf8')
    const fixture = JSON.parse(serialized) as {
      sessions: Array<{ bundleId: string }>
      browserEvidence: Array<{ domain: string; url: string }>
    }

    assert.equal(fixture.browserEvidence[0].url, fixture.browserEvidence[1].url)
    assert.notEqual(fixture.browserEvidence[1].url, fixture.browserEvidence[2].url)
    assert.doesNotMatch(serialized, /private-product\.invalid|com\.private\.(?:SecretApp|Browser)/)
    const reversibleDomainAlias = crypto
      .createHash('sha256')
      .update('private-product.invalid')
      .digest('hex')
      .slice(0, 10)
    assert.doesNotMatch(serialized, new RegExp(reversibleDomainAlias))
    assert.match(fixture.browserEvidence[0].domain, /^site-\d{4}\.example$/)
    assert.match(fixture.sessions[0].bundleId, /^fixture\.identity\.id-\d{4}$/)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})
