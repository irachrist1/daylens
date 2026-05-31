// S1: the dependency-free core of natural-language search — keyword extraction,
// the literal/short-query gate, and the per-term merge. Kept separate from
// naturalSearch.ts (which pulls the DB + provider) so it stays hermetically
// testable with no heavy imports.

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at', 'is', 'are', 'was', 'were', 'be', 'been',
  'i', 'me', 'my', 'mine', 'we', 'our', 'you', 'your', 'it', 'its', 'this', 'that', 'these', 'those',
  'what', 'when', 'where', 'who', 'how', 'why', 'which', 'did', 'do', 'does', 'done', 'get', 'got', 'show', 'tell',
  'much', 'many', 'long', 'time', 'spend', 'spent', 'about', 'everything', 'anything', 'all', 'some', 'any',
  'last', 'first', 'recent', 'recently', 'ago', 'day', 'days', 'week', 'weeks', 'month', 'please',
])

/** Stopword-stripped keyword fallback when no provider is available. */
export function deterministicTerms(query: string): string[] {
  const seen = new Set<string>()
  const terms: string[] = []
  for (const raw of query.toLowerCase().split(/[^a-z0-9.+#_-]+/i)) {
    const token = raw.trim()
    if (token.length < 3 || STOPWORDS.has(token) || seen.has(token)) continue
    seen.add(token)
    terms.push(token)
    if (terms.length >= 6) break
  }
  return terms
}

/** Short, literal queries skip the provider and use instant FTS (acceptance #2). */
export function isLiteralQuery(query: string): boolean {
  const tokens = query.trim().split(/\s+/).filter(Boolean)
  return tokens.length <= 3 && !query.includes('?')
}

/** Merge per-term result batches, ranking by term-hit count then recency. */
export function mergeByTermHits<T extends { type: string; id: string | number; startTime: number }>(
  termResults: T[][],
  limit: number,
): T[] {
  const byKey = new Map<string, { result: T; hits: number }>()
  for (const batch of termResults) {
    for (const result of batch) {
      const key = `${result.type}:${result.id}:${result.startTime}`
      const existing = byKey.get(key)
      if (existing) existing.hits += 1
      else byKey.set(key, { result, hits: 1 })
    }
  }
  return [...byKey.values()]
    .sort((a, b) => (b.hits - a.hits) || (b.result.startTime - a.result.startTime))
    .slice(0, limit)
    .map((entry) => entry.result)
}
