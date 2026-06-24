// Pure helpers for the short names a user naturally uses for a client in chat.
// A client named "Andersen in Rwanda" should also answer to "Andersen" (and
// "Rwanda"); "Acme Corp" to "Acme". No DB deps, so both the client write path
// (attributionResolvers) and the backfill migration can share this — and it
// keeps scoped-memory read + write matching identical (memory.md §2.2).

// Dropped when deriving short aliases: connector words and common company
// suffixes that aren't how anyone refers to the account. Tokens under 3 chars
// are dropped too, so a stray "AB" can't pull a scope in.
const ALIAS_STOPWORDS = new Set([
  'in', 'of', 'the', 'and', 'for', 'at', 'to', 'on', 'by', 'as', 'or',
  'inc', 'corp', 'llc', 'ltd', 'plc', 'gmbh', 'company', 'group', 'holdings',
  'limited', 'incorporated', 'partners', 'global', 'international',
])

/** The significant single-word aliases for a client name, normalized and
 *  deduped. Excludes the full name itself (already stored as the primary
 *  alias). Returns [] for a single-word name (the full alias covers it). */
export function deriveClientAliasTokens(name: string): string[] {
  const full = name.toLowerCase().trim()
  const tokens = new Set<string>()
  for (const raw of full.split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || ALIAS_STOPWORDS.has(raw)) continue
    tokens.add(raw)
  }
  tokens.delete(full)
  return [...tokens]
}
