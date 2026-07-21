// Fix your day by telling the agent (DEV-199): the propose_correction /
// undo_correction chat tools ride the EXISTING corrections machinery
// (previewCorrection → askUser confirmation card → applyCorrection → undo)
// and never write silently. What must hold:
//   - the confirmation card shows the real preview (the savepoint dry-run's
//     description and deltas), before anything is written;
//   - only an explicit confirmation applies; cancel, silence, and free text
//     all leave the day untouched (free text is the user's adjustment, handed
//     back to the model — never consent);
//   - an applied correction is a real correction: durable, visible in the
//     corrected projection, in the undo ledger, and undoable;
//   - invalid input returns an explicit { found: false } miss, never a throw;
//   - the production hooks fire (pre-merge flush, post-apply invalidation).
import test from 'node:test'
import assert from 'node:assert/strict'
import type Database from 'better-sqlite3'
import type { AppCategory, CorrectionCommand } from '../src/shared/types.ts'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import {
  buildCorrectionTools,
  renderCorrectionPreviewCard,
  toCorrectionCommand,
  type CorrectionToolDeps,
} from '../src/main/agent/correctionTools.ts'
import { applyCorrection, previewCorrection } from '../src/main/services/correctionCommands.ts'
import { getTimelineDayPayload } from '../src/main/services/workBlocks.ts'
import type { AgentQuestion } from '../src/main/agent/interactionTools.ts'

const TEST_DATE = '2026-04-22'

function localMs(hour: number, minute = 0): number {
  return new Date(2026, 3, 22, hour, minute, 0, 0).getTime()
}

function insertSession(
  db: Database.Database,
  payload: { title: string; startMinute: number; durationMinutes: number; category?: AppCategory },
): void {
  const startTime = localMs(9, payload.startMinute)
  const endTime = startTime + payload.durationMinutes * 60_000
  db.prepare(`
    INSERT INTO app_sessions (
      bundle_id, app_name, start_time, end_time, duration_sec,
      category, is_focused, window_title, raw_app_name, capture_source, capture_version
    ) VALUES ('com.google.Chrome', 'Google Chrome', ?, ?, ?, ?, 1, ?, 'Google Chrome', 'test', 1)
  `).run(startTime, endTime, payload.durationMinutes * 60, payload.category ?? 'browsing', payload.title)
}

function seedTwoTopicDay(db: Database.Database): void {
  insertSession(db, { title: 'Camera comparison research - DPReview - Google Chrome', startMinute: 0, durationMinutes: 25 })
  insertSession(db, { title: 'City council election results - Local News - Google Chrome', startMinute: 25, durationMinutes: 25 })
}

interface Harness {
  db: Database.Database
  tools: ReturnType<typeof buildCorrectionTools>
  questions: AgentQuestion[]
  hookCalls: { beforeApply: CorrectionCommand[]; applied: string[] }
}

function harness(db: Database.Database, answer: string | ((q: AgentQuestion) => string)): Harness {
  const questions: AgentQuestion[] = []
  const hookCalls: Harness['hookCalls'] = { beforeApply: [], applied: [] }
  const deps: CorrectionToolDeps = {
    db,
    askUser: async (question) => {
      questions.push(question)
      return typeof answer === 'function' ? answer(question) : answer
    },
    hooks: {
      resolveLiveSession: () => null,
      onBeforeApply: (command) => { hookCalls.beforeApply.push(command) },
      onApplied: (date) => { hookCalls.applied.push(date) },
    },
  }
  return { db, tools: buildCorrectionTools(deps), questions, hookCalls }
}

async function propose(h: Harness, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  // AI SDK v6 tool({ execute }) signature — same calling shape as agentTools.test.ts.
  return await (h.tools.propose_correction as unknown as {
    execute: (input: unknown, options: unknown) => Promise<Record<string, unknown>>
  }).execute(input, {})
}

async function undo(h: Harness, correctionId: string): Promise<Record<string, unknown>> {
  return await (h.tools.undo_correction as unknown as {
    execute: (input: unknown, options: unknown) => Promise<Record<string, unknown>>
  }).execute({ correctionId }, {})
}

