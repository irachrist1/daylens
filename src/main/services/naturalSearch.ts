// S1: natural-language search. A literal/short query stays on the instant FTS
// fast path (no provider call). A natural-language query is interpreted by the
// selected provider into keywords + a one-line intent, then OR-searched across
// the same local FTS tables the keyword search uses and merged by how many
// terms each row matched. Offline / no-provider falls back to deterministic
// keyword extraction, so search never hard-fails.
//
// Deferred (the spec's open question): a true embedding/vector index for
// semantic ranking. This increment gets "relevant results without an exact
// keyword match" via provider-driven term expansion over FTS, without
// committing to an embedding store, model, or reindex strategy.

import { searchAll, type SearchOptions } from '../db/queries'
import { getDb } from './database'
import { interpretSearchIntent } from '../jobs/aiService'
import { deterministicTerms, isLiteralQuery, mergeByTermHits } from './searchTerms'

type SearchResult = ReturnType<typeof searchAll>[number]

export interface NaturalSearchResponse {
  results: SearchResult[]
  intent: string | null
  terms: string[]
  usedProvider: boolean
}

export async function searchNatural(query: string, opts: SearchOptions = {}): Promise<NaturalSearchResponse> {
  const db = getDb()
  const trimmed = query.trim()
  const limit = opts.limit ?? 30
  if (!trimmed) return { results: [], intent: null, terms: [], usedProvider: false }

  if (isLiteralQuery(trimmed)) {
    return { results: searchAll(db, trimmed, opts), intent: null, terms: [trimmed], usedProvider: false }
  }

  const interpreted = await interpretSearchIntent(trimmed)
  const terms = interpreted?.terms.length ? interpreted.terms : deterministicTerms(trimmed)
  if (terms.length === 0) {
    // Nothing extractable — fall back to the literal query so we still try.
    return { results: searchAll(db, trimmed, opts), intent: interpreted?.intent ?? null, terms: [], usedProvider: Boolean(interpreted) }
  }
  const perTerm = terms.map((term) => searchAll(db, term, { ...opts, limit }))
  return {
    results: mergeByTermHits(perTerm, limit),
    intent: interpreted?.intent ?? null,
    terms,
    usedProvider: Boolean(interpreted),
  }
}
