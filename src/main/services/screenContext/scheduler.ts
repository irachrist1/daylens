// Screen-context experiment (DEV-197) — the capture gate and sampling
// scheduler, pure and clock-injected so every rate, power, and privacy
// boundary is provable in the terminal harness.
//
// Order matters and is deliberate: privacy boundaries (consent, pause,
// exclusion, private windows, protected surfaces, sharing) come BEFORE any
// rate or power question, so nothing sensitive is ever "allowed but
// rate-limited" — it is refused outright, before capture.

import {
  SCREEN_CONTEXT_POLICY,
  type ScreenCaptureBlockReason,
  type ScreenCaptureGateDecision,
  type ScreenCaptureGateContext,
  type ScreenSamplingEnvironment,
  type ScreenFrameTrigger,
} from './types'

/** The privacy gate: every reason sampling must stop before capture, in the
 *  order the specification lists them. Pure — the caller resolves the facts. */
export function evaluateCaptureGate(context: ScreenCaptureGateContext): ScreenCaptureGateDecision {
  const blocked = (reason: ScreenCaptureBlockReason): ScreenCaptureGateDecision => ({ allowed: false, reason })
  if (!context.consentEnabled) return blocked('consent_missing')
  if (context.trackingPaused) return blocked('tracking_paused')
  if (context.screenContextPaused) return blocked('screen_context_paused')
  if (context.foregroundExcluded) return blocked('excluded_app')
  if (context.privateBrowser === true || context.privateBrowser === 'unknown') {
    return blocked('private_browser')
  }
  if (context.protectedSurface) return blocked('protected_surface')
  if (context.screenShareActive) return blocked('screen_share')
  if (context.protectedMediaActive) return blocked('protected_media')
  return { allowed: true, reason: null }
}

/** Rate + power state the scheduler carries between decisions. */
export interface SamplingSchedulerState {
  /** Timestamps of automatic captures inside the trailing hour. */
  automaticCaptureTimesMs: number[]
  /** When the current foreground context became stable. */
  contextStableSinceMs: number | null
  /** Last automatic capture of the CURRENT context (bounded re-sampling). */
  lastSameContextCaptureMs: number | null
}

export function createSamplingSchedulerState(): SamplingSchedulerState {
  return { automaticCaptureTimesMs: [], contextStableSinceMs: null, lastSameContextCaptureMs: null }
}

export interface SamplingDecision {
  allowed: boolean
  reason: ScreenCaptureBlockReason | null
}

/** May an AUTOMATIC frame be taken right now? Diagnostic samples skip rate
 *  limits (the person explicitly asked) but never skip the privacy gate.
 *  Mutates nothing; call `recordCapture` after a frame actually lands. */
export function evaluateSamplingSchedule(
  state: SamplingSchedulerState,
  nowMs: number,
  trigger: ScreenFrameTrigger,
  environment: ScreenSamplingEnvironment,
): SamplingDecision {
  if (trigger === 'diagnostic') return { allowed: true, reason: null }

  // Power / attention backoff: on battery, under CPU pressure, locked, idle,
  // asleep, or a full-screen media/presentation surface — no sampling.
  if (
    environment.onBattery || environment.cpuPressure || environment.locked
    || environment.idle || environment.asleep || environment.fullScreenMedia
  ) {
    return { allowed: false, reason: 'power_backoff' }
  }

  // Stability: the foreground context must have been steady long enough.
  if (
    state.contextStableSinceMs == null
    || nowMs - state.contextStableSinceMs < SCREEN_CONTEXT_POLICY.STABILITY_MS
  ) {
    return { allowed: false, reason: 'context_not_stable' }
  }

  // Global automatic-rate floors and ceilings.
  const recent = state.automaticCaptureTimesMs.filter((t) => nowMs - t < 60 * 60 * 1000)
  const last = recent.length > 0 ? Math.max(...recent) : null
  if (last != null && nowMs - last < SCREEN_CONTEXT_POLICY.MIN_AUTOMATIC_INTERVAL_MS) {
    return { allowed: false, reason: 'rate_min_interval' }
  }
  if (recent.length >= SCREEN_CONTEXT_POLICY.MAX_FRAMES_PER_HOUR) {
    return { allowed: false, reason: 'rate_hourly_cap' }
  }

  // Bounded re-sampling of an unchanged context.
  if (
    trigger === 'interval'
    && state.lastSameContextCaptureMs != null
    && nowMs - state.lastSameContextCaptureMs < SCREEN_CONTEXT_POLICY.SAME_CONTEXT_INTERVAL_MS
  ) {
    return { allowed: false, reason: 'bounded_interval' }
  }

  return { allowed: true, reason: null }
}

/** The foreground context changed: stability restarts, bounded re-sampling
 *  resets with it. */
export function noteContextChange(state: SamplingSchedulerState, nowMs: number): void {
  state.contextStableSinceMs = nowMs
  state.lastSameContextCaptureMs = null
}

/** Record a capture that actually happened so the rate windows advance. */
export function recordCapture(state: SamplingSchedulerState, nowMs: number, trigger: ScreenFrameTrigger): void {
  if (trigger === 'diagnostic') return
  state.automaticCaptureTimesMs = [
    ...state.automaticCaptureTimesMs.filter((t) => nowMs - t < 60 * 60 * 1000),
    nowMs,
  ]
  state.lastSameContextCaptureMs = nowMs
}
