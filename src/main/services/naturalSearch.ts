// S1: natural-language search. A literal/short query stays on the instant
// exact-search fast path (no provider call). A natural-language query is
// interpreted by the selected provider into keywords + a one-line intent, then
// OR-searched across the same exact retrieval path the keyword search uses
// (entities + corrected memory records + FTS — DEV-178) and merged by how many
// terms each row matched. Offline / no-provider falls back to deterministic
// keyword extraction, so search never hard-fails.
//
// Deferred (DEV-180): a true embedding/vector index for semantic ranking. This
// increment gets "relevant results without an exact keyword match" via
// provider-driven term expansion over exact retrieval, without committing to
// an embedding store, model, or reindex strategy.

import { getDb } from './database'
import { interpretSearchIntent } from '../jobs/aiService'
import { searchExact, type ExactSearchResult } from './exactSearch'
import type { SearchOptions } from '../db/queries'
import { deterministicTerms, isLiteralQuery, mergeByTermHits } from './searchTerms'

export interface NaturalSearchResponse {
  results: ExactSearchResult[]
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
    return { results: searchExact(db, trimmed, opts), intent: null, terms: [trimmed], usedProvider: false }
  }

  const interpreted = await interpretSearchIntent(trimmed)
  const terms = interpreted?.terms.length ? interpreted.terms : deterministicTerms(trimmed)
  if (terms.length === 0) {
    // Nothing extractable — fall back to the literal query so we still try.
    return { results: searchExact(db, trimmed, opts), intent: interpreted?.intent ?? null, terms: [], usedProvider: Boolean(interpreted) }
  }
  const perTerm = terms.map((term) => searchExact(db, term, { ...opts, limit }))
  return {
    results: mergeByTermHits(perTerm, limit),
    intent: interpreted?.intent ?? null,
    terms,
    usedProvider: Boolean(interpreted),
  }
}
