// Moment evidence — what was actually on screen at a specific clock time.
//
// Extracted from insightsQueryRouter when chat moved to the agent loop
// so the "one page at the asked minute, never the whole block"
// fix survives the router. Returns structured
// data; the caller (the chat agent, tests, the bench) does the phrasing.
import type Database from 'better-sqlite3'
import { localDateString } from './localDate'
import { getTimelineDayPayload, userVisibleLabelForBlock } from '../services/workBlocks'

export interface MomentPageCandidate {
  pageTitle?: string | null
  displayTitle?: string
  host?: string | null
  domain?: string
  subtitle?: string | null
  totalSeconds?: number
  overlapMs?: number
  url?: string | null
}

function looksLikeUrlFragmentTitle(value: string): boolean {
  if (/^https?:\/\//i.test(value)) return true
  const stripped = value.trim()
  if (!stripped.includes(' ') && stripped.length >= 24 && /^[A-Za-z0-9_\-./?&=%]+$/.test(stripped)) return true
  if (/^[A-Za-z0-9+/=_-]{20,}$/.test(stripped) && !/\s/.test(stripped)) return true
  return false
}

const GENERIC_MOMENT_TITLE_PATTERNS = [
  /^youtube$/i,
  /^\(\d+\)\s*youtube$/i,
  /^youtube\s*[-–—]\s*home$/i,
  /^new tab$/i,
  /^home$/i,
]

function momentTitleLooksGeneric(title: string, domain: string | null | undefined): boolean {
  const normalized = title.trim()
  if (!normalized) return true
  if (GENERIC_MOMENT_TITLE_PATTERNS.some((pattern) => pattern.test(normalized))) return true
  if (!domain) return false
  const lower = normalized.toLowerCase()
  const simplified = domain.toLowerCase().replace(/^www\./, '')
  return lower === simplified || lower === simplified.replace(/\.(com|org|io|net)$/g, '')
}

function sanitizeMomentPageTitle(
  page: MomentPageCandidate,
): { title: string; host: string | null } | null {
  const host = (page.host ?? page.domain ?? page.subtitle ?? '').trim() || null
  for (const raw of [page.pageTitle, page.displayTitle]) {
    if (!raw) continue
    const value = String(raw).trim()
    if (!value || looksLikeUrlFragmentTitle(value)) continue
    if (momentTitleLooksGeneric(value, host)) continue
    return { title: value, host }
  }
  return null
}

function isVideoWatchHost(host: string | null | undefined, url?: string | null): boolean {
  const haystack = `${host ?? ''} ${url ?? ''}`.toLowerCase()
  return /youtube\.com|youtu\.be|vimeo\.com|netflix\.com|twitch\.tv|disneyplus\.com|hulu\.com/.test(haystack)
}

/**
 * Visits whose interval covers the asked clock time — not merely visits that
 * started somewhere inside the surrounding block. A 3:00pm question must
 * resolve the tab open at 3:00pm, not the four longest pages from 2:14–3:00.
 */
export function getVisitsOverlappingMoment(
  db: Database.Database,
  momentMs: number,
): Array<{
  pageTitle: string | null
  domain: string
  url: string | null
  visitTime: number
  durationSec: number
  overlapMs: number
}> {
  const lookbackMs = 6 * 60 * 60 * 1000
  const rows = db.prepare(`
    SELECT
      domain,
      page_title AS pageTitle,
      url,
      visit_time AS visitTime,
      duration_sec AS durationSec
    FROM website_visits
    WHERE visit_time <= ?
      AND visit_time >= ?
      AND (visit_time + (MAX(duration_sec, 1) * 1000)) >= ?
    ORDER BY duration_sec DESC, visit_time DESC
    LIMIT 20
  `).all(momentMs, momentMs - lookbackMs, momentMs) as Array<{
    pageTitle: string | null
    domain: string
    url: string | null
    visitTime: number
    durationSec: number
  }>

  return rows.map((row) => {
    const endMs = row.visitTime + Math.max(1, row.durationSec) * 1000
    const overlapMs = Math.max(0, Math.min(endMs, momentMs + 1) - Math.max(row.visitTime, momentMs))
    return { ...row, overlapMs: Math.max(overlapMs, 1) }
  })
}

/**
 * Picks the page that answers a moment question. Prefers visits overlapping
 * the clock time; falls back to the longest useful pageRef in the covering
 * block. Returns one title, never a dump of everything in the stretch.
 */
export function resolveMomentPageEvidence(
  pages: MomentPageCandidate[],
  overlappingVisits: MomentPageCandidate[] = [],
): { title: string; host: string | null; verb: 'watching' | 'viewing' } | null {
  const rankedVisits = [...overlappingVisits].sort((left, right) => {
    const overlapDelta = (right.overlapMs ?? 0) - (left.overlapMs ?? 0)
    if (overlapDelta !== 0) return overlapDelta
    return (right.totalSeconds ?? 0) - (left.totalSeconds ?? 0)
  })
  for (const visit of rankedVisits) {
    const cleaned = sanitizeMomentPageTitle(visit)
    if (!cleaned) continue
    const verb = isVideoWatchHost(cleaned.host, visit.url) ? 'watching' : 'viewing'
    return { ...cleaned, verb }
  }

  const rankedPages = [...pages].sort((left, right) => (right.totalSeconds ?? 0) - (left.totalSeconds ?? 0))
  let fallbackHost: string | null = null
  for (const page of rankedPages) {
    const host = (page.host ?? page.domain ?? page.subtitle ?? '').trim() || null
    if (host && !fallbackHost) fallbackHost = host
    const cleaned = sanitizeMomentPageTitle(page)
    if (!cleaned) continue
    const verb = isVideoWatchHost(cleaned.host, page.url) ? 'watching' : 'viewing'
    return { ...cleaned, verb }
  }
  if (fallbackHost) {
    return { title: `${fallbackHost} (no specific page title captured)`, host: fallbackHost, verb: 'viewing' }
  }
  return null
}

export interface MomentEvidence {
  found: boolean
  reason?: string
  askedTime: string
  date: string
  /** The one page most plausibly on screen at the asked minute. */
  activePage: {
    title: string
    host: string | null
    url: string | null
    verb: 'watching' | 'viewing'
    visitTime: number | null
    durationSec: number | null
  } | null
  /** The timeline block covering the moment, if any. */
  coveringBlock: {
    label: string
    startTime: number
    endTime: number
    topApps: Array<{ appName: string; totalSeconds: number }>
  } | null
  /** When nothing covers the moment: the nearest block that day. */
  nearestBlock: {
    label: string
    startTime: number
    endTime: number
    direction: 'before' | 'after'
  } | null
  /** All visits overlapping the asked minute, best first (for follow-ups). */
  overlappingVisits: Array<{
    pageTitle: string | null
    domain: string
    url: string | null
    visitTime: number
    durationSec: number
  }>
}

/**
 * What was on screen at date + time (HH:MM local). Structured, never prose:
 * the covering block, the ONE page active at that minute, overlapping visits,
 * and — when the moment falls in a hole — the nearest block as the closest
 * captured signal instead of a bare refusal.
 */
export function getMomentEvidence(db: Database.Database, dateStr: string, time: string): MomentEvidence {
  const [hoursRaw, minutesRaw] = time.split(':')
  const hours = Number(hoursRaw)
  const minutes = Number(minutesRaw ?? '0')
  const base: MomentEvidence = {
    found: false,
    askedTime: time,
    date: dateStr,
    activePage: null,
    coveringBlock: null,
    nearestBlock: null,
    overlappingVisits: [],
  }
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return { ...base, reason: `Bad time "${time}" — expected HH:MM (24h).` }
  }
  const moment = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(moment.getTime())) {
    return { ...base, reason: `Bad date "${dateStr}" — expected YYYY-MM-DD.` }
  }
  moment.setHours(hours, minutes, 0, 0)
  const momentMs = moment.getTime()

  const overlappingRaw = getVisitsOverlappingMoment(db, momentMs)
  const overlapping: MomentPageCandidate[] = overlappingRaw.map((visit) => ({
    pageTitle: visit.pageTitle,
    displayTitle: visit.pageTitle ?? undefined,
    host: visit.domain,
    domain: visit.domain,
    url: visit.url,
    totalSeconds: visit.durationSec,
    overlapMs: visit.overlapMs,
  }))

  const payload = getTimelineDayPayload(db, localDateString(moment), null)
  const covering = payload.blocks.find((block) => block.startTime <= momentMs && block.endTime >= momentMs) ?? null

  let coveringBlock: MomentEvidence['coveringBlock'] = null
  if (covering) {
    const label = userVisibleLabelForBlock(covering)
    if (label) {
      coveringBlock = {
        label,
        startTime: covering.startTime,
        endTime: covering.endTime,
        topApps: covering.topApps
          .filter((app) => app.category !== 'system')
          .slice(0, 4)
          .map((app) => ({ appName: app.appName, totalSeconds: Math.max(0, Math.round(app.totalSeconds)) })),
      }
    }
  }

  const resolved = resolveMomentPageEvidence(covering?.pageRefs ?? [], overlapping)
  const bestVisit = overlappingRaw[0] ?? null
  const activePage = resolved
    ? {
      title: resolved.title,
      host: resolved.host,
      url: bestVisit && (bestVisit.pageTitle === resolved.title || !covering) ? bestVisit.url : null,
      verb: resolved.verb,
      visitTime: bestVisit?.visitTime ?? null,
      durationSec: bestVisit?.durationSec ?? null,
    }
    : null

  let nearestBlock: MomentEvidence['nearestBlock'] = null
  if (!coveringBlock && !activePage && payload.blocks.length > 0) {
    let nearest: typeof payload.blocks[number] | null = null
    let nearestGapMs = Number.POSITIVE_INFINITY
    for (const block of payload.blocks) {
      const gap = block.startTime > momentMs ? block.startTime - momentMs : momentMs - block.endTime
      if (gap < nearestGapMs) {
        nearestGapMs = gap
        nearest = block
      }
    }
    const nearestLabel = nearest ? userVisibleLabelForBlock(nearest) : null
    if (nearest && nearestLabel) {
      nearestBlock = {
        label: nearestLabel,
        startTime: nearest.startTime,
        endTime: nearest.endTime,
        direction: nearest.startTime > momentMs ? 'after' : 'before',
      }
    }
  }

  const found = Boolean(activePage || coveringBlock || nearestBlock)
  return {
    ...base,
    found,
    reason: found ? undefined : 'No tracked activity near that time on that day.',
    activePage,
    coveringBlock,
    nearestBlock,
    overlappingVisits: overlappingRaw.map(({ overlapMs: _overlap, ...visit }) => visit),
  }
}
