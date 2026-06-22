// Pure helpers for the wrapped narrative pipeline: facts construction, hash,
// prompt building, AI-output validation, and the deterministic fallback.
// Kept out of the service module so tests can exercise it without dragging in
// the AI orchestration / database layer.

import { createHash } from 'node:crypto'
import { VOICE_SYSTEM_PROMPT } from '../ai/voiceContract'
import {
  classifyDomain,
  isDomainWorkRelevant,
  type DomainClass,
} from '../../renderer/lib/wrappedFacts'
import type {
  AIWrappedNarrative,
  AppCategory,
  BlockConfidence,
  DayTimelinePayload,
  TimelineBlockReviewState,
  WebsiteSummary,
  WorkContextBlock,
  WorkIntentRole,
} from '@shared/types'
import { blockActiveSeconds } from '@shared/blockDuration'
import { isTrustedTimelineBlock } from '@shared/timelineReview'
import { inferWorkIntent } from '@shared/workIntent'
import { effectiveBlockKind, kindForDomain, type WorkKind } from '@shared/workKind'
import { friendlyDomain } from '@shared/humanize'

// ─── Review-grounded facts (Wraps V2) ─────────────────────────────────────────
// The wrap's three-part spine — what mattered, what needs review, what carries
// into tomorrow — is derived from the per-block review state that the timeline
// review pass writes. "Mattered" is trusted, decided work; "needsReview" is the
// pending pile; "carryover" is the open thread to resume. These are what the
// morning/evening narrative is allowed to speak from.

/** A substantial, trusted, non-pending block — work we can stand behind. */
interface WrappedMatteredItem {
  label: string
  category: AppCategory
  intentRole: WorkIntentRole | null
  intentSubject: string | null
  durationSeconds: number
  startClock: string
  endClock: string
  reviewState: TimelineBlockReviewState
  confidence: BlockConfidence
}

/** A pending block the user has not yet confirmed — the review pile. */
interface WrappedReviewItem {
  label: string
  durationSeconds: number
  startClock: string
  endClock: string
}

/** An unresolved thread worth resuming. `open-thread` was still on screen at
 *  day's end; `recurring` spanned multiple blocks. */
interface WrappedCarryoverItem {
  label: string
  intentRole: WorkIntentRole
  intentSubject: string | null
  startClock: string
  endClock: string
  reason: 'open-thread' | 'recurring'
}

// ─── Facts shape passed to the AI ─────────────────────────────────────────────
// Compact on purpose: every key has to earn its prompt-token cost. Anything
// beyond this list is unsupported context the model can hallucinate around.
export interface WrappedFacts {
  date: string
  totalSeconds: number
  focusSeconds: number
  focusPct: number
  blockCount: number
  totalSwitches: number
  switchesPerHour: number
  dominantCategory: AppCategory | 'unknown'
  dominantCategoryPct: number
  quality: 'empty' | 'tooEarly' | 'partial' | 'full'
  peakBlock: {
    label: string
    durationSeconds: number
    startClock: string
    endClock: string
    category: AppCategory
  } | null
  topApp: {
    appName: string
    durationSeconds: number
    category: AppCategory
    isBrowser: boolean
  } | null
  topDomain: {
    domain: string
    totalSeconds: number
    classification: DomainClass
    isWorkRelevant: boolean
  } | null
  // ── Review-grounded spine (Wraps V2) ──
  /** Top trusted, decided (non-pending) WORK blocks — never leisure. */
  mattered: WrappedMatteredItem[]
  /** Pending blocks awaiting confirmation. count is the headline number. */
  needsReview: { count: number; items: WrappedReviewItem[] }
  /** Unresolved WORK threads to carry into tomorrow / resume in the morning. */
  carryover: WrappedCarryoverItem[]
  // ── One reconciled kind breakdown (Wraps V2.1) ──
  // Computed once from the trusted blocks and fed to every card, so no two cards
  // can contradict (the "100% entertainment" vs "72% browsing" bug). Percentages
  // live only in the "where the time went" card, derived from these seconds.
  kindBreakdown: KindBreakdown
}

interface KindBreakdown {
  work: number
  leisure: number
  personal: number
  idle: number
  /** The kind with the most active seconds. */
  dominant: WorkKind
  /** Friendly top leisure surfaces ("YouTube", "Netflix"), most time first. */
  topLeisure: string[]
  /** Whether the day is mostly leisure (leisure ≥ work and ≥ a real share). */
  isLeisureDay: boolean
}

