// Provider circuit breaker (W1-B): when a provider reports a hard wall
// (quota_exhausted / credit_exhausted), background AI jobs must stop hitting
// it for a real cooldown — hours, persisted across restarts — instead of the
// ~740k futile retries the founder's real install logged in May–June 2026.
// These are the unit tests for the persisted breaker store itself; the
// orchestration-level skip/attempt behavior is covered in
// providerBreakerOrchestration.test.ts.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import {
  DEFAULT_COOLDOWN_MS,
  MAX_COOLDOWN_MS,
  MIN_COOLDOWN_MS,
  getProviderBreakerState,
  recordProviderHardFailure,
  resetAllProviderBreakers,
  resetProviderBreaker,
} from '../src/main/services/providerCircuitBreaker.ts'

function makeDb(): InstanceType<typeof Database> {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  return db
}

const NOW = new Date(2026, 6, 11, 10, 0, 0, 0).getTime()

test('a quota hard wall opens the breaker with the default multi-hour cooldown', () => {
  const db = makeDb()

  assert.equal(getProviderBreakerState(db, 'google', NOW).open, false)

  const state = recordProviderHardFailure(db, 'google', 'quota_exhausted', null, NOW)
  assert.equal(state.open, true)
  assert.equal(state.reason, 'quota_exhausted')
  assert.equal(state.cooldownUntil, NOW + DEFAULT_COOLDOWN_MS)
  // Hours, not seconds — the whole point of the layer above aiRateLimiter.
  assert.ok(DEFAULT_COOLDOWN_MS >= 60 * 60 * 1000)

  const read = getProviderBreakerState(db, 'google', NOW + 1)
  assert.equal(read.open, true)
  assert.equal(read.reason, 'quota_exhausted')
  assert.equal(read.openedAt, NOW)

  // Only the failed provider is open.
  assert.equal(getProviderBreakerState(db, 'anthropic', NOW + 1).open, false)
  db.close()
})

test('retryAfterSeconds is honored, clamped to a sane floor and ceiling', () => {
  const db = makeDb()

  // Provider asked for 2 hours — honored exactly.
  const twoHours = recordProviderHardFailure(db, 'openai', 'quota_exhausted', 7200, NOW)
  assert.equal(twoHours.cooldownUntil, NOW + 7200 * 1000)

  // A near-zero Retry-After on a HARD wall is not believable — floor applies.
  const tiny = recordProviderHardFailure(db, 'google', 'quota_exhausted', 10, NOW)
  assert.equal(tiny.cooldownUntil, NOW + MIN_COOLDOWN_MS)

  // An absurd Retry-After can't wedge the breaker open for a year — ceiling applies.
  const huge = recordProviderHardFailure(db, 'anthropic', 'credit_exhausted', 90 * 24 * 3600, NOW)
  assert.equal(huge.cooldownUntil, NOW + MAX_COOLDOWN_MS)
  db.close()
})

test('the breaker closes by itself once the cooldown elapses', () => {
  const db = makeDb()
  const state = recordProviderHardFailure(db, 'google', 'credit_exhausted', null, NOW)

  assert.equal(getProviderBreakerState(db, 'google', state.cooldownUntil! - 1).open, true)
  assert.equal(getProviderBreakerState(db, 'google', state.cooldownUntil!).open, false)
  db.close()
})

test('reset closes the breaker immediately (success / provider change / key change)', () => {
  const db = makeDb()
  recordProviderHardFailure(db, 'google', 'quota_exhausted', null, NOW)
  assert.equal(getProviderBreakerState(db, 'google', NOW + 1).open, true)

  resetProviderBreaker(db, 'google', 'success')
  assert.equal(getProviderBreakerState(db, 'google', NOW + 1).open, false)

  // Resetting an already-closed breaker is a harmless no-op.
  resetProviderBreaker(db, 'google', 'provider_changed')
  assert.equal(getProviderBreakerState(db, 'google', NOW + 1).open, false)
  db.close()
})

test('resetAllProviderBreakers clears every provider at once', () => {
  const db = makeDb()
  recordProviderHardFailure(db, 'google', 'quota_exhausted', null, NOW)
  recordProviderHardFailure(db, 'anthropic', 'credit_exhausted', null, NOW)

  resetAllProviderBreakers(db, 'key_changed')
  assert.equal(getProviderBreakerState(db, 'google', NOW + 1).open, false)
  assert.equal(getProviderBreakerState(db, 'anthropic', NOW + 1).open, false)
  db.close()
})

test('a repeated hard failure extends the cooldown but keeps the original opened_at', () => {
  const db = makeDb()
  recordProviderHardFailure(db, 'google', 'quota_exhausted', null, NOW)
  const later = NOW + 60 * 60 * 1000
  const extended = recordProviderHardFailure(db, 'google', 'quota_exhausted', null, later)

  assert.equal(extended.openedAt, NOW)
  assert.equal(extended.cooldownUntil, later + DEFAULT_COOLDOWN_MS)
  db.close()
})

test('the open breaker survives an app restart (state persists in the DB file)', () => {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-breaker-')), 'test.sqlite')
  const first = new Database(dbPath)
  first.exec(SCHEMA_SQL)
  recordProviderHardFailure(first, 'google', 'quota_exhausted', null, NOW)
  first.close()

  // "Restart": a fresh connection to the same file.
  const second = new Database(dbPath)
  const state = getProviderBreakerState(second, 'google', NOW + 1)
  assert.equal(state.open, true)
  assert.equal(state.reason, 'quota_exhausted')
  second.close()
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true })
})
