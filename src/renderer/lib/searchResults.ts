import type { DaylensSearchResult } from '../../preload/index'

// FB2: search lives inside ⌘K now. These are the pure helpers — query routing
// (literal FTS vs natural-language), row metadata, and de-dup/rank — kept out of
// the component so they can be unit-tested and reused.

export type SearchSourceKind = 'web' | 'app' | 'block' | 'file'

/**
 * Short / literal queries (1–3 words, no question mark) run instant local FTS.
 * Longer or question-shaped queries route through the natural-language
 * interpreter (throttled, provider-backed).
 */
export function isNaturalQuery(query: string): boolean {
  const trimmed = query.trim()
  if (!trimmed) return false
  if (trimmed.includes('?')) return true
  return trimmed.split(/\s+/).filter(Boolean).length >= 4
}

export function searchResultSourceKind(result: DaylensSearchResult): SearchSourceKind {
  switch (result.type) {
    case 'session': return 'app'
    case 'block': return 'block'
    case 'browser': return 'web'
    case 'artifact': return 'file'
  }
}

export function searchResultTitle(result: DaylensSearchResult): string {
  switch (result.type) {
    case 'session': return result.windowTitle || result.appName
    case 'block': return result.label
    case 'browser': return result.pageTitle || result.url || result.domain
    case 'artifact': return result.title
  }
}

export function searchResultSubtitle(result: DaylensSearchResult): string {
  switch (result.type) {
    case 'session': return result.appName
    case 'block': return 'Timeline block'
    case 'browser': return result.domain
    case 'artifact': return result.filePath ? 'Generated file' : 'AI artifact'
  }
}

/** App name (session) or domain (browser) — the thing whose icon we resolve. */
export function searchResultAppName(result: DaylensSearchResult): string | null {
  return result.type === 'session' ? result.appName : null
}

export function searchResultDomain(result: DaylensSearchResult): string | null {
  return result.type === 'browser' ? result.domain : null
}

function normalizeForDedup(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').replace(/[^\w ]+/g, '').trim()
}

function matchScore(result: DaylensSearchResult, normalizedQuery: string): number {
  if (!normalizedQuery) return 0
  const title = normalizeForDedup(searchResultTitle(result))
  const subtitle = normalizeForDedup(searchResultSubtitle(result))
  if (title === normalizedQuery || subtitle === normalizedQuery) return 3 // exact title/domain
  if (title.startsWith(normalizedQuery) || subtitle.startsWith(normalizedQuery)) return 2
  if (title.includes(normalizedQuery) || subtitle.includes(normalizedQuery)) return 1
  return 0
}

/**
 * Collapse near-identical rows (same normalized title + subtitle) keeping the
 * most recent, then rank: exact title/domain matches first, then recency.
 * (The "canvas" example returned 3 near-dupes — this collapses them.)
 */
export function dedupeAndRankResults(
  results: DaylensSearchResult[],
  query: string,
): DaylensSearchResult[] {
  const normalizedQuery = normalizeForDedup(query)
  const byKey = new Map<string, DaylensSearchResult>()
  for (const result of results) {
    const key = `${result.type === 'browser' ? 'web' : result.type === 'session' ? 'app' : result.type}:${normalizeForDedup(searchResultTitle(result))}|${normalizeForDedup(searchResultSubtitle(result))}`
    const existing = byKey.get(key)
    if (!existing || result.startTime > existing.startTime) byKey.set(key, result)
  }
  return [...byKey.values()].sort((a, b) => {
    const scoreDelta = matchScore(b, normalizedQuery) - matchScore(a, normalizedQuery)
    if (scoreDelta !== 0) return scoreDelta
    return b.startTime - a.startTime
  })
}