// ─── Facts construction ───────────────────────────────────────────────────────

const TOO_EARLY_SECONDS = 5 * 60
const PARTIAL_SECONDS = 45 * 60

function qualityForSeconds(totalSeconds: number): WrappedFacts['quality'] {
  if (totalSeconds <= 0) return 'empty'
  if (totalSeconds < TOO_EARLY_SECONDS) return 'tooEarly'
  if (totalSeconds < PARTIAL_SECONDS) return 'partial'
  return 'full'
}

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

// ─── Review-grounded derivation ────────────────────────────────────────────────

const MATTERED_MIN_SECONDS = 10 * 60
const NEEDS_REVIEW_MIN_SECONDS = 5 * 60
const CARRYOVER_MIN_SECONDS = 10 * 60
const MAX_MATTERED = 3
const MAX_NEEDS_REVIEW_ITEMS = 3
// Roles that imply an ongoing deliverable worth resuming. Ambient/ambiguous
// (idle, scattered) and bare communication are not threads you "pick back up".
const CARRYOVER_DOING_ROLES: ReadonlySet<WorkIntentRole> = new Set<WorkIntentRole>([
  'execution', 'research', 'review', 'coordination',
])

function isSubstantiveCategory(category: AppCategory): boolean {
  return category !== 'system' && category !== 'uncategorized'
}

// Prefer an explicit user correction over the generated value. Mirrors
// reviewedWorkIntent() in aiService and userVisibleLabelForBlock in workBlocks,
// re-stated here so this module stays free of the DB/orchestration layer.
function effectiveLabel(block: WorkContextBlock): string {
  const corrected = block.review?.correctedLabel?.trim()
  if (corrected) return corrected
  return block.label.current.trim()
}

function effectiveIntent(block: WorkContextBlock): { role: WorkIntentRole; subject: string | null } {
  const intent = inferWorkIntent(block)
  return {
    role: block.review?.correctedIntentRole ?? intent.role,
    subject: block.review?.correctedIntentSubject ?? intent.subject,
  }
}

function isResumableSubject(subject: string | null): subject is string {
  return subject != null && subject.trim().length >= 3
}

// "What mattered": the longest trusted blocks the user has decided on (or that
// the system auto-approved) — never the pending pile.
function deriveMattered(blocks: WorkContextBlock[]): WrappedMatteredItem[] {
  return blocks
    .filter((b) => b.review.state !== 'pending'
      && effectiveBlockKind(b) === 'work'
      && isSubstantiveCategory(b.dominantCategory)
      && blockActiveSeconds(b) >= MATTERED_MIN_SECONDS)
    .sort((a, b) => blockActiveSeconds(b) - blockActiveSeconds(a))
    .slice(0, MAX_MATTERED)
    .map((b) => {
      const intent = effectiveIntent(b)
      return {
        label: effectiveLabel(b).slice(0, 60),
        category: b.dominantCategory,
        intentRole: intent.role,
        intentSubject: intent.subject,
        durationSeconds: Math.round(blockActiveSeconds(b)),
        startClock: formatClock(b.startTime),
        endClock: formatClock(b.endTime),
        reviewState: b.review.state,
        confidence: b.confidence,
      }
    })
}

// "What needs review": substantial pending blocks. The count is the load-bearing
// claim the wrap surfaces; items give the narrative something concrete to name.
function deriveNeedsReview(blocks: WorkContextBlock[]): WrappedFacts['needsReview'] {
  const pending = blocks
    .filter((b) => b.review.state === 'pending' && blockActiveSeconds(b) >= NEEDS_REVIEW_MIN_SECONDS)
    .sort((a, b) => blockActiveSeconds(b) - blockActiveSeconds(a))
  return {
    count: pending.length,
    items: pending.slice(0, MAX_NEEDS_REVIEW_ITEMS).map((b) => ({
      label: effectiveLabel(b).slice(0, 60),
      durationSeconds: Math.round(blockActiveSeconds(b)),
      startClock: formatClock(b.startTime),
      endClock: formatClock(b.endTime),
    })),
  }
}

