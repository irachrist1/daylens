// Day Wrapped — the deterministic facts layer (DEV-114).
//
// ONE reconciled facts object for the whole story. The headline number, the
// "what you did" list, the day ribbon, and the standout all derive from this,
// so no two scenes can ever disagree (invariant briefs-wraps.md §8.3, §8.4).
// The AI narrative only ever supplies prose on top of these numbers — it never
// invents or restates one.
//
// Pure (no React) so it can be unit-tested without the carousel.

import type { AppCategory, DayTimelinePayload, WorkContextBlock } from '@shared/types'
import { blockActiveSeconds } from '@shared/blockDuration'
import { effectiveBlockKind, type WorkKind } from '@shared/workKind'
import { inferWorkIntent } from '@shared/workIntent'
import { isTrustedTimelineBlock } from '@shared/timelineReview'
import { friendlyDomain, humanizeTitle, leisureActivityTitle } from '@shared/humanize'
import { looksLikeRawArtifactLabel } from './wrappedFacts'

// ─── Shapes ──────────────────────────────────────────────────────────────────

export interface WrapActivity {
  /** Human name for the WORK — never a filename, folder, repo, or tab title. */
  name: string
  seconds: number
  category: AppCategory
  kind: WorkKind
}

export interface RibbonSegment {
  name: string
  seconds: number
  category: AppCategory
  kind: WorkKind
  startMs: number
  endMs: number
}

export interface WrapStandout {
  /** Active seconds in the single longest unbroken work stretch. */
  seconds: number
  startClock: string
  endClock: string
  /** What they were heads-down on. */
  name: string
}

export type WrapQuality = 'empty' | 'tooEarly' | 'partial' | 'full'

export interface DayWrapFacts {
  date: string
  weekday: string      // "TUESDAY"
  dateLabel: string    // "JUN 24"
  // The one split. work + leisure + personal = activeSeconds (idle excluded).
  workSeconds: number
  leisureSeconds: number
  personalSeconds: number
  /** The headline number. Equals the ribbon total and the split total. */
  activeSeconds: number
  /** Ranked human work activities (top tracks). May be empty on a rest day. */
  workActivities: WrapActivity[]
  /** Chronological merged ribbon of the whole day, morning to night. */
  ribbon: RibbonSegment[]
  ribbonStartClock: string | null
  ribbonEndClock: string | null
  /** A real, computed superlative. null when no stretch clears the bar. */
  standout: WrapStandout | null
  /** Friendly leisure surfaces, most time first ("YouTube", "Netflix"). */
  topLeisure: string[]
  isLeisureDay: boolean
  quality: WrapQuality
}

// ─── Tunables ────────────────────────────────────────────────────────────────

const TOO_EARLY_SECONDS = 5 * 60
const PARTIAL_SECONDS = 45 * 60
const ACTIVITY_MIN_SECONDS = 5 * 60       // a named track has to be real
const MAX_ACTIVITIES = 4
const STANDOUT_MIN_SECONDS = 25 * 60      // a stretch worth bragging about
const RIBBON_MIN_SEGMENT_SECONDS = 3 * 60 // fold slivers into their neighbour
const MAX_RIBBON_SEGMENTS = 7

// ─── Naming (human, never a raw artifact) ─────────────────────────────────────

function cap(s: string): string {
  const t = s.trim()
  return t ? t[0].toUpperCase() + t.slice(1) : t
}

function correctedOrCurrentLabel(block: WorkContextBlock): string {
  return (block.review?.correctedLabel?.trim() || block.label.current.trim())
}

/** The human name for a WORK block: the inferred subject if it reads clean,
 *  else a humanized label, else "" meaning "fold into a few smaller things". */
function workActivityName(block: WorkContextBlock): string {
  const subject = inferWorkIntent(block).subject?.trim()
  if (subject && subject.length >= 3 && !looksLikeRawArtifactLabel(subject)) {
    return cap(subject)
  }
  const humanized = humanizeTitle(correctedOrCurrentLabel(block))
  if (humanized && humanized.length >= 3 && !looksLikeRawArtifactLabel(humanized)) {
    return cap(humanized)
  }
  return ''
}

