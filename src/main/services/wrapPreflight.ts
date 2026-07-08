// Wrap pre-flight (Stage 0.4) — the data quality gate that runs BEFORE a wrap
// generates. It never blocks: it tells the user honestly and specifically what
// is thin about the day's data ("We're missing window titles for 60% of your
// sessions today"), and they proceed with one tap. A wrap built on thin data
// is allowed; a wrap built on thin data WITHOUT saying so is not.

import type Database from 'better-sqlite3'
import type { WrapPreflightResult, WrapPreflightWarning } from '@shared/types'
import { blockActiveSeconds } from '@shared/blockDuration'
import { effectiveBlockKind } from '@shared/workKind'
import { isTrustedTimelineBlock } from '@shared/timelineReview'
import { localDateString, localDayBounds } from '../lib/localDate'
import { getTimelineDayPayload, persistedDayWasProcessed } from './workBlocks'
import { getStoredWrappedNarrative } from '../db/wrappedNarrativeStore'

const LOW_WORK_SECONDS = 2 * 60 * 60
const MISSING_TITLE_WARN_PCT = 30
const STALE_CAPTURE_MINUTES = 120

function formatHm(seconds: number): string {
  const total = Math.max(0, Math.round(seconds / 60))
  if (total < 60) return `${total}m`
  const h = Math.floor(total / 60)
  const m = total % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function formatClock(ms: number): string {
  return new Date(ms)
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(':00', '')
    .replace(' ', '')
    .toLowerCase()
}

export function getWrapPreflight(db: Database.Database, date: string): WrapPreflightResult {
  const warnings: WrapPreflightWarning[] = []
  const isLiveDay = date === localDateString()

  // Work time from the same trusted blocks every wrap number comes from.
  let workSeconds = 0
  let hadBlocks = false
  try {
    const payload = getTimelineDayPayload(db, date, null)
    for (const block of payload.blocks) {
      if (!isTrustedTimelineBlock(block)) continue
      if (block.dominantCategory === 'system' || block.dominantCategory === 'uncategorized') continue
      hadBlocks = true
      if (effectiveBlockKind(block) === 'work') workSeconds += blockActiveSeconds(block)
    }
  } catch { /* a day that can't be read warns via lowWork below */ }

  if (workSeconds < LOW_WORK_SECONDS) {
    warnings.push({
      kind: 'lowWork',
      message: workSeconds > 0
        ? `Only ${formatHm(workSeconds)} of tracked work ${isLiveDay ? 'so far' : 'on this day'}. The wrap will be short.`
        : `No tracked work ${isLiveDay ? 'yet today' : 'on this day'}. There isn't much for the wrap to say.`,
    })
  }

  // Analyzed? A live provisional day (never materialized, never processed)
  // only has rough, unnamed blocks — the wrap can't name the work well.
  const analyzed = persistedDayWasProcessed(db, date)
  if (!analyzed && hadBlocks) {
    warnings.push({
      kind: 'notAnalyzed',
      message: isLiveDay
        ? 'Today hasn\'t been analyzed yet, so blocks are provisional and the work isn\'t named. Analyze Day first for a sharper wrap.'
        : 'This day was never analyzed, so the work isn\'t named. Analyze it first for a sharper wrap.',
    })
  }

  // Window-title coverage: titles are where the semantic depth comes from.
  const [fromMs, toMs] = localDayBounds(date)
  const titleRow = db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN window_title IS NULL OR window_title = '' THEN 1 ELSE 0 END) AS missing
    FROM app_sessions
    WHERE start_time >= ? AND start_time < ?
  `).get(fromMs, toMs) as { total: number; missing: number | null } | undefined
  const total = titleRow?.total ?? 0
  const missing = titleRow?.missing ?? 0
  const missingTitlePct = total > 0 ? Math.round((missing / total) * 100) : null
  if (missingTitlePct != null && missingTitlePct > MISSING_TITLE_WARN_PCT) {
    warnings.push({
      kind: 'missingTitles',
      message: `We're missing window titles for ${missingTitlePct}% of ${isLiveDay ? 'your sessions today' : 'this day\'s sessions'}, so the wrap will be less detailed than usual.`,
    })
  }

  // Stale capture on the live day: the tracker went quiet while the day didn't.
  let lastActivityAgoMinutes: number | null = null
  const lastRow = db.prepare(`
    SELECT MAX(COALESCE(end_time, start_time)) AS last FROM app_sessions
    WHERE start_time >= ? AND start_time < ?
  `).get(fromMs, toMs) as { last: number | null } | undefined
  if (lastRow?.last) {
    lastActivityAgoMinutes = Math.max(0, Math.round((Date.now() - lastRow.last) / 60_000))
    if (isLiveDay && lastActivityAgoMinutes > STALE_CAPTURE_MINUTES) {
      warnings.push({
        kind: 'staleCapture',
        message: `Tracking last saw activity at ${formatClock(lastRow.last)}, over ${Math.floor(lastActivityAgoMinutes / 60)} hours ago. If you've been working since, the wrap won't know about it.`,
      })
    }
  }

  const stored = getStoredWrappedNarrative(db, 'day', date)

  return {
    date,
    warnings,
    hasStoredWrap: Boolean(stored),
    workSeconds: Math.round(workSeconds),
    missingTitlePct,
    analyzed,
    lastActivityAgoMinutes,
  }
}
