// Screen-context experiment sampler (DEV-198; screen-context.md §Capture
// policy). The loop that decides WHEN a frame may be taken and asks the
// injected frame source to take it — every privacy boundary and rate cap
// applies here, BEFORE any pixel is read:
//
//   settings gate (consent, pause, exclusions — the same Tracking Controls
//   vocabulary normal capture uses) → runtime gate (private browser,
//   protected surface, sharing) → scheduler (stability, rate floors and
//   ceilings, power backoff) → backlog cap → capture.
//
// The OS screen API lives behind ONE seam (ScreenFrameSource): production
// injects the Electron adapter (ScreenCaptureKit on macOS / Graphics.Capture
// on Windows under the hood), tests inject a fake — the exact simulated path
// the DEV-197 lifecycle harness proved.
//
// Honesty guarantees baked in:
//   - a browser whose private-window state cannot be verified is treated as
//     'unknown' and therefore never sampled (spec: unknown blocks);
//   - a window title matching the credential patterns, or naming a password /
//     payment / keychain / permission surface, is a protected surface;
//   - the sampler reports active/inactive through one callback so the
//     persistent indicator can never disagree with what is running.
import type { AppSettings, LiveSession } from '@shared/types'
import { containsCredential } from '@shared/credentialPatterns'
import {
  buildScreenCaptureGateContext,
  type ScreenContextForeground,
} from './settingsGate'
import type { ScreenContextLifecycle } from './lifecycle'
import type { ScreenSamplingEnvironment, ScreenFrameTrigger } from './types'

/** The one OS seam: read the pixels of one display, or refuse with null
 *  (missing permission, no display, protected content). Never throws pixels
 *  into an error message. */
export interface ScreenFrameSource {
  /** Human name for status surfaces, e.g. 'macos-sck' / 'windows-wgc' / 'fake'. */
  readonly kind: string
  capture(displayId: number | null): Promise<Uint8Array | null>
}

export interface ForegroundSnapshot {
  session: LiveSession | null
  /** Domain of the foreground page when the foreground app is a browser and
   *  the page context is known; null otherwise. */
  domain: string | null
  /** True / false when verifiable; 'unknown' otherwise — unknown blocks. */
  privateBrowser: boolean | 'unknown'
  screenShareActive: boolean
  protectedMediaActive: boolean
  displayId: number | null
}

export interface ScreenContextSamplerDeps {
  lifecycle: ScreenContextLifecycle
  getSettings: () => AppSettings
  getForeground: () => ForegroundSnapshot
  getEnvironment: () => ScreenSamplingEnvironment
  source: ScreenFrameSource
  now?: () => number
  /** Persistent-indicator hook: called with true while the sampler runs with
   *  consent and not paused, false the moment that stops being true. */
  onActiveChange?: (active: boolean) => void
  /** Loop cadence; production uses a few seconds. */
  tickIntervalMs?: number
  /** Injected timer for tests. */
  scheduleTick?: (fn: () => void, ms: number) => NodeJS.Timeout
}

// Window titles that are themselves the protected surface — password,
// authentication, payment, keychain, permission, or OS security prompts.
// Deliberately broad: a false positive skips one frame; a false negative
// captures a password manager.
const PROTECTED_TITLE_RE = new RegExp(
  [
    'password', 'passphrase', 'passcode', 'one-?time code', '2fa', 'two-?factor',
    'verification code', 'sign[ -]?in', 'log[ -]?in', 'login', 'authenticat',
    'keychain', 'credential', 'vault', '1password', 'bitwarden', 'lastpass', 'keepass',
    'payment', 'checkout', 'billing', 'card number', 'cvv', 'iban',
    'system settings', 'system preferences', 'uac', 'sudo', 'permission',
  ].join('|'),
  'i',
)

export function isProtectedSurfaceTitle(title: string | null | undefined): boolean {
  if (!title) return false
  return PROTECTED_TITLE_RE.test(title) || containsCredential(title)
}

