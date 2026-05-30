// A leading + trailing throttle. The first call in a quiet window fires
// immediately (so the UI stays responsive to a single change); calls that
// arrive while the window is still open are coalesced into one trailing call
// at the end of the window, keeping only the most recent arguments.
//
// Used to stop a burst of capture flushes (one per app/window switch) from
// triggering a full-day timeline rebuild on every switch. See
// docs/PERF-COHERENCE-MAP.md §4. The clock and scheduler are injectable so the
// behaviour is unit-testable without real timers.

export interface Coalescer<A extends unknown[]> {
  (...args: A): void
  /** Fire any pending trailing call now. */
  flush(): void
  /** Drop any pending trailing call without firing. */
  cancel(): void
}

export interface ThrottleDeps {
  now?: () => number
  schedule?: (cb: () => void, ms: number) => { clear: () => void }
}

export function createLeadingTrailingThrottle<A extends unknown[]>(
  fn: (...args: A) => void,
  windowMs: number,
  deps: ThrottleDeps = {},
): Coalescer<A> {
  const now = deps.now ?? Date.now
  const schedule =
    deps.schedule ??
    ((cb: () => void, ms: number) => {
      const timer = setTimeout(cb, ms)
      // Don't let a pending invalidation hold the process open at quit.
      if (typeof (timer as { unref?: () => void }).unref === 'function') {
        ;(timer as { unref: () => void }).unref()
      }
      return { clear: () => clearTimeout(timer) }
    })

  let lastFiredAt = Number.NEGATIVE_INFINITY
  let pending: { args: A } | null = null
  let timer: { clear: () => void } | null = null

  function fire(args: A): void {
    lastFiredAt = now()
    fn(...args)
  }

  const call = ((...args: A) => {
    const elapsed = now() - lastFiredAt
    if (elapsed >= windowMs) {
      if (timer) {
        timer.clear()
        timer = null
      }
      pending = null
      fire(args)
      return
    }
    pending = { args }
    if (!timer) {
      timer = schedule(() => {
        timer = null
        if (pending) {
          const p = pending
          pending = null
          fire(p.args)
        }
      }, windowMs - elapsed)
    }
  }) as Coalescer<A>

  call.flush = () => {
    if (timer) {
      timer.clear()
      timer = null
    }
    if (pending) {
      const p = pending
      pending = null
      fire(p.args)
    }
  }

  call.cancel = () => {
    if (timer) {
      timer.clear()
      timer = null
    }
    pending = null
  }

  return call
}
