// Provider circuit breaker through the real orchestration choke point
// (executeTextAIJob). Proves the W1-B contract end to end:
//   - a quota/credit hard-wall failure OPENS the breaker for that provider,
//   - machine-initiated background jobs are then SKIPPED without a provider
//     call (and without logging a phantom ai_usage_events attempt),
//   - user-initiated work — foreground job types, and background job types
//     explicitly triggered by the user (manual Analyze) — still attempts once
//     and surfaces the existing honest error,
//   - a successful call CLOSES the breaker again.
import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import { setTestDb, clearTestDb } from './support/database-stub.mjs'
import { __resetSettings, __setSettings, setApiKey } from './support/settings-stub.mjs'
import { executeTextAIJob } from '../src/main/services/aiOrchestration.ts'
import {
  getProviderBreakerState,
  recordProviderHardFailure,
} from '../src/main/services/providerCircuitBreaker.ts'

// Classified as quota_exhausted by providerErrors.ts: a 429 whose message
// names the exhausted quota (Gemini free-tier daily allowance style).
function quotaWallError(): Error {
  const error = new Error('You exceeded your current quota, please check your plan and billing details.') as Error & { status: number }
  error.status = 429
  return error
}

async function setup(): Promise<InstanceType<typeof Database>> {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  setTestDb(db)
  __resetSettings()
  __setSettings({ aiProvider: 'anthropic', aiChatProvider: 'anthropic' })
  await setApiKey('anthropic', 'test-key')
  return db
}

function teardown(db: InstanceType<typeof Database>): void {
  clearTestDb()
  __resetSettings()
  db.close()
}

function usageEventCount(db: InstanceType<typeof Database>): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM ai_usage_events').get() as { n: number }).n
}

test('a quota hard wall on a background job opens the breaker; the next background job skips without calling the provider', async () => {
  const db = await setup()
  try {
    let runnerCalls = 0
    await assert.rejects(
      executeTextAIJob(
        {
          jobType: 'block_cleanup_relabel',
          triggerSource: 'background',
          systemPrompt: 'sys',
          userMessage: 'label this',
        },
        async () => {
          runnerCalls += 1
          throw quotaWallError()
        },
      ),
      /usage limit/i,
    )
    assert.equal(runnerCalls, 1)
    assert.equal(getProviderBreakerState(db, 'anthropic').open, true)

    // While open: the next machine-initiated background job never reaches the
    // provider and never logs a phantom usage event.
    const eventsBefore = usageEventCount(db)
    await assert.rejects(
      executeTextAIJob(
        {
          jobType: 'block_label_finalize',
          triggerSource: 'background',
          systemPrompt: 'sys',
          userMessage: 'label this too',
        },
        async () => {
          runnerCalls += 1
          return { text: 'should never run' }
        },
      ),
      /Background AI paused for Anthropic Claude/,
    )
    assert.equal(runnerCalls, 1)
    assert.equal(usageEventCount(db), eventsBefore)
  } finally {
    teardown(db)
  }
})

test('foreground user work still attempts once while the breaker is open, and surfaces the honest provider error', async () => {
  const db = await setup()
  try {
    recordProviderHardFailure(db, 'anthropic', 'quota_exhausted', null, Date.now())

    let runnerCalls = 0
    await assert.rejects(
      executeTextAIJob(
        {
          jobType: 'day_summary', // foreground: true
          triggerSource: 'user',
          systemPrompt: 'sys',
          userMessage: 'summarize my day',
        },
        async () => {
          runnerCalls += 1
          throw quotaWallError()
        },
      ),
      // The existing branded quota copy from providerErrors.ts, not the skip message.
      /You've hit Anthropic Claude's usage limit/,
    )
    assert.equal(runnerCalls, 1)
  } finally {
    teardown(db)
  }
})

test("a background job TYPE explicitly triggered by the user (manual Analyze) is user work — it still attempts", async () => {
  const db = await setup()
  try {
    recordProviderHardFailure(db, 'anthropic', 'quota_exhausted', null, Date.now())

    let runnerCalls = 0
    const result = await executeTextAIJob(
      {
        jobType: 'block_cleanup_relabel', // foreground: false in JOB_DEFINITIONS
        triggerSource: 'user',            // ...but the user clicked Analyze
        systemPrompt: 'sys',
        userMessage: 'regroup my day',
      },
      async () => {
        runnerCalls += 1
        return { text: 'regrouped' }
      },
    )
    assert.equal(runnerCalls, 1)
    assert.equal(result.text, 'regrouped')
  } finally {
    teardown(db)
  }
})

test('a successful call closes the breaker, so background work resumes immediately', async () => {
  const db = await setup()
  try {
    recordProviderHardFailure(db, 'anthropic', 'credit_exhausted', null, Date.now())
    assert.equal(getProviderBreakerState(db, 'anthropic').open, true)

    // Foreground success (e.g. the user re-tried after topping up credit).
    await executeTextAIJob(
      {
        jobType: 'day_summary',
        triggerSource: 'user',
        systemPrompt: 'sys',
        userMessage: 'summarize',
      },
      async () => ({ text: 'a fine day' }),
    )
    assert.equal(getProviderBreakerState(db, 'anthropic').open, false)

    // Background work flows again.
    let backgroundRan = 0
    await executeTextAIJob(
      {
        jobType: 'block_cleanup_relabel',
        triggerSource: 'background',
        systemPrompt: 'sys',
        userMessage: 'label',
      },
      async () => {
        backgroundRan += 1
        return { text: 'labeled' }
      },
    )
    assert.equal(backgroundRan, 1)
  } finally {
    teardown(db)
  }
})

test('an expired cooldown lets background work through again without any reset', async () => {
  const db = await setup()
  try {
    const past = Date.now() - 48 * 60 * 60 * 1000
    recordProviderHardFailure(db, 'anthropic', 'quota_exhausted', null, past)
    assert.equal(getProviderBreakerState(db, 'anthropic').open, false)

    let runnerCalls = 0
    await executeTextAIJob(
      {
        jobType: 'block_cleanup_relabel',
        triggerSource: 'background',
        systemPrompt: 'sys',
        userMessage: 'label',
      },
      async () => {
        runnerCalls += 1
        return { text: 'labeled' }
      },
    )
    assert.equal(runnerCalls, 1)
  } finally {
    teardown(db)
  }
})
