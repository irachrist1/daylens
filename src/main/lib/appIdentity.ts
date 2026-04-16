import fs from 'node:fs'
import path from 'node:path'
import type { AppCategory } from '@shared/types'

interface NormalizationEntry {
  displayName: string
  defaultCategory: AppCategory
}

interface NormalizationMap {
  aliases: Record<string, string>
  catalog: Record<string, NormalizationEntry>
}

export interface CanonicalAppIdentity {
  canonicalAppId: string | null
  appInstanceId: string
  displayName: string
  rawAppName: string
  defaultCategory: AppCategory | null
}

let cachedNormalizationMap: NormalizationMap | null = null

function normalizationCandidates(): string[] {
  return [
    ...(typeof process !== 'undefined' && process.resourcesPath
      ? [path.join(process.resourcesPath, 'app-normalization.v1.json')]
      : []),
    path.join(__dirname, '..', '..', 'shared', 'app-normalization.v1.json'),
    path.join(process.cwd(), 'shared', 'app-normalization.v1.json'),
  ]
}

function loadNormalizationMap(): NormalizationMap {
  if (cachedNormalizationMap) return cachedNormalizationMap

  for (const candidate of normalizationCandidates()) {
    try {
      cachedNormalizationMap = JSON.parse(fs.readFileSync(candidate, 'utf8')) as NormalizationMap
      return cachedNormalizationMap
    } catch {
      // Try the next candidate.
    }
  }

  cachedNormalizationMap = { aliases: {}, catalog: {} }
  return cachedNormalizationMap
}

function stripExecutableSuffix(value: string): string {
  return value
    .replace(/\.exe$/i, '')
    .replace(/\.app$/i, '')
    .trim()
}

function basenameLower(value: string): string {
  const base = path.basename(value).trim()
  return base.toLowerCase()
}

export function resolveCanonicalApp(bundleId: string, appName: string): CanonicalAppIdentity {
  const map = loadNormalizationMap()
  const trimmedBundleId = bundleId.trim()
  const trimmedName = appName.trim() || stripExecutableSuffix(path.basename(trimmedBundleId)) || 'Unknown app'
  const bundleBase = basenameLower(trimmedBundleId)
  const bundleBaseNoExe = stripExecutableSuffix(bundleBase).toLowerCase()
  const lowerName = trimmedName.toLowerCase()
  const lowerNameNoExe = stripExecutableSuffix(trimmedName).toLowerCase()

  const candidates = [
    trimmedBundleId,
    trimmedBundleId.toLowerCase(),
    bundleBase,
    bundleBaseNoExe,
    lowerName,
    lowerNameNoExe,
  ].filter(Boolean)

  let canonicalAppId: string | null = null
  for (const candidate of candidates) {
    const resolved = map.aliases[candidate] ?? map.aliases[candidate.toLowerCase()]
    if (resolved) {
      canonicalAppId = resolved
      break
    }
  }

  const catalogEntry = canonicalAppId ? map.catalog[canonicalAppId] : null
  return {
    canonicalAppId,
    appInstanceId: trimmedBundleId || lowerNameNoExe || trimmedName,
    displayName: catalogEntry?.displayName ?? trimmedName,
    rawAppName: trimmedName,
    defaultCategory: catalogEntry?.defaultCategory ?? null,
  }
}

export function resolveCanonicalBrowser(browserBundleId: string | null | undefined): {
  canonicalBrowserId: string | null
  browserProfileId: string | null
} {
  if (!browserBundleId) {
    return {
      canonicalBrowserId: null,
      browserProfileId: null,
    }
  }

  const [baseId, profilePart] = browserBundleId.split(':', 2)
  const identity = resolveCanonicalApp(baseId, baseId)
  return {
    canonicalBrowserId: identity.canonicalAppId,
    browserProfileId: profilePart?.trim() || 'default',
  }
}

export function normalizeUrlForStorage(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null

  try {
    const url = new URL(rawUrl)
    url.hash = ''

    const filteredParams = new URLSearchParams()
    for (const [key, value] of url.searchParams.entries()) {
      if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) continue
      filteredParams.append(key, value)
    }
    url.search = filteredParams.toString()

    const normalizedPath = url.pathname.replace(/\/+$/, '') || '/'
    return `${url.protocol}//${url.host}${normalizedPath}${url.search ? `?${url.searchParams.toString()}` : ''}`
  } catch {
    return null
  }
}

export function pageKeyForUrl(rawUrl: string | null | undefined): string | null {
  const normalizedUrl = normalizeUrlForStorage(rawUrl)
  if (!normalizedUrl) return null

  try {
    const url = new URL(normalizedUrl)
    return `${url.host}${url.pathname}`.replace(/\/+$/, '') || url.host
  } catch {
    return normalizedUrl
  }
}

export function titleLooksUseful(rawTitle: string | null | undefined): rawTitle is string {
  if (!rawTitle) return false
  const title = rawTitle.trim()
  if (!title) return false
  if (/^(new tab|untitled|home|start page)$/i.test(title)) return false
  if (title.length < 3) return false
  return true
}
