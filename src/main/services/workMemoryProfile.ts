// Work memory as an editable, human-readable profile (ChatGPT-style), replacing
// the opaque "65% pattern" table. See docs/specs/work-memory.md.
//
// A profile is a handful of plain sentences. Daylens DRAFTS facts from real
// evidence (the apps/sites you actually use); the user can edit, add, or delete
// any of them by hand. Hand edits and deletes are CORRECTIONS that survive every
// rebuild (same rule as block corrections). The draft is deterministic — no AI
// call — so rebuild is safe to run without provider approval, and there is no
// confidence theater: a fact is stated plainly or left out.
import crypto from 'node:crypto'
import type Database from 'better-sqlite3'
import type { AppCategory } from '@shared/types'
import { tableExists } from './database'

type WorkMemoryFactOrigin = 'drafted' | 'user'

interface WorkMemoryFact {
  id: string
  text: string
  origin: WorkMemoryFactOrigin
}

export interface WorkMemoryProfile {
  facts: WorkMemoryFact[]
}

export interface RebuildResult {
  facts: WorkMemoryFact[]
  added: string[]
  changeSummary: string
}

export interface ForgetResult {
  facts: WorkMemoryFact[]
  changeSummary: string
}

interface FactRow {
  id: string
  fact_text: string
  origin: WorkMemoryFactOrigin
  status: 'active' | 'deleted'
  topic_key: string | null
  sort_order: number
}

function now(): number {
  return Date.now()
}

function newId(): string {
  return `wmf_${crypto.randomBytes(8).toString('hex')}`
}

function ready(db: Database.Database): boolean {
  return tableExists(db, 'work_memory_facts')
}

export function getWorkMemoryProfile(db: Database.Database): WorkMemoryProfile {
  if (!ready(db)) return { facts: [] }
  const rows = db.prepare(`
    SELECT id, fact_text, origin, status, topic_key, sort_order
    FROM work_memory_facts
    WHERE status = 'active'
    ORDER BY sort_order ASC, created_at ASC
  `).all() as FactRow[]
  return { facts: rows.map((row) => ({ id: row.id, text: row.fact_text, origin: row.origin })) }
}

// Hand-editing a fact makes it a user correction — origin flips to 'user' so a
// later rebuild never overwrites it.
export function updateWorkMemoryFact(db: Database.Database, id: string, text: string): WorkMemoryProfile {
  if (!ready(db)) return { facts: [] }
  const trimmed = text.trim()
  if (!trimmed) return getWorkMemoryProfile(db)
  db.prepare(`
    UPDATE work_memory_facts
    SET fact_text = ?, origin = 'user', updated_at = ?
    WHERE id = ?
  `).run(trimmed, now(), id)
  return getWorkMemoryProfile(db)
}