// "What carries into tomorrow": the open thread still on screen at day's end,
// plus one recurring thread that spanned the day. Each must trace to a real
// trusted block with a concrete subject — no inventing follow-ups.
function deriveCarryover(blocks: WorkContextBlock[]): WrappedCarryoverItem[] {
  const candidates = blocks
    .map((b) => ({ block: b, intent: effectiveIntent(b), active: blockActiveSeconds(b) }))
    .filter(({ block, intent, active }) =>
      effectiveBlockKind(block) === 'work'
      && active >= CARRYOVER_MIN_SECONDS
      && isResumableSubject(intent.subject)
      && CARRYOVER_DOING_ROLES.has(intent.role))
  if (candidates.length === 0) return []

  const toItem = (c: { block: WorkContextBlock; intent: { role: WorkIntentRole; subject: string | null } }, reason: WrappedCarryoverItem['reason']): WrappedCarryoverItem => ({
    label: effectiveLabel(c.block).slice(0, 60),
    intentRole: c.intent.role,
    intentSubject: c.intent.subject,
    startClock: formatClock(c.block.startTime),
    endClock: formatClock(c.block.endTime),
    reason,
  })

  // Open thread: the substantial thread still running latest in the day.
  const openThread = candidates.reduce((latest, c) => (c.block.endTime > latest.block.endTime ? c : latest))
  const openSubjectKey = (openThread.intent.subject ?? '').toLowerCase()
  const items: WrappedCarryoverItem[] = [toItem(openThread, 'open-thread')]

  // Recurring thread: a different subject that showed up across >= 2 blocks.
  const bySubject = new Map<string, { candidate: typeof candidates[number]; count: number; seconds: number }>()
  for (const c of candidates) {
    const key = (c.intent.subject ?? '').toLowerCase()
    const prev = bySubject.get(key)
    if (prev) { prev.count += 1; prev.seconds += c.active }
    else bySubject.set(key, { candidate: c, count: 1, seconds: c.active })
  }
  const recurring = [...bySubject.values()]
    .filter((e) => e.count >= 2 && (e.candidate.intent.subject ?? '').toLowerCase() !== openSubjectKey)
    .sort((a, b) => b.seconds - a.seconds)[0]
  if (recurring) items.push(toItem(recurring.candidate, 'recurring'))

  return items
}

// The single reconciled split of the day by kind. Every card reads from this,
// so the shape sentence, the breakdown, and "what you worked on" can never
// disagree. Active seconds (not span) keep it honest against idle stretches.
function deriveKindBreakdown(blocks: WorkContextBlock[]): KindBreakdown {
  const totals: Record<WorkKind, number> = { work: 0, leisure: 0, personal: 0, idle: 0 }
  const leisureByDomain = new Map<string, number>()
  for (const block of blocks) {
    const kind = effectiveBlockKind(block)
    const seconds = blockActiveSeconds(block)
    totals[kind] += seconds
    if (kind === 'leisure') {
      for (const site of block.websites) {
        if (kindForDomain(site.domain) !== 'leisure') continue
        const name = friendlyDomain(site.domain)
        if (name) leisureByDomain.set(name, (leisureByDomain.get(name) ?? 0) + site.totalSeconds)
      }
    }
  }
  const dominant = (Object.entries(totals) as Array<[WorkKind, number]>)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'personal'
  const topLeisure = [...leisureByDomain.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name)
  // A leisure day: leisure is the dominant kind and clears a real share, so a
  // few minutes of background video on a coding day never flips the verdict.
  const tracked = totals.work + totals.leisure + totals.personal
  const isLeisureDay = tracked > 0 && totals.leisure >= totals.work && totals.leisure / tracked >= 0.5

  return { ...totals, dominant, topLeisure, isLeisureDay }
}

