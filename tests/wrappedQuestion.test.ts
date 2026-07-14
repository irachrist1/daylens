import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { setTestDb, clearTestDb } from './support/database-stub.mjs'
import { __setSettings, setApiKey } from './support/settings-stub.mjs'
import { askWrappedQuestion, registerWrappedQuestionProvider } from '../src/main/services/wrappedQuestion.ts'
import type { DaySnapshot } from '../src/shared/types.ts'

// The interactive slide: the user asks about a data point (or answers the
// wrap's own question) and a REAL AI response comes back through the same
// executeTextAIJob path production uses — provider resolution, usage logging,
// prompt redaction — with only the network runner stubbed. Hermetic, no key.

function freshDb(): Database.Database {
  return createProductionTestDatabase()
}

function snapshotFor(date: string, hours: number): DaySnapshot {
  return {
    date,
    totalActiveSeconds: hours * 3600,
    kind: { work: (hours - 1) * 3600, leisure: 3600, personal: 0, idle: 0 },
    dominantWorkCategory: 'development',
    categories: [{ category: 'development', seconds: (hours - 1) * 3600 }],
    apps: [{ appName: 'Cursor', seconds: (hours - 1) * 3600, category: 'development', isBrowser: false }],
    domains: [],
    leisureSurfaces: ['YouTube'],
    threads: [{ subject: 'The timeline rework', role: 'building', seconds: (hours - 1) * 3600 }],
    longestBlock: { label: 'The timeline rework', seconds: 130 * 60, startClock: '9:12am' },
    factsHash: `hash-${date}`,
    finalizedAt: 1_750_000_000_000,
  }
}

function seedWeek(db: Database.Database): void {
  const insert = db.prepare(`
    INSERT INTO day_snapshots (date, total_active, work_sec, leisure_sec, personal_sec, facts_json, facts_hash, finalized_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  // A week fully in the past (relative to any plausible "today").
  for (const [date, hours] of [['2026-06-22', 6], ['2026-06-23', 8], ['2026-06-24', 5]] as Array<[string, number]>) {
    const snap = snapshotFor(date, hours)
    insert.run(date, snap.totalActiveSeconds, snap.kind.work, snap.kind.leisure, 0, JSON.stringify(snap), snap.factsHash, snap.finalizedAt)
  }
}

test('ask: no provider registered → an honest error, never a fake answer', async () => {
  const db = freshDb()
  setTestDb(db)
  try {
    const result = await askWrappedQuestion({
      cadence: 'week', periodKey: '2026-06-24', slideId: 'focus', slideLine: null,
      question: 'What was my longest stretch?',
    })
    assert.equal(result.answer, null)
    assert.match(result.error ?? '', /provider/i)
  } finally {
    clearTestDb()
    db.close()
  }
})

test('ask: an empty question never spends a call', async () => {
  const db = freshDb()
  setTestDb(db)
  try {
    const result = await askWrappedQuestion({ cadence: 'week', periodKey: '2026-06-24', slideId: 'focus', slideLine: null, question: '   ' })
    assert.equal(result.answer, null)
    assert.ok(result.error)
  } finally {
    clearTestDb()
    db.close()
  }
})

test('ask: a slide question returns a real AI response, grounded in the wrap facts', async () => {
  const db = freshDb()
  seedWeek(db)
  setTestDb(db)
  __setSettings({ aiProvider: 'anthropic' })
  await setApiKey('anthropic', 'test-key')

  let capturedSystem = ''
  let capturedUser = ''
  registerWrappedQuestionProvider(async (_config, systemPrompt, _prior, userMessage) => {
    capturedSystem = systemPrompt
    capturedUser = userMessage
    return { text: 'Your longest stretch was 2h 10m on Tuesday, starting 9:12am, on the timeline rework.', usage: null }
  })

  try {
    const result = await askWrappedQuestion({
      cadence: 'week', periodKey: '2026-06-24', slideId: 'focus',
      slideLine: '2h 10m without breaking, Tuesday, from 9:12am.',
      question: 'What was I doing during that stretch?',
    })
    assert.equal(result.error, null)
    assert.match(result.answer ?? '', /timeline rework/, 'expected the runner answer back')

    // The call was grounded: the prompt carried the same facts the wrap shows.
    assert.match(capturedUser, /timeline rework/i, 'facts JSON missing from the prompt')
    assert.match(capturedUser, /What was I doing during that stretch\?/, 'the user question missing')
    assert.match(capturedUser, /"focus"/, 'the slide id missing')
    assert.match(capturedSystem, /Ground every claim in the facts JSON/, 'grounding rule missing')
    // The deck outline grounds the chat in exactly what the cards show, and the
    // time contract stops the "you started at midnight" re-derivation.
    assert.match(capturedUser, /The deck they are looking at/, 'deck outline missing from the prompt')
    assert.match(capturedSystem, /"12am" is midnight, "12pm" is noon/, 'time-literacy contract missing')

    // The user-facing call is logged like every other AI job.
    const usage = db.prepare(`SELECT job_type FROM ai_usage_events ORDER BY started_at DESC LIMIT 1`).get() as { job_type: string } | undefined
    assert.equal(usage?.job_type, 'wrapped_question')
  } finally {
    clearTestDb()
    db.close()
  }
})

test('ask: answering the wrap\'s own question frames the reply in context', async () => {
  const db = freshDb()
  seedWeek(db)
  setTestDb(db)
  __setSettings({ aiProvider: 'anthropic' })
  await setApiKey('anthropic', 'test-key')

  let capturedUser = ''
  registerWrappedQuestionProvider(async (_config, _system, _prior, userMessage) => {
    capturedUser = userMessage
    return { text: 'That tracks. Tuesday had your longest run of the week, so it makes sense it felt best.', usage: null }
  })

  try {
    const result = await askWrappedQuestion({
      cadence: 'week', periodKey: '2026-06-24', slideId: 'question',
      slideLine: 'Which day of this week would you actually want back?',
      question: 'Tuesday, easily.',
      replyingTo: 'Which day of this week would you actually want back?',
    })
    assert.equal(result.error, null)
    assert.ok(result.answer)
    assert.match(capturedUser, /You had asked them/, 'the reply framing is missing')
    assert.match(capturedUser, /Tuesday, easily\./)
  } finally {
    clearTestDb()
    db.close()
  }
})

test('ask: fenced or JSON-shaped answers are unwrapped, dashes normalized', async () => {
  const db = freshDb()
  seedWeek(db)
  setTestDb(db)
  __setSettings({ aiProvider: 'anthropic' })
  await setApiKey('anthropic', 'test-key')

  registerWrappedQuestionProvider(async () => ({ text: '```json\n{"answer": "Mostly the rework — about 7h."}\n```', usage: null }))

  try {
    const result = await askWrappedQuestion({
      cadence: 'week', periodKey: '2026-06-24', slideId: 'apps', slideLine: null, question: 'Where did Tuesday go?',
    })
    assert.equal(result.error, null)
    assert.ok(result.answer)
    assert.doesNotMatch(result.answer!, /[—–]/, 'em dash leaked through')
    assert.match(result.answer!, /rework/)
  } finally {
    clearTestDb()
    db.close()
  }
})
