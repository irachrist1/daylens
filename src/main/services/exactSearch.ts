// Exact search over the canonical memory (DEV-178).
//
// One query path shared by the ⌘K palette, natural-language search, and the
// AI's search tools (spec §Search interface: "Filters change the same shared
// query used by the AI agent"):
//
//   1. keep today's memory-index projection fresh (cheap fingerprint check),
//   2. resolve the query against durable entities — canonical names AND
//      aliases, merge-aware — so "acme" resolves to Acme Corp,
//   3. return the matching entities themselves plus every corrected moment
//      they were part of (entity-tagged records), merged with the plain
//      full-text hits over sessions, pages, blocks, and artifacts.
//
// Entity resolution happens at query time against the live entity tables, so
// a rename changes results instantly and removing an alias stops the old name
// from matching — no reindex, no resurrected results.
import type Database from 'better-sqlite3'
import {
  searchAll,
  searchEntityMoments,
  latestEntityMomentDate,
  type SearchOptions,
  type SearchResult,
} from '../db/queries'
import { localDateString } from '../lib/localDate'
import { ensureDayMemoryIndexed } from './memoryIndex'
import {
  mergeGroupIds,
  normalizeEntityLabel,
  resolveMergeChain,
  type EntityRow,
  type EntityType,
} from './entities/entityRepository'

export interface EntitySearchResult {
  type: 'entity'
  id: string
  name: string
  entityType: EntityType
  /** The alias that matched when it differs from the canonical name. */
  matchedAlias: string | null
  startTime: number
  endTime: number
  /** Day the entity was last part of — where a click should land. */
  date: string
  excerpt: string
}

export type ExactSearchResult = SearchResult | EntitySearchResult

export interface EntityQueryMatch {
  entity: EntityRow
  matchedAlias: string | null
  rank: number
}

const ENTITY_RESULT_LIMIT = 5
const ENTITY_MATCH_LIMIT = 8

function escapeLike(value: string): string {
  return value.replace(/[!%_]/g, (character) => `!${character}`)
}

/**
 * Resolve free text to durable entities: exact canonical name, exact alias,
 * then substring over both. Merged entities resolve to their survivor;
 * deleted entities never match. Returns at most a handful of ranked matches —
 * uncertainty stays visible as multiple results, never a silent pick.
 */
export function resolveQueryEntityMatches(
  db: Database.Database,
  query: string,
  limit = ENTITY_MATCH_LIMIT,
): EntityQueryMatch[] {
  const normalized = normalizeEntityLabel(query)
  if (normalized.length < 2) return []
  const needle = `%${escapeLike(normalized)}%`

  const rows = db.prepare(`
    SELECT e.*, matches.alias AS matched_alias, MIN(matches.rank) AS rank
    FROM (
      SELECT id AS entity_id, NULL AS alias,
        CASE WHEN LOWER(canonical_name) = ? THEN 0 ELSE 2 END AS rank
      FROM entities
      WHERE LOWER(canonical_name) LIKE ? ESCAPE '!'
      UNION ALL
      SELECT entity_id, alias,
        CASE WHEN alias_normalized = ? THEN 1 ELSE 3 END AS rank
      FROM entity_aliases
      WHERE alias_normalized LIKE ? ESCAPE '!'
    ) matches
    JOIN entities e ON e.id = matches.entity_id
    GROUP BY e.id
    ORDER BY rank ASC, e.last_observed_at DESC
    LIMIT ?
  `).all(normalized, needle, normalized, needle, limit * 3) as Array<EntityRow & {
    matched_alias: string | null
    rank: number
  }>

  // Substring matches only count from 3 characters — two letters inside a
  // word is noise, not a lookup.
  const minRankAllowed = normalized.length >= 3 ? 3 : 1

  const bySurvivor = new Map<string, EntityQueryMatch>()
  for (const row of rows) {
    if (row.rank > minRankAllowed) continue
    const { matched_alias: matchedAlias, rank, ...entityColumns } = row
    const survivor = resolveMergeChain(db, entityColumns as EntityRow)
    if (survivor.status === 'deleted') continue
    const existing = bySurvivor.get(survivor.id)
    if (existing && existing.rank <= rank) continue
    bySurvivor.set(survivor.id, {
      entity: survivor,
      matchedAlias: matchedAlias && normalizeEntityLabel(matchedAlias) !== normalizeEntityLabel(survivor.canonical_name)
        ? matchedAlias
        : null,
      rank,
    })
  }
  return [...bySurvivor.values()]
    .sort((a, b) => (a.rank - b.rank)
      || ((b.entity.last_observed_at ?? 0) - (a.entity.last_observed_at ?? 0)))
    .slice(0, limit)
}

const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
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

function toEntityResult(
  db: Database.Database,
  match: EntityQueryMatch,
  groupIds: readonly string[],
): EntitySearchResult {
  const lastMoment = latestEntityMomentDate(db, groupIds)
  const lastSeenMs = lastMoment?.startMs ?? match.entity.last_observed_at ?? 0
  const label = ENTITY_TYPE_LABELS[match.entity.entity_type] ?? match.entity.entity_type
  return {
    type: 'entity',
    id: match.entity.id,
    name: match.entity.canonical_name,
    entityType: match.entity.entity_type,
    matchedAlias: match.matchedAlias,
    startTime: lastSeenMs,
    endTime: lastSeenMs,
    date: lastMoment?.date ?? (lastSeenMs > 0 ? localDateString(new Date(lastSeenMs)) : ''),
    excerpt: match.matchedAlias ? `${label} · also known as “${match.matchedAlias}”` : label,
  }
}

/**
 * The exact retrieval path: matching entities first, then corrected moments —
 * entity-tagged records merged with full-text hits, deduped, newest first.
 */
export function searchExact(
  db: Database.Database,
  query: string,
  opts: SearchOptions = {},
): ExactSearchResult[] {
  const trimmed = query.trim()
  if (!trimmed) return []
  const limit = opts.limit ?? 25

  // Today is the only day whose evidence grows between corrections; keep its
  // projection current so a moment from five minutes ago is findable.
  try {
    ensureDayMemoryIndexed(db, localDateString())
  } catch (error) {
    console.error('[exactSearch] live-day index refresh failed', error)
  }

  const matches = resolveQueryEntityMatches(db, trimmed)
  const groupIdsByMatch = matches.map((match) => mergeGroupIds(db, match.entity.id))
  const allGroupIds = [...new Set(groupIdsByMatch.flat())]

  const tagged = searchEntityMoments(db, allGroupIds, { ...opts, limit })
  const fts = searchAll(db, trimmed, { ...opts, limit })

  const seen = new Set<string>()
  const moments: SearchResult[] = []
  for (const result of [...tagged, ...fts].sort((a, b) => b.startTime - a.startTime)) {
    const key = `${result.type}:${result.id}:${result.startTime}`
    if (seen.has(key)) continue
    seen.add(key)
    moments.push(result)
    if (moments.length >= limit) break
  }

  const entityResults = matches
    .slice(0, ENTITY_RESULT_LIMIT)
    .map((match, index) => toEntityResult(db, match, groupIdsByMatch[index]))

  return [...entityResults, ...moments]
}