export function buildWrappedFactsFromPayload(payload: DayTimelinePayload): WrappedFacts {
  const totalSeconds = Math.max(0, payload.totalSeconds)
  const quality = qualityForSeconds(totalSeconds)

  const hasTimelineBlocks = payload.blocks.length > 0
  const blocks = payload.blocks.filter(isTrustedTimelineBlock)
  const totalSwitches = blocks.reduce((sum, b) => sum + (b.switchCount ?? 0), 0)
  const hoursTracked = totalSeconds / 3600
  const switchesPerHour = hoursTracked > 0 ? Math.round(totalSwitches / hoursTracked) : 0

  // Dominant category from trusted blocks, falling back to sessions when there
  // is no reviewed timeline graph yet.
  const byCategory = new Map<AppCategory, number>()
  if (blocks.length > 0) {
    for (const block of blocks) {
      const seconds = blockActiveSeconds(block)
      byCategory.set(block.dominantCategory, (byCategory.get(block.dominantCategory) ?? 0) + seconds)
    }
  } else if (!hasTimelineBlocks && payload.sessions.length > 0) {
    for (const session of payload.sessions) {
      if (session.category === 'system' || session.category === 'uncategorized') continue
      byCategory.set(session.category, (byCategory.get(session.category) ?? 0) + Math.max(0, session.durationSeconds))
    }
  }
  const categoryEntries = [...byCategory.entries()].sort((a, b) => b[1] - a[1])
  const categoryTotal = categoryEntries.reduce((s, [, v]) => s + v, 0)
  const topCategory = categoryEntries[0]
  const dominantCategory: AppCategory | 'unknown' = topCategory?.[0] ?? 'unknown'
  const dominantCategoryPct = categoryTotal > 0 && topCategory
    ? Math.round((topCategory[1] / categoryTotal) * 100)
    : 0

  // Peak block: largest non-system block.
  let peak: WrappedFacts['peakBlock'] = null
  for (const block of blocks) {
    if (block.dominantCategory === 'system' || block.dominantCategory === 'uncategorized') continue
    const durationSeconds = blockActiveSeconds(block)
    if (durationSeconds < 10 * 60) continue
    if (!peak || durationSeconds > peak.durationSeconds) {
      peak = {
        label: block.label.current.trim().slice(0, 60),
        durationSeconds,
        startClock: formatClock(block.startTime),
        endClock: formatClock(block.endTime),
        category: block.dominantCategory,
      }
    }
  }

  // Top app: largest non-system session aggregate.
  const appMap = new Map<string, { appName: string; durationSeconds: number; category: AppCategory; isBrowser: boolean }>()
  const browserFlags = new Map<string, boolean>()
  for (const b of blocks) {
    for (const a of b.topApps) browserFlags.set(a.appName, a.isBrowser)
  }
  if (blocks.length > 0) {
    for (const block of blocks) {
      for (const app of block.topApps) {
        if (app.category === 'system') continue
        const entry = appMap.get(app.appName)
        if (entry) {
          entry.durationSeconds += Math.max(0, app.totalSeconds)
        } else {
          appMap.set(app.appName, {
            appName: app.appName,
            durationSeconds: Math.max(0, app.totalSeconds),
            category: app.category,
            isBrowser: app.isBrowser,
          })
        }
      }
    }
  } else if (!hasTimelineBlocks) {
    for (const session of payload.sessions) {
      if (session.category === 'system') continue
      const entry = appMap.get(session.appName)
      const isBrowser = browserFlags.get(session.appName) ?? (session.category === 'browsing')
      if (entry) {
        entry.durationSeconds += Math.max(0, session.durationSeconds)
      } else {
        appMap.set(session.appName, {
          appName: session.appName,
          durationSeconds: Math.max(0, session.durationSeconds),
          category: session.category,
          isBrowser,
        })
      }
    }
  }
  const topApp = appMap.size > 0
    ? [...appMap.values()].sort((a, b) => b.durationSeconds - a.durationSeconds)[0] ?? null
    : null

  // Top domain.
  const trustedWebsiteSeconds = new Map<string, WebsiteSummary>()
  for (const block of blocks) {
    for (const site of block.websites) {
      const existing = trustedWebsiteSeconds.get(site.domain)
      if (existing) {
        existing.totalSeconds += site.totalSeconds
        existing.visitCount += site.visitCount
      } else {
        trustedWebsiteSeconds.set(site.domain, { ...site })
      }
    }
  }
  const sortedWebsites: WebsiteSummary[] = (trustedWebsiteSeconds.size > 0 || hasTimelineBlocks ? [...trustedWebsiteSeconds.values()] : [...payload.websites])
    .sort((a, b) => b.totalSeconds - a.totalSeconds)
  const topSite = sortedWebsites[0] ?? null
  const topDomain = topSite ? {
    domain: topSite.domain,
    totalSeconds: topSite.totalSeconds,
    classification: classifyDomain(topSite.domain),
    isWorkRelevant: isDomainWorkRelevant(classifyDomain(topSite.domain)),
  } : null

  return {
    date: payload.date,
    totalSeconds,
    focusSeconds: Math.max(0, payload.focusSeconds),
    focusPct: Math.max(0, Math.min(100, payload.focusPct)),
    blockCount: blocks.length,
    totalSwitches,
    switchesPerHour,
    dominantCategory,
    dominantCategoryPct,
    quality,
    peakBlock: peak,
    topApp: topApp ? { ...topApp, durationSeconds: Math.round(topApp.durationSeconds) } : null,
    topDomain,
    mattered: deriveMattered(blocks),
    needsReview: deriveNeedsReview(blocks),
    carryover: deriveCarryover(blocks),
    kindBreakdown: deriveKindBreakdown(blocks),
  }
}

