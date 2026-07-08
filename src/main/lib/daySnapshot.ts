// Frozen daily snapshots — the trustworthy spine under weekly/monthly/annual
// wraps (briefs-wraps.md §6.1, invariant 4). A snapshot freezes one day's
// numbers from the SAME trusted timeline blocks the Timeline view reads, so a
// wrap that sums snapshots can never disagree with the day it came from.
//
// Pure logic only — no DB, no AI. The service layer (`../services/daySnapshots`)
// handles persistence and "build from today's live payload".

import { createHash } from 'node:crypto'
import type {
  AppCategory,
  DaySnapshot,
  DaySnapshotThread,
  DayTimelinePayload,
  WorkContextBlock,
  WorkIntentRole,
} from '@shared/types'
import { blockActiveSeconds } from '@shared/blockDuration'
import { isTrustedTimelineBlock } from '@shared/timelineReview'
import { inferWorkIntent } from '@shared/workIntent'
import { effectiveBlockKind, kindForDomain } from '@shared/workKind'
import { friendlyDomain } from '@shared/humanize'

const THREAD_MIN_SECONDS = 10 * 60
const LONGEST_MIN_SECONDS = 10 * 60
const MAX_THREADS = 5
const MAX_APPS = 8
const MAX_DOMAINS = 8
const MAX_LEISURE_SURFACES = 4

// Roles that name a real deliverable; ambient/ambiguous aren't "threads".
const THREAD_ROLES: ReadonlySet<WorkIntentRole> = new Set<WorkIntentRole>([
  'execution', 'research', 'review', 'coordination',
])

function isSubstantiveCategory(category: AppCategory): boolean {
  return category !== 'system' && category !== 'uncategorized'
}

// Prefer a user correction over the generated label/intent — mirrors the daily
// Wrapped facts builder so a thread reads the same on the day and in the week.
function effectiveLabel(block: WorkContextBlock): string {
  const corrected = block.review?.correctedLabel?.trim()
  return (corrected || block.label.current.trim()).slice(0, 80)
}

function effectiveIntent(block: WorkContextBlock): { role: WorkIntentRole; subject: string | null } {
  const intent = inferWorkIntent(block)
  return {
    role: block.review?.correctedIntentRole ?? intent.role,
    subject: block.review?.correctedIntentSubject ?? intent.subject,
  }
}

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

/** Build a frozen-shaped snapshot from a day's timeline payload. The result is
 *  deterministic given the same trusted blocks. `finalizedAt` is left at 0 here;
 *  the service stamps it when it persists the freeze. */
