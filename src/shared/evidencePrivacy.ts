import {
  isAppExcluded,
  isSiteExcluded,
  type TrackingControlsState,
} from './trackingControls'
import { isSystemNoiseApp } from './systemNoise'

type JsonRecord = Record<string, unknown>

function asString(record: JsonRecord, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

function domainFromRecord(record: JsonRecord): string | null {
  const direct = asString(record, 'domain', 'host')
  if (direct) return direct
  const rawUrl = asString(record, 'url', 'normalizedUrl')
  if (!rawUrl) return null
  try {
    return new URL(rawUrl).hostname
  } catch {
    return null
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Bounded match so a short exclusion like "Arc" redacts "Arc was open" but
// never "architecture". The token must sit on a word boundary (start/end or a
// non-alphanumeric neighbour). Tokens under 3 chars are too noisy to redact.
function containsBoundedToken(value: string, rawToken: string): boolean {
  const token = rawToken.trim().toLowerCase().replace(/^www\./, '')
  if (token.length < 3) return false
  return new RegExp(`(^|[^a-z0-9])${escapeRegex(token)}(?=$|[^a-z0-9])`, 'i').test(value)
}

// A site exclusion has to redact more than the literal host: derived block
// labels and page titles name the brand, not the domain ("Watching YouTube",
// "… - YouTube"), so excluding "youtube.com" must also redact the bare token
// "youtube". We expand a registrable 2-label host (brand.tld) to its leading
// label; a multi-label host is a specific subdomain the user targeted, so we
// keep only the full host to avoid nuking the parent brand (excluding
// "docs.google.com" must not redact every "Google"). Bounded matching still
// applies, so "youtube" never touches "youtuber".
function siteExclusionTokens(entry: string): string[] {
  const host = entry.trim().toLowerCase().replace(/^www\./, '')
  if (!host) return []
  const tokens = [host]
  const labels = host.split('.')
  if (labels.length === 2 && labels[0].length >= 3) tokens.push(labels[0])
  return tokens
}

function containsExcludedText(value: string, controls: TrackingControlsState): boolean {
  return controls.excludedApps.some((entry) => containsBoundedToken(value, entry))
    || controls.excludedSites.some((entry) =>
      siteExclusionTokens(entry).some((token) => containsBoundedToken(value, token)))
}

function filterValue(value: unknown, controls: TrackingControlsState): unknown {
  if (typeof value === 'string') {
    return containsExcludedText(value, controls) ? '[excluded]' : value
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => filterValue(entry, controls))
      .filter((entry) => entry !== null)
  }
  if (!value || typeof value !== 'object') return value

  const record = value as JsonRecord
  const bundleId = asString(record, 'bundleId', 'appBundleId', 'browserBundleId', 'ownerBundleId')
  const canonicalAppId = asString(record, 'canonicalAppId', 'canonicalBrowserId')
  const appName = asString(record, 'appName', 'application', 'ownerAppName', 'displayName')
  if (isSystemNoiseApp({ bundleId, appName })) return null
  if (isAppExcluded(controls, { bundleId, canonicalAppId, appName })) return null

  const domain = domainFromRecord(record)
  if (domain && isSiteExcluded(controls, { domain })) return null

  const filtered: JsonRecord = {}
  for (const [key, entry] of Object.entries(record)) {
    const next = filterValue(entry, controls)
    if (next !== null) filtered[key] = next
  }
  return filtered
}

/**
 * Last-line privacy boundary for anything leaving the local resolver layer.
 * Capture-time deletion remains the source-of-truth fix; this prevents a purge
 * miss, stale projection, or legacy row from reaching AI/MCP providers.
 *
 * System noise is always stripped (even with controls off); user exclusions
 * apply only when Tracking Controls is enabled with a non-empty list.
 */
export function filterTrackingExcludedEvidence(
  value: unknown,
  controls: TrackingControlsState,
): unknown {
  if (!controls.enabled || (controls.excludedApps.length === 0 && controls.excludedSites.length === 0)) {
    return filterValue(value, { ...controls, excludedApps: [], excludedSites: [] })
  }
  return filterValue(value, controls)
}
