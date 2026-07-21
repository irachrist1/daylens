// Screen-context experiment (DEV-197) — the settings-derived half of the
// capture gate. The runtime half (private windows, protected surfaces, screen
// sharing) is resolved by the capture adapter at sample time; this half is the
// consent/pause/exclusion state, resolved through the SAME Tracking Controls
// vocabulary normal capture uses, so a person's exclusions bind screen
// sampling identically.

import type { AppSettings } from '@shared/types'
import {
  isAppExcluded,
  isSiteExcluded,
  trackingControlsStateFromSettings,
  type AppCaptureCandidate,
  type SiteCaptureCandidate,
} from '@shared/trackingControls'
import type { ScreenCaptureGateContext } from './types'

export interface ScreenContextForeground {
  bundleId: string | null
  appName: string | null
  domain?: string | null
  privateBrowser: boolean | 'unknown'
  protectedSurface: boolean
  screenShareActive: boolean
  protectedMediaActive: boolean
}

/** True when the screen-context experiment has explicit, current consent.
 *  Enabling normal tracking never enables screen sampling: this flag is set
 *  only by the experiment's own consent flow, never by onboarding. */
export function screenContextConsentEnabled(settings: AppSettings): boolean {
  return settings.screenContextExperimentEnabled === true
}

export function buildScreenCaptureGateContext(
  settings: AppSettings,
  foreground: ScreenContextForeground,
): ScreenCaptureGateContext {
  const controls = trackingControlsStateFromSettings(settings)
  const appCandidate: AppCaptureCandidate = {
    bundleId: foreground.bundleId,
    appName: foreground.appName,
    windowTitle: null,
  }
  const siteCandidate: SiteCaptureCandidate | null = foreground.domain
    ? { domain: foreground.domain }
    : null
  const foregroundExcluded =
    isAppExcluded(controls, appCandidate)
    || (siteCandidate != null && isSiteExcluded(controls, siteCandidate))

  return {
    consentEnabled: screenContextConsentEnabled(settings),
    screenContextPaused: settings.screenContextPaused === true,
    trackingPaused: settings.trackingPaused === true,
    foregroundExcluded,
    privateBrowser: foreground.privateBrowser,
    protectedSurface: foreground.protectedSurface,
    screenShareActive: foreground.screenShareActive,
    protectedMediaActive: foreground.protectedMediaActive,
  }
}