// ─── Hashing & cache key ──────────────────────────────────────────────────────

export function computeFactsHash(facts: WrappedFacts): string {
  // Buckets total/focus to ~minute granularity so trivial reshuffles don't
  // bust the cache while real changes still do.
  const bucket = (s: number) => Math.round(s / 60)
  const canonical = JSON.stringify({
    date: facts.date,
    quality: facts.quality,
    total: bucket(facts.totalSeconds),
    focus: bucket(facts.focusSeconds),
    focusPct: facts.focusPct,
    blocks: facts.blockCount,
    switches: facts.totalSwitches,
    swPerH: facts.switchesPerHour,
    dom: facts.dominantCategory,
    domPct: facts.dominantCategoryPct,
    peak: facts.peakBlock ? {
      label: facts.peakBlock.label.toLowerCase(),
      d: bucket(facts.peakBlock.durationSeconds),
      cat: facts.peakBlock.category,
    } : null,
    topApp: facts.topApp ? {
      name: facts.topApp.appName.toLowerCase(),
      d: bucket(facts.topApp.durationSeconds),
      cat: facts.topApp.category,
    } : null,
    topDomain: facts.topDomain ? {
      domain: facts.topDomain.domain.toLowerCase(),
      d: bucket(facts.topDomain.totalSeconds),
      cls: facts.topDomain.classification,
    } : null,
    // Review-grounded spine must bust the cache: approving a pending block, or
    // correcting a label/intent, changes mattered/needsReview/carryover without
    // moving the totals — the narrative has to regenerate to stay honest.
    mattered: facts.mattered.map((m) => ({
      l: m.label.toLowerCase(),
      d: bucket(m.durationSeconds),
      r: m.intentRole,
      s: m.intentSubject?.toLowerCase() ?? null,
      st: m.reviewState,
    })),
    needsReview: {
      n: facts.needsReview.count,
      items: facts.needsReview.items.map((i) => i.label.toLowerCase()),
    },
    carryover: facts.carryover.map((c) => ({
      l: c.label.toLowerCase(),
      r: c.intentRole,
      s: c.intentSubject?.toLowerCase() ?? null,
      why: c.reason,
    })),
  })
  return createHash('sha1').update(canonical).digest('hex').slice(0, 12)
}

export function wrappedNarrativeCacheKey(facts: WrappedFacts, factsHash: string): string {
  return `${facts.date}|${factsHash}`
}

// ─── Prompt construction ──────────────────────────────────────────────────────

export function buildWrappedPrompts(facts: WrappedFacts): { systemPrompt: string; userMessage: string } {
  const systemPrompt = [
    VOICE_SYSTEM_PROMPT,
    'You are Daylens, narrating a Wrapped-style recap of one person\'s working day.',
    'You will receive a compact JSON facts object derived deterministically from the user\'s local activity.',
    'Return STRICT JSON with exactly these keys: "lead" (string), "peakInsight" (string or null), "nudge" (string or null), and "slides" (object with keys "scale", "focus", "topApp", "switching", "identity", "closing", each a string or null).',
    'No prose outside the JSON. No code fences. No emoji. No markdown.',
    'Voice: warm, direct, second-person, and easy to understand — like a thoughtful colleague who has been paying attention. No motivational filler. No "great work", no "you crushed it", no "let\'s dive in", no exclamation marks. Specific over generic.',
    'Each string is one sentence, 24-170 characters. Never two sentences. Never ask the user a question.',
    'The day has a kind split in facts.kindBreakdown: work, leisure, personal seconds. This ONE breakdown is the truth; every line must agree with it. Leisure is first-class and stated plainly without judgment — watching is never "work", never "focus", never "what mattered".',
    'lead — Shape (always): one honest sentence on the real split. If facts.kindBreakdown.isLeisureDay, say it was mostly rest (e.g. "Mostly a rest day — Xh watching, Ym of work"); otherwise lead on the work and, when facts.mattered is non-empty, name facts.mattered[0]. Never say "100%". Never score focus on a rest day.',
    'peakInsight: 1 sentence on the peak WORK stretch\'s time range. null if facts.peakBlock is null or it was a leisure day.',
    'nudge — Open thread: only when facts.carryover is non-empty, name facts.carryover[0] (its intentSubject, or label) as the work thread to pick up tomorrow. null if facts.carryover is empty, quality is "partial", or it was a rest day. Never invent a follow-up.',
    'slides.scale — Where the time went (always): the single reconciled breakdown from facts.kindBreakdown (e.g. "Work 52m (subject) · Leisure 3h 51m (YouTube, Netflix)"). This is the ONLY line allowed to carry the split; nothing else may restate percentages.',
    'slides.topApp — What you worked on: only when facts.kindBreakdown.work is a real amount and facts.mattered is non-empty, name facts.mattered[0]\'s subject and time. null on a pure-leisure day.',
    'slides.focus: null whenever facts.kindBreakdown.isLeisureDay is true or facts.kindBreakdown.work is 0; otherwise a brief, non-numeric note on how the working time held together.',
    'slides.switching: null. slides.identity: null. These are redundant padding — do not fill them.',
    'slides.closing — Close (always): a quiet factual sign-off. No motivation, no homework, no "needs review", no nudge to the timeline. "That\'s the day." is a fine default.',
    'Never invent a duration. Any hours claimed must match facts.totalSeconds/3600 or one of the kindBreakdown sub-totals within one hour.',
    'Never invent app, domain, or project names not present in the facts JSON. Only name a subject that appears in facts.mattered or facts.carryover.',
    'Never assign homework, never tell the user to review anything, never scold. No "distraction", no "books you didn\'t read", no extrapolation, no monthly comparison.',
    'Never describe yourself or the model. Never say "as an AI" or similar.',
    'If facts.quality is "partial", be modest across all slides and set "nudge" to null.',
  ].join(' ')

  const userMessage = [
    `Date: ${facts.date}`,
    '',
    'Compact facts JSON:',
    JSON.stringify(facts, null, 2),
    '',
    'Return ONLY the JSON object.',
  ].join('\n')

  return { systemPrompt, userMessage }
}