export function buildDaySnapshot(payload: DayTimelinePayload): DaySnapshot {
  const blocks = payload.blocks.filter(isTrustedTimelineBlock)

  // The one reconciled kind split — active seconds, never span.
  const kind = { work: 0, leisure: 0, personal: 0, idle: 0 }
  const leisureByDomain = new Map<string, number>()
  const categorySeconds = new Map<AppCategory, number>()
  const workCategorySeconds = new Map<AppCategory, number>()
  const appSeconds = new Map<string, { appName: string; seconds: number; category: AppCategory; isBrowser: boolean }>()
  const domainSeconds = new Map<string, number>()

  let meetingsSpanSeconds = 0

  for (const block of blocks) {
    const seconds = blockActiveSeconds(block)
    const blockKind = effectiveBlockKind(block)
    kind[blockKind] += seconds

    // Meeting truth is the block SPAN (mirrors the daily facts builder): a
    // 73-minute call is 73 minutes of meeting even with hands off the keyboard.
    if (blockKind === 'work' && block.dominantCategory === 'meetings') {
      meetingsSpanSeconds += Math.max(seconds, Math.round((block.endTime - block.startTime) / 1000))
    }

    if (isSubstantiveCategory(block.dominantCategory)) {
      categorySeconds.set(block.dominantCategory, (categorySeconds.get(block.dominantCategory) ?? 0) + seconds)
      if (blockKind === 'work') {
        workCategorySeconds.set(block.dominantCategory, (workCategorySeconds.get(block.dominantCategory) ?? 0) + seconds)
      }
    }

    for (const app of block.topApps) {
      if (app.category === 'system') continue
      const entry = appSeconds.get(app.appName)
      if (entry) entry.seconds += Math.max(0, app.totalSeconds)
      else appSeconds.set(app.appName, { appName: app.appName, seconds: Math.max(0, app.totalSeconds), category: app.category, isBrowser: app.isBrowser })
    }

    for (const site of block.websites) {
      domainSeconds.set(site.domain, (domainSeconds.get(site.domain) ?? 0) + Math.max(0, site.totalSeconds))
      if (blockKind === 'leisure' && kindForDomain(site.domain) === 'leisure') {
        const name = friendlyDomain(site.domain)
        if (name) leisureByDomain.set(name, (leisureByDomain.get(name) ?? 0) + site.totalSeconds)
      }
    }
  }

  const sortDesc = <T>(entries: T[], value: (t: T) => number): T[] => [...entries].sort((a, b) => value(b) - value(a))

  const dominantWorkEntry = sortDesc([...workCategorySeconds.entries()], (e) => e[1])[0] ?? null

  const threads = deriveThreads(blocks)

  let longest: DaySnapshot['longestBlock'] = null
  for (const block of blocks) {
    if (effectiveBlockKind(block) !== 'work') continue
    if (!isSubstantiveCategory(block.dominantCategory)) continue
    const seconds = blockActiveSeconds(block)
    if (seconds < LONGEST_MIN_SECONDS) continue
    if (!longest || seconds > longest.seconds) {
      const intent = effectiveIntent(block)
      longest = { label: intent.subject ?? effectiveLabel(block), seconds: Math.round(seconds), startClock: formatClock(block.startTime) }
    }
  }

  const snapshot: DaySnapshot = {
    date: payload.date,
    totalActiveSeconds: Math.round(blocks.reduce((s, b) => s + blockActiveSeconds(b), 0)),
    kind: {
      work: Math.round(kind.work),
      leisure: Math.round(kind.leisure),
      personal: Math.round(kind.personal),
      idle: Math.round(kind.idle),
    },
    dominantWorkCategory: dominantWorkEntry ? dominantWorkEntry[0] : null,
    categories: sortDesc([...categorySeconds.entries()], (e) => e[1]).map(([category, seconds]) => ({ category, seconds: Math.round(seconds) })),
    apps: sortDesc([...appSeconds.values()], (a) => a.seconds).slice(0, MAX_APPS).map((a) => ({ ...a, seconds: Math.round(a.seconds) })),
    domains: sortDesc([...domainSeconds.entries()], (e) => e[1]).slice(0, MAX_DOMAINS).map(([domain, seconds]) => ({ domain, seconds: Math.round(seconds) })),
    leisureSurfaces: sortDesc([...leisureByDomain.entries()], (e) => e[1]).slice(0, MAX_LEISURE_SURFACES).map(([name]) => name),
    threads,
    longestBlock: longest,
    meetingsSpanSeconds: Math.round(meetingsSpanSeconds),
    factsHash: '',
    finalizedAt: 0,
  }
  snapshot.factsHash = computeSnapshotHash(snapshot)
  return snapshot
}

function deriveThreads(blocks: WorkContextBlock[]): DaySnapshotThread[] {
  // Sum named work threads by subject so a thread worked across several blocks
  // reads as one — "the timeline rework", not three fragments.
  const bySubject = new Map<string, { subject: string; role: WorkIntentRole; seconds: number }>()
  for (const block of blocks) {
    if (effectiveBlockKind(block) !== 'work') continue
    if (!isSubstantiveCategory(block.dominantCategory)) continue
    const seconds = blockActiveSeconds(block)
    if (seconds < THREAD_MIN_SECONDS) continue
    const intent = effectiveIntent(block)
    if (!THREAD_ROLES.has(intent.role)) continue
    const subject = (intent.subject ?? effectiveLabel(block)).trim()
    if (subject.length < 3) continue
    const key = subject.toLowerCase()
    const prev = bySubject.get(key)
    if (prev) prev.seconds += seconds
    else bySubject.set(key, { subject, role: intent.role, seconds })
  }
  return [...bySubject.values()]
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, MAX_THREADS)
    .map((t) => ({ subject: t.subject, role: t.role, seconds: Math.round(t.seconds) }))
}

/** Hash of the load-bearing facts, bucketed to the minute so trivial reshuffles
 *  don't trigger a refreeze but real changes (a corrected label, an approved
 *  block) do. */
export function computeSnapshotHash(snapshot: DaySnapshot): string {
  const bucket = (s: number) => Math.round(s / 60)
  const canonical = JSON.stringify({
    date: snapshot.date,
    total: bucket(snapshot.totalActiveSeconds),
    kind: {
      w: bucket(snapshot.kind.work),
      l: bucket(snapshot.kind.leisure),
      p: bucket(snapshot.kind.personal),
    },
    domCat: snapshot.dominantWorkCategory,
    cats: snapshot.categories.map((c) => [c.category, bucket(c.seconds)]),
    apps: snapshot.apps.map((a) => [a.appName.toLowerCase(), bucket(a.seconds)]),
    threads: snapshot.threads.map((t) => [t.subject.toLowerCase(), t.role, bucket(t.seconds)]),
    longest: snapshot.longestBlock ? [snapshot.longestBlock.label.toLowerCase(), bucket(snapshot.longestBlock.seconds)] : null,
    meetings: bucket(snapshot.meetingsSpanSeconds ?? 0),
  })
  return createHash('sha1').update(canonical).digest('hex').slice(0, 12)
}
