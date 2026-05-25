// Regression guards for work-block heuristics. Each case pins a specific
// shape produced by `getTimelineDayPayload` so a future heuristic change
// that re-introduces the legacy 60-minute fragmentation shows up here.
//
// Fixtures come from tests/ai-bench/fixtures.ts and are reused wholesale.
// The assertions are intentionally tight: block count + session coverage +
// visible label, not prose shape, so renderer-side copy changes never break
// this file.
import test from 'node:test'
import assert from 'node:assert/strict'
import { setupFixture } from './ai-bench/fixtures'
import { getTimelineDayPayload, userVisibleLabelForBlock } from '../src/main/services/workBlocks'

function localDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

test('longCursorSession stays as a single coherent block', () => {
  const { db, today } = setupFixture('longCursorSession')
  const payload = getTimelineDayPayload(db, localDateString(today), null)
  assert.equal(payload.blocks.length, 1, 'expected a single block for 3h uninterrupted Cursor session')
  const [block] = payload.blocks
  const visibleLabel = userVisibleLabelForBlock(block)
  assert.notEqual(visibleLabel, 'Untitled block', 'block must not degrade to Untitled block')
  assert.notEqual(visibleLabel, 'Development', 'block must not degrade to a generic category label')
  const spanMs = block.endTime - block.startTime
  assert.equal(spanMs, 3 * 60 * 60_000, 'expected 3h span')
  db.close()
})

test('longExcelReport stays as a single coherent block surfacing ASYV evidence', () => {
  const { db, today } = setupFixture('longExcelReport')
  const payload = getTimelineDayPayload(db, localDateString(today), null)
  assert.equal(payload.blocks.length, 1, 'expected a single block for 2h 45m uninterrupted Excel session')
  const [block] = payload.blocks
  const visible = userVisibleLabelForBlock(block)
  assert.notEqual(visible, 'Untitled block', 'expected a non-generic visible label')
  const titles = block.sessions.map((session) => session.windowTitle ?? '').join(' ').toLowerCase()
  assert.ok(titles.includes('asyv'), 'expected ASYV window-title evidence to survive')
  db.close()
})

test('codingDay no longer fragments the morning Cursor streak', () => {
  // Two Cursor sessions (9:00-11:30 and 13:30-16:15) separated by a 35m
  // Chrome interlude at 11:35-12:10 → expected: 3 blocks (Cursor/Chrome/Cursor).
  const { db, today } = setupFixture('codingDay')
  const payload = getTimelineDayPayload(db, localDateString(today), null)
  assert.equal(payload.blocks.length, 3, 'expected exactly 3 blocks on codingDay after coherent-ceiling change')
  const [morning, interlude, afternoon] = payload.blocks
  assert.equal(morning.endTime - morning.startTime, 2.5 * 60 * 60_000, 'morning Cursor block should span 2h 30m')
  assert.ok(interlude.dominantCategory === 'browsing', 'middle block should be the Chrome interlude')
  assert.equal(afternoon.endTime - afternoon.startTime, 2.75 * 60 * 60_000, 'afternoon Cursor block should span 2h 45m')
  db.close()
})

test('allDayChatGPT labels survive the coherent ceiling (no "Google Chrome" regression)', () => {
  const { db, today } = setupFixture('allDayChatGPT')
  const payload = getTimelineDayPayload(db, localDateString(today), null)
  assert.equal(payload.blocks.length, 2, 'expected ChatGPT and Claude to each form one block')
  const labels = payload.blocks.map((block) => block.label.current)
  for (const label of labels) {
    assert.notEqual(label, 'Google Chrome', 'block label must not fall back to the browser name')
    assert.notEqual(label, 'Untitled block', 'block label must not fall back to Untitled block')
  }
  db.close()
})

test('meetingHeavyDay still splits meetings and chat cleanly', () => {
  // Regression guard: the coherent ceiling must not accidentally merge
  // distinct meeting + communication blocks. Both Slack blocks are categorised
  // as 'communication' in the fixture (the Slack direct-message session uses
  // category='communication'), so this locks the 4-block shape and the
  // meeting/communication interleaving.
  const { db, today } = setupFixture('meetingHeavyDay')
  const payload = getTimelineDayPayload(db, localDateString(today), null)
  assert.equal(payload.blocks.length, 4, 'expected 4 blocks on meetingHeavyDay')
  const categories = payload.blocks.map((block) => block.dominantCategory)
  assert.deepEqual(
    categories,
    ['meetings', 'communication', 'meetings', 'communication'],
    'expected meetings and chat to keep splitting correctly',
  )
  db.close()
})