/** The human name for any block, for the ribbon. Leisure/personal read by the
 *  activity ("Watching YouTube"), never a work intent. */
function blockDisplayName(block: WorkContextBlock, kind: WorkKind): string {
  if (kind === 'work') {
    const name = workActivityName(block)
    return name || categoryWord(block.dominantCategory)
  }
  if (kind === 'leisure') {
    const domains = block.websites
      .slice()
      .sort((a, b) => b.totalSeconds - a.totalSeconds)
      .map((w) => w.domain)
    return leisureActivityTitle(domains)
  }
  if (kind === 'personal') return 'Personal'
  return 'Idle'
}

/** Human category words — never the banned set (Browsing / Development / AI
 *  tools / Productivity), never a tool brand. */
export function categoryWord(category: AppCategory): string {
  switch (category) {
    case 'development': return 'Coding'
    case 'aiTools': return 'Coding'
    case 'writing': return 'Writing'
    case 'design': return 'Design'
    case 'research': return 'Research'
    case 'meetings': return 'Meetings'
    case 'communication': return 'Messages'
    case 'email': return 'Email'
    case 'productivity': return 'Admin'
    case 'browsing': return 'Reading'
    case 'entertainment': return 'Watching'
    case 'social': return 'Social'
    default: return 'Work'
  }
}

// ─── Builder ──────────────────────────────────────────────────────────────────

export function buildDayWrapFacts(payload: DayTimelinePayload): DayWrapFacts {
  const [y, m, d] = payload.date.split('-').map(Number)
  const dateObj = new Date(y, m - 1, d)
  const weekday = dateObj.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase()
  const dateLabel = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()

  const blocks = payload.blocks
    .filter(isTrustedTimelineBlock)
    .filter((b) => b.dominantCategory !== 'system' && b.dominantCategory !== 'uncategorized')
    .slice()
    .sort((a, b) => a.startTime - b.startTime)

  // One reconciled kind split.
  let workSeconds = 0, leisureSeconds = 0, personalSeconds = 0
  const leisureByName = new Map<string, number>()
  for (const block of blocks) {
    const kind = effectiveBlockKind(block)
    const seconds = blockActiveSeconds(block)
    if (kind === 'work') workSeconds += seconds
    else if (kind === 'leisure') {
      leisureSeconds += seconds
      for (const site of block.websites) {
        const name = friendlyDomain(site.domain)
        if (name) leisureByName.set(name, (leisureByName.get(name) ?? 0) + site.totalSeconds)
      }
    } else if (kind === 'personal') personalSeconds += seconds
  }
  const activeSeconds = workSeconds + leisureSeconds + personalSeconds

  // Ranked work activities — merge by name, drop the unnameable.
  const byName = new Map<string, WrapActivity>()
  for (const block of blocks) {
    if (effectiveBlockKind(block) !== 'work') continue
    const name = workActivityName(block)
    if (!name) continue
    const key = name.toLowerCase()
    const seconds = blockActiveSeconds(block)
    const existing = byName.get(key)
    if (existing) existing.seconds += seconds
    else byName.set(key, { name, seconds, category: block.dominantCategory, kind: 'work' })
  }
  const workActivities = [...byName.values()]
    .filter((a) => a.seconds >= ACTIVITY_MIN_SECONDS)
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, MAX_ACTIVITIES)

  // The day ribbon — chronological, merged, slivers folded.
  const ribbon = buildRibbon(blocks)
  const ribbonStartClock = ribbon.length > 0 ? formatClock(ribbon[0].startMs) : null
  const ribbonEndClock = ribbon.length > 0 ? formatClock(ribbon[ribbon.length - 1].endMs) : null

  // The standout — the single longest unbroken WORK stretch.
  const standout = selectStandout(blocks)

  const topLeisure = [...leisureByName.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name)

  const tracked = workSeconds + leisureSeconds + personalSeconds
  const isLeisureDay = tracked > 0 && leisureSeconds >= workSeconds && leisureSeconds / tracked >= 0.5

  return {
    date: payload.date,
    weekday,
    dateLabel,
    workSeconds,
    leisureSeconds,
    personalSeconds,
    activeSeconds,
    workActivities,
    ribbon,
    ribbonStartClock,
    ribbonEndClock,
    standout,
    topLeisure,
    isLeisureDay,
    quality: qualityForSeconds(activeSeconds),
  }
}

