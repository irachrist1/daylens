// T3 — Tracking Controls: user-controlled capture exclusions.
//
// Design invariant (owner decision 2026-05-31): the feature is OPT-IN and OFF by
// default. When disabled and not paused, every gate here is a strict passthrough,
// so capture stays byte-for-byte identical to today. Only an explicit master
// opt-in (plus an ad-hoc pause that works regardless of the switch) changes
// behavior. This is the hermetic core — no DB, no settings store — so it can be
// exhaustively unit-tested and reused by the foreground-app and website paths.

export interface TrackingControlsState {
  enabled: boolean
  paused: boolean
  excludedApps: string[] // bundle ids and/or app names (free-form, case-insensitive)
  excludedSites: string[] // hosts/domains (free-form, case-insensitive)
  skipIncognito: boolean
}

export interface AppCaptureCandidate {
  bundleId?: string | null
  canonicalAppId?: string | null
  appName?: string | null
  windowTitle?: string | null
}

export interface SiteCaptureCandidate {
  domain?: string | null
  windowTitle?: string | null
}

type CaptureBlockReason = 'paused' | 'excluded_app' | 'excluded_site' | 'incognito'

export interface CaptureDecision {
  capture: boolean
  reason: CaptureBlockReason | null
}

const ALLOW: CaptureDecision = { capture: true, reason: null }

// Window-title markers browsers append to private/incognito windows. Daylens has
// no structured incognito signal from the OS, so this title heuristic is the
// honest best-effort — it catches the common cross-browser cases (Chrome/Brave
// "Incognito", Edge "InPrivate", Firefox/Safari "Private Browsing").
const INCOGNITO_TITLE_RE = /\b(incognito|inprivate|private browsing|private window|private mode)\b/i

export function detectIncognitoFromTitle(windowTitle: string | null | undefined): boolean {
  return !!windowTitle && INCOGNITO_TITLE_RE.test(windowTitle)
}

function normalizeToken(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function normalizeHost(value: string | null | undefined): string {
  return normalizeToken(value).replace(/^www\./, '')
}

// An app matches an exclusion entry when the entry equals (case-insensitively)
// its bundle id, its bundle id without a browser-profile suffix
// (`com.google.Chrome:Profile 1` → `com.google.chrome`), its canonical app id,
// or its display name. Profile-aware matching means excluding "chrome" or the
// base bundle drops every profile variant, not just the one currently open.
export function isAppExcluded(state: TrackingControlsState, candidate: AppCaptureCandidate): boolean {
  if (!state.enabled || state.excludedApps.length === 0) return false
  const bundle = normalizeToken(candidate.bundleId)
  const baseBundle = bundle.split(':', 1)[0]
  const canonical = normalizeToken(candidate.canonicalAppId)
  const name = normalizeToken(candidate.appName)
  return state.excludedApps.some((entry) => {
    const e = normalizeToken(entry)
    return e !== '' && (e === bundle || e === baseBundle || e === canonical || e === name)
  })
}

// A site matches when the candidate host equals, or is a subdomain of, an
// excluded host — so excluding "youtube.com" also covers "m.youtube.com".
export function isSiteExcluded(state: TrackingControlsState, candidate: SiteCaptureCandidate): boolean {
  if (!state.enabled || state.excludedSites.length === 0) return false
  const host = normalizeHost(candidate.domain)
  if (!host) return false
  return state.excludedSites.some((entry) => {
    const e = normalizeHost(entry)
    return e !== '' && (host === e || host.endsWith(`.${e}`))
  })
}

// Foreground app-session gate. Pause applies regardless of the master switch;
// exclusions/incognito only when Tracking Controls is enabled.
export function decideAppCapture(state: TrackingControlsState, candidate: AppCaptureCandidate): CaptureDecision {
  if (state.paused) return { capture: false, reason: 'paused' }
  if (!state.enabled) return ALLOW
  if (isAppExcluded(state, candidate)) return { capture: false, reason: 'excluded_app' }
  if (state.skipIncognito && detectIncognitoFromTitle(candidate.windowTitle)) return { capture: false, reason: 'incognito' }
  return ALLOW
}

// Browser website-visit gate. The browser app itself is gated upstream by
// decideAppCapture; this drops a specific excluded domain (or incognito visit)
// while a non-excluded browser app keeps being tracked.
export function decideSiteCapture(state: TrackingControlsState, candidate: SiteCaptureCandidate): CaptureDecision {
  if (state.paused) return { capture: false, reason: 'paused' }
  if (!state.enabled) return ALLOW
  if (isSiteExcluded(state, candidate)) return { capture: false, reason: 'excluded_site' }
  if (state.skipIncognito && detectIncognitoFromTitle(candidate.windowTitle)) return { capture: false, reason: 'incognito' }
  return ALLOW
}

// Adapt AppSettings into the gate state (keeps this module free of the wider
// settings shape). Defaults match the opt-in contract: disabled, unpaused,
// empty lists, incognito-skip on (effective only once enabled).
export function trackingControlsStateFromSettings(s: {
  trackingControlsEnabled?: boolean
  trackingPaused?: boolean
  trackingExcludedApps?: string[]
  trackingExcludedSites?: string[]
  trackingSkipIncognito?: boolean
}): TrackingControlsState {
  return {
    enabled: Boolean(s.trackingControlsEnabled),
    paused: Boolean(s.trackingPaused),
    excludedApps: s.trackingExcludedApps ?? [],
    excludedSites: s.trackingExcludedSites ?? [],
    skipIncognito: s.trackingSkipIncognito ?? true,
  }
}