// ─── Validation ───────────────────────────────────────────────────────────────

const EMOJI_REGEX = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/u
const MIN_FIELD_CHARS = 24
const MAX_FIELD_CHARS = 200

export function validateWrappedNarrativeResponse(
  raw: string,
  facts: WrappedFacts,
  factsHash: string,
): AIWrappedNarrative | null {
  const jsonText = stripCodeFence(raw).trim()
  if (!jsonText) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null

  const obj = parsed as Record<string, unknown>
  const lead = typeof obj.lead === 'string' ? obj.lead.trim() : ''
  const peakInsightRaw = obj.peakInsight
  const nudgeRaw = obj.nudge

  if (!isFieldValid(lead, false, facts)) return null

  const peakInsight = normalizeOptional(peakInsightRaw)
  if (peakInsight != null && !isFieldValid(peakInsight, true, facts)) return null
  // peakInsight should be null when there's no peak block in the facts —
  // otherwise the model is inventing structure.
  if (peakInsight != null && !facts.peakBlock) return null

  const nudge = normalizeOptional(nudgeRaw)
  if (nudge != null && !isFieldValid(nudge, true, facts)) return null

  const slidesRaw = (obj.slides && typeof obj.slides === 'object') ? obj.slides as Record<string, unknown> : {}
  const slides = {
    scale:     validateSlideLine(slidesRaw.scale, facts),
    focus:     facts.focusSeconds > 0 ? validateSlideLine(slidesRaw.focus, facts) : null,
    topApp:    facts.topApp ? validateSlideLine(slidesRaw.topApp, facts) : null,
    switching: validateSlideLine(slidesRaw.switching, facts),
    identity:  validateSlideLine(slidesRaw.identity, facts),
    closing:   validateSlideLine(slidesRaw.closing, facts),
  }

  return {
    lead,
    peakInsight,
    nudge,
    slides,
    source: 'ai',
    factsHash,
  }
}

function validateSlideLine(value: unknown, facts: WrappedFacts): string | null {
  const trimmed = normalizeOptional(value)
  if (trimmed == null) return null
  if (!isFieldValid(trimmed, false, facts)) return null
  if (containsBannedVocabulary(trimmed)) return null
  return trimmed
}

const BANNED_PHRASES = [
  'dive into', 'unleash', 'navigate the landscape', 'in today\'s fast-paced',
  'game-changing', 'seamless', 'elevate', 'great question', 'let\'s explore',
  'at the end of the day', 'fascinating perspective', 'you\'re absolutely right',
  'harness the power', 'empower', 'robust', 'streamline', 'crush it', 'crushed it',
  'you\'ve got this', 'you got this', 'great work', 'great job', 'amazing job',
]

