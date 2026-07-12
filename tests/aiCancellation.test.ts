// W1-C real cancel: the main-process cancellation plumbing.
// ai:cancel-message resolves a clientRequestId to the turn's AbortController,
// and the turn's signal rides an AsyncLocalStorage context so every provider
// call made anywhere inside the turn can be aborted without threading a
// parameter through every layer.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  abortError,
  cancelAIRequest,
  getAmbientAbortSignal,
  isAbortError,
  registerAICancellation,
  runWithAbortSignal,
  unregisterAICancellation,
} from '../src/main/lib/aiCancellation.ts'

test('cancelAIRequest aborts the registered controller and reports a hit', () => {
  const controller = new AbortController()
  registerAICancellation('req-1', controller)
  try {
    assert.equal(controller.signal.aborted, false)
    assert.equal(cancelAIRequest('req-1'), true)
    assert.equal(controller.signal.aborted, true)
  } finally {
    unregisterAICancellation('req-1', controller)
  }
})

test('cancelAIRequest on an unknown or already-settled turn is a safe no-op', () => {
  assert.equal(cancelAIRequest('never-registered'), false)
  const controller = new AbortController()
  registerAICancellation('req-2', controller)
  unregisterAICancellation('req-2', controller)
  assert.equal(cancelAIRequest('req-2'), false)
})

test('unregister only removes the exact controller it was given (no cross-turn clobber)', () => {
  const first = new AbortController()
  const second = new AbortController()
  registerAICancellation('req-3', first)
  registerAICancellation('req-3', second) // a newer turn reused the id
  unregisterAICancellation('req-3', first) // the OLD turn settling must not drop the new one
  assert.equal(cancelAIRequest('req-3'), true)
  assert.equal(second.signal.aborted, true)
  assert.equal(first.signal.aborted, false)
  unregisterAICancellation('req-3', second)
})

test('the ambient abort signal propagates across async boundaries inside the turn', async () => {
  const controller = new AbortController()
  const observed = await runWithAbortSignal(controller.signal, async () => {
    await new Promise((resolve) => setTimeout(resolve, 5))
    // Two layers down — where executeTextAIJob reads it.
    return (async () => getAmbientAbortSignal())()
  })
  assert.equal(observed, controller.signal)
  // Outside the context there is no ambient signal.
  assert.equal(getAmbientAbortSignal(), undefined)
})

test('an abort mid-turn is visible to later provider calls in the same turn', async () => {
  const controller = new AbortController()
  registerAICancellation('req-4', controller)
  try {
    const aborted = await runWithAbortSignal(controller.signal, async () => {
      // First "provider call" finishes, then the user hits Stop…
      cancelAIRequest('req-4')
      // …so the next call in the same turn must see an aborted signal.
      return getAmbientAbortSignal()?.aborted ?? false
    })
    assert.equal(aborted, true)
  } finally {
    unregisterAICancellation('req-4', controller)
  }
})

test('isAbortError recognizes SDK abort shapes and our own sentinel, nothing else', () => {
  const domAbort = new DOMException('This operation was aborted', 'AbortError')
  assert.equal(isAbortError(domAbort), true)
  const sdkAbort = Object.assign(new Error('Request was aborted.'), { name: 'APIUserAbortError' })
  assert.equal(isAbortError(sdkAbort), true)
  assert.equal(isAbortError(abortError()), true)
  assert.equal(isAbortError(new Error('rate limit exceeded')), false)
  assert.equal(isAbortError(null), false)
  assert.equal(isAbortError('aborted'), false)
})
