// Pause vs cancel at the abort registry (DEV-200). Both stop the provider
// stream through the SAME AbortController — the difference is how the turn
// settles: a pause is flagged so sendMessage persists a resumable checkpoint,
// a cancel stays a discard. Cancel remains distinct and always wins.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AI_PAUSED_MESSAGE,
  cancelAIRequest,
  consumePauseRequest,
  isPausedError,
  pauseAIRequest,
  pausedError,
  registerAICancellation,
  unregisterAICancellation,
} from '../src/main/lib/aiCancellation.ts'

test('pauseAIRequest aborts the controller AND flags the turn as paused', () => {
  const controller = new AbortController()
  registerAICancellation('req-p1', controller)
  try {
    assert.equal(pauseAIRequest('req-p1'), true)
    assert.equal(controller.signal.aborted, true)
    assert.equal(consumePauseRequest('req-p1'), true)
    // The flag is consumed exactly once — a second settle sees a plain abort.
    assert.equal(consumePauseRequest('req-p1'), false)
  } finally {
    unregisterAICancellation('req-p1', controller)
  }
})

test('cancel is not a pause: no flag is set, so the turn settles as cancelled', () => {
  const controller = new AbortController()
  registerAICancellation('req-p2', controller)
  try {
    assert.equal(cancelAIRequest('req-p2'), true)
    assert.equal(consumePauseRequest('req-p2'), false)
  } finally {
    unregisterAICancellation('req-p2', controller)
  }
})

test('an explicit Stop after a Pause is a decision: cancel clears the pause flag', () => {
  const controller = new AbortController()
  registerAICancellation('req-p3', controller)
  try {
    assert.equal(pauseAIRequest('req-p3'), true)
    assert.equal(cancelAIRequest('req-p3'), true)
    assert.equal(consumePauseRequest('req-p3'), false, 'cancel must win — the turn is discarded, not resumable')
  } finally {
    unregisterAICancellation('req-p3', controller)
  }
})

test('pausing an unknown or settled turn is a safe no-op', () => {
  assert.equal(pauseAIRequest('never-registered'), false)
  const controller = new AbortController()
  registerAICancellation('req-p4', controller)
  unregisterAICancellation('req-p4', controller)
  assert.equal(pauseAIRequest('req-p4'), false)
  // Unregister also drops any stale pause flag.
  assert.equal(consumePauseRequest('req-p4'), false)
})

test('the paused settle error is recognizable and distinct from cancellation', () => {
  const paused = pausedError()
  assert.equal(paused.message, AI_PAUSED_MESSAGE)
  assert.ok(isPausedError(paused))
  assert.equal(isPausedError(new Error('Generation stopped.')), false)
  assert.equal(consumePauseRequest(null), false)
})