function undoLogCount(db: Database.Database): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM correction_undo_log`).get() as { c: number }).c
}

// ─── The happy path: preview card → confirm → applied everywhere ─────────────

test('"that block was the ACME kickoff": the card shows the real preview, confirming applies, and the correction is undoable', async () => {
  const db = createProductionTestDatabase()
  seedTwoTopicDay(db)
  const target = getTimelineDayPayload(db, TEST_DATE).blocks[0]

  const h = harness(db, 'Apply correction')
  const outcome = await propose(h, {
    action: 'rename', date: TEST_DATE, blockId: target.id, label: 'ACME kickoff meeting',
  })

  // The card the person saw IS the machinery's preview: description + deltas.
  assert.equal(h.questions.length, 1)
  assert.match(h.questions[0].question, /Rename/)
  assert.match(h.questions[0].question, /ACME kickoff meeting/)
  assert.ok(h.questions[0].question.includes(target.label.current))
  assert.deepEqual(h.questions[0].options, ['Apply correction', 'Cancel'])

  assert.equal(outcome.applied, true)
  assert.equal(typeof outcome.correctionId, 'string')

  // The correction is real product data: the corrected projection shows it,
  // the undo ledger has it, and the production hooks fired.
  const after = getTimelineDayPayload(db, TEST_DATE)
  assert.equal(after.blocks[0].label.current, 'ACME kickoff meeting')
  assert.equal(undoLogCount(db), 1)
  assert.deepEqual(h.hookCalls.applied, [TEST_DATE])

  // …and it is undoable through the agent, behind its own confirmation.
  const undoHarness = harness(db, 'Undo it')
  const undone = await undo(undoHarness, outcome.correctionId as string)
  assert.equal(undone.undone, true)
  assert.equal(getTimelineDayPayload(db, TEST_DATE).blocks[0].label.current, target.label.current)
  db.close()
})

test('the preview card renders the same deltas previewCorrection computes', () => {
  const db = createProductionTestDatabase()
  seedTwoTopicDay(db)
  const target = getTimelineDayPayload(db, TEST_DATE).blocks[0]
  const preview = previewCorrection(db, {
    kind: 'edit', date: TEST_DATE, blockId: target.id, label: 'ACME kickoff meeting',
  }, null)
  const card = renderCorrectionPreviewCard(preview)
  assert.ok(card.startsWith(`${preview.description}.`))
  assert.match(card, /ACME kickoff meeting/)
  assert.match(card, /Reversible/)
  for (const surface of preview.surfaces) assert.ok(card.includes(surface))
  db.close()
})

// ─── No confirmation, no write ────────────────────────────────────────────────

test('cancel, silence, and free text all leave the day untouched', async () => {
  const db = createProductionTestDatabase()
  seedTwoTopicDay(db)
  const target = getTimelineDayPayload(db, TEST_DATE).blocks[0]
  const originalLabel = target.label.current

  for (const [answer, expectNote] of [
    ['Cancel', false],
    ['(No answer is available right now — pick the most defensible reading.)', false],
    ['actually call it Lunch instead', true],
  ] as Array<[string, boolean]>) {
    const h = harness(db, answer)
    const outcome = await propose(h, {
      action: 'rename', date: TEST_DATE, blockId: target.id, label: 'ACME kickoff meeting',
    })
    assert.equal(outcome.applied, false, `answer "${answer}" must not apply`)
    if (expectNote) {
      // Free text is the user's adjustment, surfaced back to the model —
      // never treated as consent.
      assert.equal(outcome.userNote, 'actually call it Lunch instead')
    }
    assert.equal(getTimelineDayPayload(db, TEST_DATE).blocks[0].label.current, originalLabel)
    assert.equal(undoLogCount(db), 0)
    assert.equal(h.hookCalls.applied.length, 0)
  }
  db.close()
})

test('undo keeps the correction when the user answers "Keep it"', async () => {
  const db = createProductionTestDatabase()
  seedTwoTopicDay(db)
  const target = getTimelineDayPayload(db, TEST_DATE).blocks[0]
  const applyHarness = harness(db, 'Apply correction')
  const outcome = await propose(applyHarness, {
    action: 'rename', date: TEST_DATE, blockId: target.id, label: 'ACME kickoff meeting',
  })
  const keepHarness = harness(db, 'Keep it')
  const kept = await undo(keepHarness, outcome.correctionId as string)
  assert.equal(kept.undone, false)
  assert.equal(getTimelineDayPayload(db, TEST_DATE).blocks[0].label.current, 'ACME kickoff meeting')
  db.close()
})

// ─── "I was at lunch 12–1" shape: category + time corrections ────────────────

test('change_category applies through the same confirmed path', async () => {
  const db = createProductionTestDatabase()
  seedTwoTopicDay(db)
  const target = getTimelineDayPayload(db, TEST_DATE).blocks[0]
  const h = harness(db, 'Apply correction')
  const outcome = await propose(h, {
    action: 'change_category', date: TEST_DATE, blockId: target.id, category: 'entertainment',
  })
  assert.equal(outcome.applied, true)
  assert.equal(getTimelineDayPayload(db, TEST_DATE).blocks[0].dominantCategory, 'entertainment')
  db.close()
})

test('exclude_block removes the stretch from the corrected day after confirmation', async () => {
  const db = createProductionTestDatabase()
  seedTwoTopicDay(db)
  const before = getTimelineDayPayload(db, TEST_DATE)
  const target = before.blocks[0]
  const h = harness(db, 'Apply correction')
  const outcome = await propose(h, { action: 'exclude_block', date: TEST_DATE, blockId: target.id })
  assert.equal(outcome.applied, true)
  const after = getTimelineDayPayload(db, TEST_DATE)
  assert.ok(after.blocks.length < before.blocks.length)
  assert.ok(!after.blocks.some((block) => block.id === target.id))
  assert.ok(after.totalSeconds < before.totalSeconds)
  db.close()
})

test('merge confirms, applies, and fires the pre-apply hook (session flush seam)', async () => {
  const db = createProductionTestDatabase()
  seedTwoTopicDay(db)
  const before = getTimelineDayPayload(db, TEST_DATE)
  assert.ok(before.blocks.length >= 2, 'fixture must produce two blocks')
  const h = harness(db, 'Apply correction')
  const outcome = await propose(h, {
    action: 'merge', date: TEST_DATE, blockIds: before.blocks.slice(0, 2).map((block) => block.id),
  })
  assert.equal(outcome.applied, true)
  assert.equal(h.hookCalls.beforeApply.length, 1)
  assert.equal(h.hookCalls.beforeApply[0].kind, 'merge')
  const after = getTimelineDayPayload(db, TEST_DATE)
  assert.ok(after.blocks.length < before.blocks.length)
  db.close()
})

// ─── Explicit misses, never throws ────────────────────────────────────────────

test('invalid input returns explicit misses the model can act on', async () => {
  const db = createProductionTestDatabase()
  seedTwoTopicDay(db)
  const target = getTimelineDayPayload(db, TEST_DATE).blocks[0]
  const h = harness(db, 'Apply correction')

  const noBlock = await propose(h, { action: 'rename', date: TEST_DATE, label: 'X' })
  assert.equal(noBlock.found, false)
  assert.match(String(noBlock.reason), /blockId/)

  const badCategory = await propose(h, { action: 'change_category', date: TEST_DATE, blockId: target.id, category: 'sleeping' })
  assert.equal(badCategory.found, false)

  const goneBlock = await propose(h, { action: 'rename', date: TEST_DATE, blockId: 'blk_gone', label: 'X' })
  assert.equal(goneBlock.found, false)
  assert.match(String(goneBlock.reason), /Block not found/)

  db.prepare(`INSERT INTO clients (id, name, created_at, updated_at) VALUES ('cl_1', 'ACME Corp', ?, ?)`).run(Date.now(), Date.now())
  const unknownClient = await propose(h, {
    action: 'assign_client', date: TEST_DATE, blockId: target.id, clientName: 'Globex',
  })
  assert.equal(unknownClient.found, false)
  assert.match(String(unknownClient.reason), /ACME Corp/, 'the miss names the real roster')

  // None of the misses ever showed a confirmation card.
  assert.equal(h.questions.length, 0)
  db.close()
})

// ─── Stale previews expire ────────────────────────────────────────────────────

test('a preview that no longer matches the day expires: confirming it applies nothing', async () => {
  const db = createProductionTestDatabase()
  seedTwoTopicDay(db)
  const target = getTimelineDayPayload(db, TEST_DATE).blocks[0]

  // While the card is on screen, the day changes underneath it: someone (the
  // Timeline UI, another correction) renames the same block.
  const h = harness(db, () => {
    applyCorrection(db, {
      kind: 'edit', date: TEST_DATE, blockId: target.id, label: 'Renamed while the card sat open',
    }, null)
    return 'Apply correction'
  })
  const outcome = await propose(h, {
    action: 'rename', date: TEST_DATE, blockId: target.id, label: 'ACME kickoff meeting',
  })

  assert.equal(outcome.applied, false)
  assert.match(String(outcome.reason), /changed|expired/i)
  // The interfering correction is the one that stands; the agent's did not land.
  assert.equal(getTimelineDayPayload(db, TEST_DATE).blocks[0].label.current, 'Renamed while the card sat open')
  assert.equal(undoLogCount(db), 1, 'only the interfering correction is in the ledger')
  assert.equal(h.hookCalls.applied.length, 0)
  db.close()
})

test('toCorrectionCommand maps clock times into the local day', () => {
  const db = createProductionTestDatabase()
  const command = toCorrectionCommand(db, {
    action: 'split', date: TEST_DATE, blockId: 'blk_x', splitAt: '09:10',
  })
  assert.ok(!('found' in command))
  assert.equal((command as { cutMs: number }).cutMs, localMs(9, 10))
  db.close()
})