function containsBannedVocabulary(text: string): boolean {
  const lower = text.toLowerCase()
  return BANNED_PHRASES.some(phrase => lower.includes(phrase))
}

function normalizeOptional(value: unknown): string | null {
  if (value == null) return null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^null$/i.test(trimmed)) return null
  return trimmed
}

function isFieldValid(value: string, allowQuestion: boolean, facts: WrappedFacts): boolean {
  if (!value) return false
  if (value.length < MIN_FIELD_CHARS) return false
  if (value.length > MAX_FIELD_CHARS) return false
  if (EMOJI_REGEX.test(value)) return false
  if (!allowQuestion && /\?$/.test(value)) return false
  if (/```/.test(value)) return false
  if (/\b(I'?m not sure|couldn'?t|cannot determine|no data|n\/?a)\b/i.test(value)) return false
  if (/^\s*\{/.test(value)) return false
  if (!claimedHoursAreConsistent(value, facts)) return false
  if (mentionsUngroundedDomainOrApp(value, facts)) return false
  if (mentionsHomeworkOrGuilt(value)) return false
  // No card may claim a "100%" share — that was the Wave 1 contradiction.
  if (/\b100\s*%/.test(value)) return false
  // No focus scoring on a rest day.
  if (facts.kindBreakdown?.isLeisureDay && (/\d+\s*%/.test(value) || /\bfocus(?:ed)?\b/i.test(value))) return false
  return true
}

// Homework / guilt / extrapolation the wrap must never speak. Mirrors the eval's
// WRAP_GUILT_PATTERNS so the AI path is held to the same bar as the fallback.
const HOMEWORK_GUILT_PATTERNS = [
  /needs?\b[^.]{0,24}\breview\b/i,
  /review in the timeline/i,
  /\bdistraction(?:s)?\b/i,
  /books you (?:didn'?t|did not)/i,
  /\blost to\b/i,
  /extrapolat/i,
]

function mentionsHomeworkOrGuilt(text: string): boolean {
  return HOMEWORK_GUILT_PATTERNS.some((pattern) => pattern.test(text))
}

function claimedHoursAreConsistent(text: string, facts: WrappedFacts): boolean {
  // Match "5 hours", "5h", "5 hrs". Minutes are noisy enough that we don't
  // bother validating them — hours are the load-bearing claim.
  const matches = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h\b)/gi)]
  if (matches.length === 0) return true
  const actualHours = facts.totalSeconds / 3600
  for (const m of matches) {
    const claimed = Number(m[1])
    if (!Number.isFinite(claimed)) return false
    // Allow a 1-hour tolerance — phrasings like "about 6 hours" should pass
    // when the actual is 5.4. Anything beyond that is invented.
    if (Math.abs(claimed - actualHours) > 1.05) return false
  }
  return true
}

function mentionsUngroundedDomainOrApp(text: string, facts: WrappedFacts): boolean {
  // Flag bare ".com" domains the facts don't list. The facts only carry the
  // single top domain, so any other ".com" tokens in the narrative are at
  // best decorative and at worst hallucinated.
  const domainMatches = text.match(/\b([a-z0-9-]+\.(?:com|org|io|dev|app|net|ai|co))\b/gi) ?? []
  for (const m of domainMatches) {
    const normalized = m.toLowerCase().replace(/^www\./, '')
    if (facts.topDomain && facts.topDomain.domain.toLowerCase().replace(/^www\./, '') === normalized) continue
    return true
  }
  return false
}

function stripCodeFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return fenced?.[1]?.trim() ?? text
}

// ─── Fallback narrative (deterministic) ───────────────────────────────────────

const EMPTY_SLIDES: AIWrappedNarrative['slides'] = {
  scale: null, focus: null, topApp: null, switching: null, identity: null, closing: null,
}

export function buildFallbackNarrative(facts: WrappedFacts, factsHash: string): AIWrappedNarrative {
  if (facts.quality === 'empty') {
    return {
      lead: 'Daylens did not see enough activity yet to tell a story about this day.',
      peakInsight: null,
      nudge: null,
      slides: { ...EMPTY_SLIDES },
      source: 'fallback',
      factsHash,
    }
  }
  if (facts.quality === 'tooEarly') {
    return {
      lead: 'The day is still warming up — a few more minutes of activity and a real recap will surface.',
      peakInsight: null,
      nudge: null,
      slides: { ...EMPTY_SLIDES },
      source: 'fallback',
      factsHash,
    }
  }

  const kb = facts.kindBreakdown ?? { work: facts.totalSeconds, leisure: 0, personal: 0, idle: 0, dominant: 'work' as WorkKind, topLeisure: [], isLeisureDay: false }
  const workLabel = durationPhrase(kb.work)
  const matteredSubject = facts.mattered.find((m) => m.intentSubject)?.intentSubject
    ?? facts.mattered[0]?.label
    ?? null

  // Card 1 — Shape (always). One honest sentence on the real split; never
  // "100%", never focus framing on a rest day.
  let lead: string
  if (kb.isLeisureDay) {
    const watchLabel = durationPhrase(kb.leisure)
    lead = kb.work > 0
      ? `Mostly a rest day — ${watchLabel} watching, ${workLabel} of work.`
      : `A rest day — ${watchLabel} of watching and browsing.`
  } else if (kb.work > 0) {
    lead = matteredSubject
      ? `A working day — ${workLabel} of work, mostly on ${matteredSubject}.`
      : `A working day — ${workLabel} of focused work.`
  } else {
    lead = `A quiet day — ${durationPhrase(facts.totalSeconds)} tracked, no clear work thread.`
  }

  // Card 4 — Open thread (only a real unfinished WORK thread). On a leisure day
  // with no work carryover this is simply absent — no invented homework.
  let nudge: string | null = null
  if (facts.quality !== 'partial') {
    const carry = facts.carryover[0] ?? null
    if (carry) {
      const what = carry.intentSubject ?? carry.label
      nudge = `${what} was still open at ${carry.endClock} — worth picking it up tomorrow.`
    }
  }

  // peakInsight is a work-only nicety; never narrate a "peak" on a leisure day.
  const peakInsight = (!kb.isLeisureDay && facts.peakBlock && kb.work > 0)
    ? `The clearest stretch ran ${facts.peakBlock.startClock} to ${facts.peakBlock.endClock}.`
    : null

  const slides = buildFallbackSlides(facts)
  return { lead, peakInsight, nudge, slides, source: 'fallback', factsHash }
}

// Exact, humane duration: "3h 51m", "52m". Never rounded to a bare hour, so the
// breakdown numbers always match what the cards display.
function durationPhrase(seconds: number): string {
  const total = Math.max(0, Math.round(seconds / 60))
  if (total < 60) return `${Math.max(1, total)}m`
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
}

function buildFallbackSlides(facts: WrappedFacts): AIWrappedNarrative['slides'] {
  const kb = facts.kindBreakdown ?? { work: facts.totalSeconds, leisure: 0, personal: 0, idle: 0, dominant: 'work' as WorkKind, topLeisure: [], isLeisureDay: false }

  // Card 3 — Where the time went (always). The ONE reconciled breakdown; the
  // only place numbers for the split live, so nothing can contradict it.
  const parts: string[] = []
  if (kb.work > 0) {
    const subject = facts.mattered.find((m) => m.intentSubject)?.intentSubject ?? facts.mattered[0]?.label
    parts.push(`Work ${durationPhrase(kb.work)}${subject ? ` (${subject})` : ''}`)
  }
  if (kb.leisure > 0) {
    const surfaces = kb.topLeisure.slice(0, 2).join(', ')
    parts.push(`Leisure ${durationPhrase(kb.leisure)}${surfaces ? ` (${surfaces})` : ''}`)
  }
  if (kb.personal >= 5 * 60) {
    parts.push(`Personal ${durationPhrase(kb.personal)}`)
  }
  const scale = parts.length > 0 ? `${parts.join(' · ')}.` : null

  // Card 2 — What you worked on (only if there is real work). Omitted entirely
  // on a pure-leisure day.
  const topApp = (kb.work >= 15 * 60 && facts.mattered.length > 0)
    ? `${facts.mattered[0].intentSubject ?? facts.mattered[0].label} took the most of the working time — ${durationPhrase(facts.mattered[0].durationSeconds)}.`
    : null

  // Focus framing is for work days only — never score a rest day for focus.
  const focus = (!kb.isLeisureDay && facts.focusSeconds > 0 && kb.work > 0)
    ? (facts.focusPct >= 60
        ? `Focus held for much of the working time.`
        : `Focus came in pieces across the working time.`)
    : null

  // switching / identity are redundant padding under the earn-each-slide rule.
  const switching = null
  const identity = null

  // Card 5 — Close (always). A quiet factual sign-off. No homework, no review
  // nudge, no motivation.
  const closing = "That's the day."

  return { scale, focus, topApp, switching, identity, closing }
}
