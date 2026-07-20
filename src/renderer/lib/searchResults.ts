import type { DaylensSearchResult } from '../../preload/index'

// FB2: search lives inside ⌘K now. These are the pure helpers — query routing
// (literal FTS vs natural-language), row metadata, and de-dup/rank — kept out of
// the component so they can be unit-tested and reused.

export type SearchSourceKind = 'web' | 'app' | 'block' | 'file' | 'entity'

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

const ENTITY_TYPE_LABELS: Record<string, string> = {
  application: 'Application',
  page: 'Page',
  file: 'File',
  person: 'Person',
  meeting: 'Meeting',
  repository: 'Repository',
  project: 'Project',
  client: 'Client',
  timeline_block: 'Timeline block',
  ai_thread: 'AI thread',
}

export function searchResultSourceKind(result: DaylensSearchResult): SearchSourceKind {
  switch (result.type) {
    case 'session': return 'app'
    case 'block': return 'block'
    case 'browser': return 'web'
    case 'artifact': return 'file'
    case 'entity': return 'entity'
  }
}

export function searchResultTitle(result: DaylensSearchResult): string {
  switch (result.type) {
    case 'session': return result.windowTitle || result.appName
    case 'block': return result.label
    case 'browser': return result.pageTitle || result.url || result.domain
    case 'artifact': return result.title
    case 'entity': return result.name
  }
}

export function searchResultSubtitle(result: DaylensSearchResult): string {
  switch (result.type) {
    case 'session': {
      // Source type per the memory spec's search interface — but plain
      // observed capture stays quiet (the product describes activity before
      // telemetry). Connected/supplied/inferred provenance is worth a word.
      const base = result.sourceType && result.sourceType !== 'observed'
        ? `${result.appName} · ${result.sourceType}`
        : result.appName
      // DEV-180: a by-meaning hit says so — it matched what the moment was
      // about, not the words the person typed.
      return result.foundBy === 'meaning' ? `${base} · similar meaning` : base
    }
    case 'block': return 'Timeline block'
    case 'browser': return result.domain
    case 'artifact': return result.filePath ? 'Generated file' : 'AI artifact'
    case 'entity': {
      const label = ENTITY_TYPE_LABELS[result.entityType] ?? result.entityType
      const base = result.matchedAlias ? `${label} · also known as “${result.matchedAlias}”` : label
      return result.sourceType && result.sourceType !== 'observed'
        ? `${base} · ${result.sourceType}`
        : base
    }
  }
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
