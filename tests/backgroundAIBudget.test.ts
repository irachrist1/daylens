// Regression test: a runaway background loop once made 77k relabel calls in a
// week because nothing between a scheduler and the provider ever refused to
// spend. The daily budget
// breaker counts every attempted background call in ai_usage_events and trips
// at the cap, so any future loop — known or not — is bounded to pennies.
import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { countBackgroundAIUsageEventsSince, startAIUsageEvent } from '../src/main/db/queries.ts'
import { BACKGROUND_AI_DAILY_CALL_CAP, backgroundAIBudgetExhausted } from '../src/main/services/aiOrchestration.ts'

function insertEvent(db: Database.Database, id: string, triggerSource: string, startedAt: number): void {
  startAIUsageEvent(db, {
    id,
    jobType: 'block_cleanup_relabel',
    screen: 'timeline_day',
    triggerSource,
    startedAt,
  })
}

test('breaker counts only background attempts since the given time', () => {
  const db = createProductionTestDatabase()

  const midnight = new Date(2026, 6, 5, 0, 0, 0, 0).getTime()
  insertEvent(db, 'bg-before', 'background', midnight - 60_000)
  insertEvent(db, 'bg-1', 'background', midnight + 1_000)
  insertEvent(db, 'bg-2', 'background', midnight + 2_000)
  insertEvent(db, 'user-1', 'user', midnight + 3_000)
  insertEvent(db, 'system-1', 'system', midnight + 4_000)

  assert.equal(countBackgroundAIUsageEventsSince(db, midnight), 2)
  db.close()
})

test('the daily background budget trips at the cap and only for background work', () => {
  const db = createProductionTestDatabase()

  const now = new Date(2026, 6, 5, 14, 30, 0, 0).getTime()
  const morning = new Date(2026, 6, 5, 9, 0, 0, 0).getTime()

  for (let i = 0; i < BACKGROUND_AI_DAILY_CALL_CAP - 1; i++) {
    insertEvent(db, `bg-${i}`, 'background', morning + i)
  }
  assert.equal(backgroundAIBudgetExhausted(db, now), false)

  // A mountain of user-triggered work never trips the background breaker.
  for (let i = 0; i < 50; i++) {
    insertEvent(db, `user-${i}`, 'user', morning + i)
  }
  assert.equal(backgroundAIBudgetExhausted(db, now), false)

  insertEvent(db, 'bg-final', 'background', morning + 100_000)
  assert.equal(backgroundAIBudgetExhausted(db, now), true)

  // Yesterday's spend never blocks today: the same ledger read the next
  // morning is under budget again.
  const nextMorning = new Date(2026, 6, 6, 8, 0, 0, 0).getTime()
  assert.equal(backgroundAIBudgetExhausted(db, nextMorning), false)

  db.close()
})
