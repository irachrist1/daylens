// Capture-gap honesty detector — pure functions, no Electron/DB access.
//
// The Jul 7 incident: the tracker recorded nothing from 00:29 to 11:15 local
// (a ~10.8h wall gap), but the monotonic clock — which pauses while macOS is
// asleep — only advanced ~5.0h across that gap. That means the Mac was
// actually asleep for ~5.8h and *awake but unrecorded* for ~5h: real usage
// the tracker silently missed. That distinction is the whole point of this
// module: `asleep` gaps are invisible by design and safe to stay silent
// about, `blind` gaps are a tracker failure and the wrap must say so plainly.
//
// See docs/specs/wrapped-agent-plan.md, "Capture-gap honesty".

export type GapVerdict = 'asleep' | 'blind' | 'unknown'

export interface CaptureGap {
  startMs: number
  endMs: number
  wallSeconds: number
  /** Wall-clock seconds the machine was actually awake, derived from the
   * monotonic delta across the gap's edge events (clamped to [0, wallSeconds]).
   * Zero for a leading or trailing gap, which has a monotonic reading on only
   * one side and so cannot be diffed. */
  awakeSeconds: number
  verdict: GapVerdict
}

export interface CaptureHealthInput {
  /** focus_events rows (ts_ms + mono_ns), sorted ascending by tsMs. */
  edgeEvents: Array<{ tsMs: number; monoNs: number }>
  /** activity_state_events rows within (or overlapping) the range. */
  stateEvents: Array<{ tsMs: number; eventType: string }>
  rangeStartMs: number
  rangeEndMs: number
  /** Minimum wall-clock gap to report, in ms. Default 45 minutes. */
  minGapMs?: number
}

export interface CaptureHealthReport {
  gaps: CaptureGap[]
  coverage: 'full' | 'partial' | 'none'
  /** Sum of awakeSeconds over gaps verdicted 'blind' — real, unrecorded usage. */
  blindSeconds: number
}

const DEFAULT_MIN_GAP_MS = 45 * 60_000
const ASLEEP_RATIO = 0.3
const BLIND_RATIO = 0.7
const SUBSTANTIAL_AWAKE_SECONDS = 2 * 60 * 60 // 2h

function hasStateEventInRange(
  stateEvents: Array<{ tsMs: number; eventType: string }>,
  startMs: number,
  endMs: number,
  matcher: (eventType: string) => boolean,
): boolean {
  return stateEvents.some((e) => e.tsMs >= startMs && e.tsMs <= endMs && matcher(e.eventType))
}

function isSleepOrLock(eventType: string): boolean {
  const t = eventType.toLowerCase()
  return t.includes('sleep') || t.includes('lock')
}

function verdictFromStateEvents(
  stateEvents: Array<{ tsMs: number; eventType: string }>,
  startMs: number,
  endMs: number,
): GapVerdict {
  return hasStateEventInRange(stateEvents, startMs, endMs, isSleepOrLock) ? 'asleep' : 'unknown'
}

function verdictForInteriorGap(
  wallSeconds: number,
  awakeSeconds: number,
  stateEvents: Array<{ tsMs: number; eventType: string }>,
  startMs: number,
  endMs: number,
): GapVerdict {
  if (wallSeconds <= 0) return 'unknown'
  const ratio = awakeSeconds / wallSeconds
  if (ratio < ASLEEP_RATIO) return 'asleep'
  if (ratio > BLIND_RATIO) return 'blind'
  // Ambiguous middle ground: substantial unrecorded awake time still counts
  // as blind even if the machine was also partly asleep during the gap.
  if (awakeSeconds >= SUBSTANTIAL_AWAKE_SECONDS) return 'blind'
  return verdictFromStateEvents(stateEvents, startMs, endMs)
}

export function assessCaptureHealth(input: CaptureHealthInput): CaptureHealthReport {
  const minGapMs = input.minGapMs ?? DEFAULT_MIN_GAP_MS
  const { rangeStartMs, rangeEndMs, stateEvents } = input
  const edgeEvents = [...input.edgeEvents].sort((a, b) => a.tsMs - b.tsMs)
  const inRange = edgeEvents.filter((e) => e.tsMs >= rangeStartMs && e.tsMs <= rangeEndMs)

  if (inRange.length === 0) {
    return { gaps: [], coverage: 'none', blindSeconds: 0 }
  }

  const gaps: CaptureGap[] = []

  // Leading gap: rangeStart -> first event. No monotonic reading before the
  // range starts, so verdict comes from state events only.
  const first = inRange[0]
  const leadingWallMs = first.tsMs - rangeStartMs
  if (leadingWallMs >= minGapMs) {
    const wallSeconds = leadingWallMs / 1000
    gaps.push({
      startMs: rangeStartMs,
      endMs: first.tsMs,
      wallSeconds,
      awakeSeconds: 0,
      verdict: verdictFromStateEvents(stateEvents, rangeStartMs, first.tsMs),
    })
  }

  // Interior gaps between consecutive edge events.
  for (let i = 0; i < inRange.length - 1; i++) {
    const before = inRange[i]
    const after = inRange[i + 1]
    const wallMs = after.tsMs - before.tsMs
    if (wallMs < minGapMs) continue
    const wallSeconds = wallMs / 1000
    const monoDeltaSeconds = (after.monoNs - before.monoNs) / 1e9
    const awakeSeconds = Math.min(Math.max(monoDeltaSeconds, 0), wallSeconds)
    gaps.push({
      startMs: before.tsMs,
      endMs: after.tsMs,
      wallSeconds,
      awakeSeconds,
      verdict: verdictForInteriorGap(wallSeconds, awakeSeconds, stateEvents, before.tsMs, after.tsMs),
    })
  }

  // Trailing gap: last event -> rangeEnd. No monotonic reading after the
  // range ends, so verdict comes from state events only.
  const last = inRange[inRange.length - 1]
  const trailingWallMs = rangeEndMs - last.tsMs
  if (trailingWallMs >= minGapMs) {
    const wallSeconds = trailingWallMs / 1000
    gaps.push({
      startMs: last.tsMs,
      endMs: rangeEndMs,
      wallSeconds,
      awakeSeconds: 0,
      verdict: verdictFromStateEvents(stateEvents, last.tsMs, rangeEndMs),
    })
  }

  gaps.sort((a, b) => a.startMs - b.startMs)

  const coverage: CaptureHealthReport['coverage'] = gaps.length === 0 ? 'full' : 'partial'
  const blindSeconds = gaps
    .filter((g) => g.verdict === 'blind')
    .reduce((sum, g) => sum + g.awakeSeconds, 0)

  return { gaps, coverage, blindSeconds }
}