export function addWorkMemoryFact(db: Database.Database, text: string): WorkMemoryProfile {
  if (!ready(db)) return { facts: [] }
  const trimmed = text.trim()
  if (!trimmed) return getWorkMemoryProfile(db)
  const max = db.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM work_memory_facts`).get() as { m: number }
  db.prepare(`
    INSERT INTO work_memory_facts (id, fact_text, origin, status, topic_key, sort_order, created_at, updated_at)
    VALUES (?, ?, 'user', 'active', NULL, ?, ?, ?)
  `).run(newId(), trimmed, (max.m ?? 0) + 1, now(), now())
  return getWorkMemoryProfile(db)
}

// Forgetting a fact that came from a drafted topic tombstones that topic so a
// rebuild won't re-add it — even if the user edited it first (an edit flips
// origin to 'user' but keeps the topic_key). A purely hand-added fact has no
// topic_key and is simply removed. This keeps "forgot on purpose stays gone"
// true across the edit-then-forget path (work-memory.md §3.3).
export function forgetWorkMemoryFact(db: Database.Database, id: string): ForgetResult {
  if (!ready(db)) return { facts: [], changeSummary: 'Nothing to forget.' }
  const row = db.prepare(`SELECT id, fact_text, origin, status, topic_key, sort_order FROM work_memory_facts WHERE id = ?`).get(id) as FactRow | undefined
  if (!row) return { facts: getWorkMemoryProfile(db).facts, changeSummary: 'Nothing to forget.' }

  if (row.topic_key) {
    db.prepare(`UPDATE work_memory_facts SET status = 'deleted', updated_at = ? WHERE id = ?`).run(now(), id)
  } else {
    db.prepare(`DELETE FROM work_memory_facts WHERE id = ?`).run(id)
  }
  return {
    facts: getWorkMemoryProfile(db).facts,
    changeSummary: `Forgot "${truncate(row.fact_text)}".`,
  }
}

function truncate(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

// ── Drafting from real evidence ────────────────────────────────────────────

interface DraftFact {
  topicKey: string
  text: string
}

const CATEGORY_PHRASE: Partial<Record<AppCategory, string>> = {
  development: 'development',
  research: 'research and reading',
  writing: 'writing',
  design: 'design',
  communication: 'communication',
  meetings: 'meetings',
  email: 'email',
  aiTools: 'AI tools',
}

const BACKGROUND_DOMAINS = ['youtube.com', 'x.com', 'twitter.com', 'reddit.com', 'netflix.com', 'instagram.com', 'tiktok.com']

// Build the deterministic draft from the user's real app/site usage. Small,
// plain sentences grounded in evidence — never a number on noise.
function draftFactsFromEvidence(db: Database.Database): DraftFact[] {
  const facts: DraftFact[] = []
  const lookback = now() - 30 * 86_400_000

  // Top apps by time → the names for the sentence (group by app only).
  const topApps = db.prepare(`
    SELECT app_name AS appName, SUM(duration_sec) AS total
    FROM app_sessions
    WHERE start_time >= ? AND app_name IS NOT NULL AND app_name != ''
    GROUP BY app_name
    ORDER BY total DESC
    LIMIT 5
  `).all(lookback) as Array<{ appName: string; total: number }>

  // Dominant category → grouped by category (not a non-grouped column), so the
  // phrase reflects real totals rather than an arbitrary per-app category value.
  const categoryTotals = db.prepare(`
    SELECT category, SUM(duration_sec) AS total
    FROM app_sessions
    WHERE start_time >= ? AND category IS NOT NULL
    GROUP BY category
  `).all(lookback) as Array<{ category: AppCategory; total: number }>

  const focusApps = topApps.filter((row) => (row.total ?? 0) > 1800)
  if (focusApps.length > 0) {
    const names = focusApps.slice(0, 3).map((row) => row.appName)
    const topCategory = mostCommonCategory(categoryTotals)
    const categoryPhrase = topCategory ? ` on ${CATEGORY_PHRASE[topCategory] ?? topCategory}` : ''
    facts.push({
      topicKey: 'top-apps',
      text: `You spend most of your day in ${joinNames(names)}${categoryPhrase}.`,
    })
  }

  // Background sites — what the user treats as not-focus.
  const bgRows = db.prepare(`
    SELECT domain, SUM(duration_sec) AS total
    FROM website_visits
    WHERE visit_time >= ? AND domain IS NOT NULL
    GROUP BY domain
    ORDER BY total DESC
    LIMIT 20
  `).all(lookback) as Array<{ domain: string; total: number }>
  const background = bgRows
    .map((row) => row.domain.replace(/^www\./, ''))
    .filter((domain) => BACKGROUND_DOMAINS.some((bg) => domain === bg || domain.endsWith(`.${bg}`)))
  const uniqueBackground = [...new Set(background)].slice(0, 3)
  if (uniqueBackground.length > 0) {
    facts.push({
      topicKey: 'background',
      text: `You treat ${joinNames(uniqueBackground.map(prettyDomain))} as background, not focus.`,
    })
  }

  return facts
}

function mostCommonCategory(rows: Array<{ category: AppCategory; total: number }>): AppCategory | null {
  const totals = new Map<AppCategory, number>()
  for (const row of rows) {
    if (!row.category || row.category === 'uncategorized' || row.category === 'system') continue
    totals.set(row.category, (totals.get(row.category) ?? 0) + (row.total ?? 0))
  }
  let best: AppCategory | null = null
  let bestTotal = 0
  for (const [category, total] of totals) {
    if (total > bestTotal) { best = category; bestTotal = total }
  }
  return best
}

function prettyDomain(domain: string): string {
  const base = domain.split('.')[0]
  return base.charAt(0).toUpperCase() + base.slice(1)
}

function joinNames(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

// Rebuild re-drafts from current evidence while KEEPING the user's hand edits
// and respecting purposeful deletes, and reports what changed in one line.
export function rebuildWorkMemory(db: Database.Database): RebuildResult {
  if (!ready(db)) return { facts: [], added: [], changeSummary: 'Work memory is unavailable.' }

  const existing = db.prepare(`SELECT id, fact_text, origin, status, topic_key, sort_order FROM work_memory_facts`).all() as FactRow[]
  const tombstonedTopics = new Set(existing.filter((row) => row.status === 'deleted').map((row) => row.topic_key).filter(Boolean) as string[])
  const draftedTopics = new Map(existing.filter((row) => row.origin === 'drafted' && row.status === 'active').map((row) => [row.topic_key ?? '', row]))

  const drafts = draftFactsFromEvidence(db)
  const added: string[] = []
  const maxOrderRow = db.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM work_memory_facts`).get() as { m: number }
  let nextOrder = (maxOrderRow.m ?? 0) + 1

  const insert = db.prepare(`
    INSERT INTO work_memory_facts (id, fact_text, origin, status, topic_key, sort_order, created_at, updated_at)
    VALUES (?, ?, 'drafted', 'active', ?, ?, ?, ?)
  `)
  const refresh = db.prepare(`UPDATE work_memory_facts SET fact_text = ?, updated_at = ? WHERE id = ?`)

  for (const draft of drafts) {
    if (tombstonedTopics.has(draft.topicKey)) continue // purposely forgotten — stay gone
    const current = draftedTopics.get(draft.topicKey)
    if (current) {
      if (current.fact_text !== draft.text) refresh.run(draft.text, now(), current.id)
      continue
    }
    insert.run(newId(), draft.text, draft.topicKey, nextOrder++, now(), now())
    added.push(draft.text)
  }

  const facts = getWorkMemoryProfile(db).facts
  const changeSummary = added.length > 0
    ? `Rebuilt — added: ${added.map((text) => truncate(text, 50)).join('; ')}.`
    : 'Rebuilt — nothing new to add; your profile already matches your recent activity.'
  return { facts, added, changeSummary }
}

// The profile handed to every AI surface as context (naming, recaps, chat,
// wraps). Context only — it colors interpretation, never invents activity.
export function workMemoryPromptBlock(db: Database.Database): string {
  const { facts } = getWorkMemoryProfile(db)
  if (facts.length === 0) return ''
  return [
    'What Daylens knows about this user (context only — never invent activity beyond the real evidence):',
    ...facts.map((fact) => `- ${fact.text}`),
  ].join('\n')
}