export interface SamplerTickResult {
  captured: boolean
  reason: string | null
}

export class ScreenContextSampler {
  private readonly deps: ScreenContextSamplerDeps
  private readonly now: () => number
  private timer: NodeJS.Timeout | null = null
  private lastActive = false
  private lastContextKey: string | null = null

  constructor(deps: ScreenContextSamplerDeps) {
    this.deps = deps
    this.now = deps.now ?? (() => Date.now())
  }

  /** Which adapter this sampler reads pixels through. */
  get sourceKind(): string {
    return this.deps.source.kind
  }

  /** True while the loop runs AND consent is current AND not paused — the one
   *  value the persistent indicator shows. */
  get active(): boolean {
    const settings = this.deps.getSettings()
    return this.timer != null
      && settings.screenContextExperimentEnabled === true
      && settings.screenContextPaused !== true
      && settings.trackingPaused !== true
  }

  start(): void {
    if (this.timer) return
    const interval = this.deps.tickIntervalMs ?? 5_000
    const schedule = this.deps.scheduleTick ?? ((fn, ms) => setInterval(fn, ms))
    this.timer = schedule(() => { void this.tick('interval') }, interval)
    if (typeof this.timer.unref === 'function') this.timer.unref()
    this.publishActive()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.publishActive()
  }

  /** Re-evaluate the indicator after a consent/pause settings change. */
  publishActive(): void {
    const active = this.active
    if (active !== this.lastActive) {
      this.lastActive = active
      this.deps.onActiveChange?.(active)
    }
  }

  private foregroundToGateInput(fg: ForegroundSnapshot): ScreenContextForeground {
    const title = fg.session?.windowTitle ?? null
    return {
      bundleId: fg.session?.bundleId ?? null,
      appName: fg.session?.appName ?? null,
      domain: fg.domain,
      privateBrowser: fg.privateBrowser,
      protectedSurface: isProtectedSurfaceTitle(title),
      screenShareActive: fg.screenShareActive,
      protectedMediaActive: fg.protectedMediaActive,
    }
  }

  /** One sampling decision + (maybe) one capture. Exposed for tests; the
   *  running loop calls it with 'interval'. */
  async tick(trigger: ScreenFrameTrigger): Promise<SamplerTickResult> {
    const settings = this.deps.getSettings()
    this.publishActive()
    const fg = this.deps.getForeground()
    if (!fg.session) return { captured: false, reason: 'no_foreground' }

    // Context-change bookkeeping feeds the scheduler's stability window.
    const contextKey = `${fg.session.bundleId}|${fg.session.windowTitle ?? ''}|${fg.domain ?? ''}`
    if (contextKey !== this.lastContextKey) {
      this.lastContextKey = contextKey
      this.deps.lifecycle.noteContextChange()
    }

    const gate = buildScreenCaptureGateContext(settings, this.foregroundToGateInput(fg))
    // The gate and scheduler refuse BEFORE any pixel is read; only an allowed
    // decision ever touches the frame source.
    const decision = this.deps.lifecycle.evaluateCapture(trigger, gate, this.deps.getEnvironment())
    if (!decision.allowed) return { captured: false, reason: decision.reason }

    const bytes = await this.deps.source.capture(fg.displayId)
    if (!bytes || bytes.byteLength === 0) {
      return { captured: false, reason: 'source_unavailable' }
    }
    const result = this.deps.lifecycle.captureFrame(
      { bytes, capturedAt: this.now(), trigger, appBundleId: fg.session.bundleId, appName: fg.session.appName, displayId: fg.displayId },
      gate,
      this.deps.getEnvironment(),
      { attemptAlreadyMeasured: true },
    )
    return { captured: result.captured, reason: result.reason }
  }

  /** The tester's explicit diagnostic sample: skips rate limits, never skips
   *  the privacy gate (scheduler already encodes that). */
  async requestDiagnosticSample(): Promise<SamplerTickResult> {
    return this.tick('diagnostic')
  }
}
