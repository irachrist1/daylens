import test from 'node:test'
import assert from 'node:assert/strict'
import { createLeadingTrailingThrottle } from '../src/main/lib/coalescer.ts'

// A manual clock + scheduler so the throttle is deterministic without real
// timers. `advance` fires any scheduled callback whose due time has passed.
function makeHarness() {
  let clock = 0
  const scheduled: { due: number; cb: () => void; cleared: boolean }[] = []
  const deps = {
    now: () => clock,
    schedule: (cb: () => void, ms: number) => {
      const entry = { due: clock + ms, cb, cleared: false }
      scheduled.push(entry)
      return {
        clear: () => {
          entry.cleared = true
        },
      }
    },
  }
  function advance(ms: number) {
    clock += ms
    for (const entry of scheduled) {
      if (!entry.cleared && entry.due <= clock) {
        entry.cleared = true
        entry.cb()
      }
    }
  }
  return { deps, advance }
}

test('leading edge fires immediately on the first call', () => {
  const { deps } = makeHarness()
  const calls: string[] = []
  const throttled = createLeadingTrailingThrottle((x: string) => calls.push(x), 15_000, deps)

  throttled('a')
  assert.deepEqual(calls, ['a'])
})

test('a burst coalesces into one trailing call with the latest args', () => {
  const { deps, advance } = makeHarness()
  const calls: string[] = []
  const throttled = createLeadingTrailingThrottle((x: string) => calls.push(x), 15_000, deps)

  throttled('a') // leading, fires now
  advance(1_000)
  throttled('b') // within window, coalesced
  advance(1_000)
  throttled('c') // within window, replaces 'b'
  assert.deepEqual(calls, ['a'], 'only the leading call has fired so far')

  advance(15_000) // window closes -> trailing fires with the most recent args
  assert.deepEqual(calls, ['a', 'c'])
})

test('a call after the window elapses fires immediately again (leading)', () => {
  const { deps, advance } = makeHarness()
  const calls: string[] = []
  const throttled = createLeadingTrailingThrottle((x: string) => calls.push(x), 15_000, deps)

  throttled('a')
  advance(20_000) // well past the window with nothing pending
  throttled('b')
  assert.deepEqual(calls, ['a', 'b'])
})

test('20 rapid calls collapse to 2 invocations (leading + one trailing)', () => {
  const { deps, advance } = makeHarness()
  const calls: number[] = []
  const throttled = createLeadingTrailingThrottle((x: number) => calls.push(x), 15_000, deps)

  for (let i = 0; i < 20; i++) {
    throttled(i)
    advance(500) // 500ms apart -> all inside one 15s window
  }
  // Leading fired with 0; the rest coalesced.
  assert.equal(calls.length, 1)
  advance(15_000)
  assert.equal(calls.length, 2, 'one trailing call after the window')
  assert.equal(calls[0], 0)
  assert.equal(calls[1], 19, 'trailing call carries the most recent args')
})

test('flush fires the pending trailing call now', () => {
  const { deps, advance } = makeHarness()
  const calls: string[] = []
  const throttled = createLeadingTrailingThrottle((x: string) => calls.push(x), 15_000, deps)

  throttled('a')
  advance(1_000)
  throttled('b')
  throttled.flush()
  assert.deepEqual(calls, ['a', 'b'])
})

test('cancel drops the pending trailing call', () => {
  const { deps, advance } = makeHarness()
  const calls: string[] = []
  const throttled = createLeadingTrailingThrottle((x: string) => calls.push(x), 15_000, deps)

  throttled('a')
  advance(1_000)
  throttled('b')
  throttled.cancel()
  advance(15_000)
  assert.deepEqual(calls, ['a'], 'cancelled trailing call never fires')
})