function buildRibbon(blocks: WorkContextBlock[]): RibbonSegment[] {
  const raw: RibbonSegment[] = []
  for (const block of blocks) {
    const kind = effectiveBlockKind(block)
    if (kind === 'idle') continue
    const seconds = blockActiveSeconds(block)
    if (seconds <= 0) continue
    raw.push({
      name: blockDisplayName(block, kind),
      seconds,
      category: block.dominantCategory,
      kind,
      startMs: block.startTime,
      endMs: block.endTime,
    })
  }
  if (raw.length === 0) return []

  // Merge consecutive segments that read as the same activity.
  const merged: RibbonSegment[] = []
  for (const seg of raw) {
    const prev = merged[merged.length - 1]
    if (prev && prev.name === seg.name && prev.kind === seg.kind) {
      prev.seconds += seg.seconds
      prev.endMs = seg.endMs
    } else {
      merged.push({ ...seg })
    }
  }

  // Fold slivers into the larger neighbour so the ribbon stays legible.
  let folded = merged
  while (folded.length > MAX_RIBBON_SEGMENTS || folded.some((s) => s.seconds < RIBBON_MIN_SEGMENT_SECONDS && folded.length > 1)) {
    const idx = smallestSegmentIndex(folded)
    if (folded.length <= 1) break
    const seg = folded[idx]
    const left = folded[idx - 1]
    const right = folded[idx + 1]
    const into = !left ? right : !right ? left : (left.seconds >= right.seconds ? left : right)
    into.seconds += seg.seconds
    into.startMs = Math.min(into.startMs, seg.startMs)
    into.endMs = Math.max(into.endMs, seg.endMs)
    folded = folded.filter((_, i) => i !== idx)
    if (folded.length <= MAX_RIBBON_SEGMENTS && folded.every((s) => s.seconds >= RIBBON_MIN_SEGMENT_SECONDS)) break
  }
  return folded
}

function smallestSegmentIndex(segments: RibbonSegment[]): number {
  let idx = 0
  for (let i = 1; i < segments.length; i++) {
    if (segments[i].seconds < segments[idx].seconds) idx = i
  }
  return idx
}

function selectStandout(blocks: WorkContextBlock[]): WrapStandout | null {
  let best: { block: WorkContextBlock; seconds: number; name: string } | null = null
  for (const block of blocks) {
    if (effectiveBlockKind(block) !== 'work') continue
    const seconds = blockActiveSeconds(block)
    if (seconds < STANDOUT_MIN_SECONDS) continue
    const name = workActivityName(block) || categoryWord(block.dominantCategory)
    if (!best || seconds > best.seconds) best = { block, seconds, name }
  }
  if (!best) return null
  return {
    seconds: best.seconds,
    startClock: formatClock(best.block.startTime),
    endClock: formatClock(best.block.endTime),
    name: best.name,
  }
}

function qualityForSeconds(totalSeconds: number): WrapQuality {
  if (totalSeconds <= 0) return 'empty'
  if (totalSeconds < TOO_EARLY_SECONDS) return 'tooEarly'
  if (totalSeconds < PARTIAL_SECONDS) return 'partial'
  return 'full'
}

function formatClock(ms: number): string {
  return new Date(ms)
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(':00', '')
    .replace(' ', '')
    .toLowerCase()
}

// ─── Duration phrasing ─────────────────────────────────────────────────────────

/** "3h 51m", "52m". Exact so the cards always agree with the totals. */
export function formatHm(seconds: number): string {
  const total = Math.max(0, Math.round(seconds / 60))
  if (total < 60) return `${Math.max(0, total)}m`
  const h = Math.floor(total / 60)
  const m = total % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}
