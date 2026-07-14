import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, app } from 'electron'
import type { AIWrappedNarrative } from '@shared/types'
import { getSessionsForRange } from '../db/queries'
import { localDateString, localDayBounds, shiftLocalDateString } from '../lib/localDate'
import { getDb } from './database'
import { getSettings } from './settings'
import { prepareDailyReport } from './ai'
import { getWrappedNarrative } from './wrappedNarrative'
import { freezeDaySnapshot } from './daySnapshots'
import { getCurrentSession } from './tracking'
import { getTimelineDayPayload } from './workBlocks'
import {
  buildEveningWrapRoute,
  buildDailyReportRoute,
  openDailySummaryRoute,
  setDailySummaryNavigationWindow,
} from './dailySummaryNavigation'
import { deliverNotification } from './notificationDelivery'

import {
  decideDailySummary,
  decideYesterdayRecap,
  decideCarryoverNudge,
  workRhythmWindows,
  canAttemptAiNarrative,
  recordAiNarrativeAttempt,
  type AiAttemptKind,
  type DailyNotifierState,
} from '../lib/dailySummaryScheduler'

const MAX_TRACKED_RECAP_DATES = 21

// How long to wait for AI report preparation before firing the notification
// without it. Wrapped opens instantly with deterministic content regardless.
// Must sit ABOVE the wrapped job's own 22–25s timeout: with the old 12s race,
// a slow-but-successful wrap call was fully paid for and then discarded here,
// only for the next minute's check to spend another call.
const AI_REPORT_TIMEOUT_MS = 26_000

// Spend an AI attempt only when the retry budget allows it — otherwise a
// failing wrap call would retry every 60s for the whole notification
// window. Records the attempt BEFORE the call so a crash or
// timeout still counts against the budget.
function withAiAttemptBudget(kind: AiAttemptKind, date: string): boolean {
  const state = readState()
  const now = Date.now()
  if (!canAttemptAiNarrative(state, kind, date, now)) return false
  writeState(recordAiNarrativeAttempt(state, kind, date, now))
  return true
}

let notifierTimer: ReturnType<typeof setInterval> | null = null
let dailySummaryPreparing = false

function notifyWithNavigation(title: string, body: string, route: string, options: { actionText?: string } = {}): void {
  deliverNotification({
    title,
    body,
    actionText: options.actionText,
    onClick: () => {
      console.log('[daily-summary] notification clicked, opening route:', route)
      openDailySummaryRoute(route)
    },
    surface: 'daily-summary',
  })
}

function statePath(): string {
  return path.join(app.getPath('userData'), 'daily-summary-state.json')
}

function readState(): DailyNotifierState {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8')) as DailyNotifierState
  } catch {
    return {}
  }
}

function writeState(state: DailyNotifierState): void {
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2))
}


// The no-credits rule: a brief or wrap's
// every word comes through a real API call. This returns the narrative ONLY when
// it came from the provider — never the deterministic fallback. When it returns
// null (no provider, no credits, or the call failed) the notifier does NOT fire:
// no canned brief, no static teaser.
async function getAiNarrative(dateStr: string): Promise<AIWrappedNarrative | null> {
  try {
    const today = localDateString(new Date())
    const liveSession = dateStr === today ? getCurrentSession() : null
    const payload = getTimelineDayPayload(getDb(), dateStr, liveSession)
    const narrative = await Promise.race([
      getWrappedNarrative(payload, { triggerSource: 'system' }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), AI_REPORT_TIMEOUT_MS)),
    ])
    if (!narrative || narrative.source !== 'ai' || !narrative.lead) return null
    return narrative
  } catch {
    return null
  }
}

// One readable line for the evening wrap notification body — the recap hook.
// The hook IS the notification (voice.md §11): earn the open with the real thing,
// never "your wrap is ready", never a prediction of tomorrow.
async function tryGetWrappedTeaser(dateStr: string): Promise<string | null> {
  const narrative = await getAiNarrative(dateStr)
  if (!narrative) return null
  return narrative.lead
}

// Tries to prep a user-facing report. AI may improve it when provider access
// exists, but the deterministic fallback is still a real report, not raw evidence.
async function tryPrepareAIReport(dateStr: string): Promise<{ route: string } | null> {
  try {
    const result = await Promise.race([
      prepareDailyReport(dateStr),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), AI_REPORT_TIMEOUT_MS)),
    ])
    if (!result || result.status !== 'ready') return null
    return { route: buildDailyReportRoute(result) }
  } catch {
    return null
  }
}

function secondsTrackedOn(date: string): number {
  const [fromMs, toMs] = localDayBounds(date)
  const sessions = getSessionsForRange(getDb(), fromMs, toMs)
  return sessions.reduce((sum, s) => sum + s.durationSeconds, 0)
}

async function checkDailySummary(): Promise<void> {
  if (dailySummaryPreparing) return

  const settings = getSettings()
  const now = new Date()
  const today = localDateString(now)
  const state = readState()

  const windows = workRhythmWindows(settings.workRhythm)
  const decision = decideDailySummary({
    now,
    state,
    todaySecondsTracked: secondsTrackedOn(today),
    dailySummaryEnabled: settings.dailySummaryEnabled ?? true,
    todayDateString: today,
    eveningWrapHour: windows.eveningWrapHour,
  })
  if (!decision.fire) return

  dailySummaryPreparing = true
  try {
    if (!withAiAttemptBudget('evening-wrap', today)) return
    // No-credits rule: only fire when the body is real AI output (§7).
    const teaser = await tryGetWrappedTeaser(today)
    if (!teaser) return
    notifyWithNavigation('Your evening wrap', teaser, buildEveningWrapRoute(today))
    writeState({ ...readState(), lastDailySummaryDate: today })
  } finally {
    dailySummaryPreparing = false
  }
}

// §4.1 — Yesterday's recap. Fires first thing in the morning, only when you did
// NOT already generate a recap yesterday. The body is a fresh, specific summary
// of yesterday, readable without opening the app.
async function checkYesterdayRecap(): Promise<void> {
  if (dailySummaryPreparing) return

  const settings = getSettings()
  const now = new Date()
  const today = localDateString(now)
  const yesterday = shiftLocalDateString(today, -1)
  const state = readState()

  const windows = workRhythmWindows(settings.workRhythm)
  const decision = decideYesterdayRecap({
    now,
    state,
    yesterdaySecondsTracked: secondsTrackedOn(yesterday),
    morningNudgeEnabled: settings.morningNudgeEnabled ?? true,
    todayDateString: today,
    yesterdayDateString: yesterday,
    morningStartHour: windows.morningStartHour,
    morningEndHour: windows.morningEndHour,
  })
  if (!decision.fire) return

  dailySummaryPreparing = true
  try {
    if (!withAiAttemptBudget('yesterday-recap', yesterday)) return
    const narrative = await getAiNarrative(yesterday)
    if (!narrative) return // no provider / no credits → no brief (§7)
    void tryPrepareAIReport(yesterday) // warm the full report in the background
    notifyWithNavigation(
      "Yesterday, in one line",
      narrative.lead,
      `/wrapped?date=${yesterday}&source=daily-summary`,
      { actionText: 'Open' },
    )
    writeState({ ...readState(), lastYesterdayRecapDate: today })
  } finally {
    dailySummaryPreparing = false
  }
}

// §4.2 — Carryover nudge. Fires after ~1–2h of work that morning, always. Greets
// you, notes what it can see you doing this morning, and surfaces yesterday's
// open thread to pick up. A clean start is a real answer.
async function checkCarryoverNudge(): Promise<void> {
  if (dailySummaryPreparing) return

  const settings = getSettings()
  const now = new Date()
  const today = localDateString(now)
  const yesterday = shiftLocalDateString(today, -1)
  const state = readState()

  const windows = workRhythmWindows(settings.workRhythm)
  const decision = decideCarryoverNudge({
    now,
    state,
    todaySecondsTracked: secondsTrackedOn(today),
    morningNudgeEnabled: settings.morningNudgeEnabled ?? true,
    todayDateString: today,
    yesterdayDateString: yesterday,
    carryoverEndHour: windows.carryoverEndHour,
  })
  if (!decision.fire) return

  dailySummaryPreparing = true
  try {
    if (!withAiAttemptBudget('carryover-nudge', today)) return
    const body = await buildCarryoverBody(today, yesterday)
    if (!body) return // no provider / no credits → no brief (§7)
    notifyWithNavigation('Good morning', body, buildEveningWrapRoute(today))
    writeState({ ...readState(), lastCarryoverNudgeDate: today })
  } finally {
    dailySummaryPreparing = false
  }
}

// What it sees this morning, AI-written. Daylens never predicts tomorrow or
// surfaces an "open thread to pick up" (locked decision: carryover is gone every
// cadence), so the body is an honest read on the morning, nothing more. Returns
// null when no AI content is available, so the nudge stays silent rather than
// fabricating a brief.
async function buildCarryoverBody(today: string, _yesterday: string): Promise<string | null> {
  const todayNarrative = await getAiNarrative(today)
  return todayNarrative?.lead?.trim() ?? null
}

// Record that the user generated a recap for `date` (Generate Recap / Analyze
// Day). Two jobs: (1) it suppresses the next morning's "yesterday's recap"
// notification for that day (§4.1 firing rule); (2) it freezes the day's
// snapshot so the weekly/monthly/annual wraps sum a finalized day (invariant 4).
export function markRecapGenerated(date: string): void {
  try {
    const state = readState()
    const dates = new Set(state.recapGeneratedDates ?? [])
    dates.add(date)
    const trimmed = [...dates].sort().slice(-MAX_TRACKED_RECAP_DATES)
    writeState({ ...state, recapGeneratedDates: trimmed })
  } catch (err) {
    console.warn('[daily-summary] failed to record recap-generated date:', err)
  }
  try {
    freezeDaySnapshot(date)
  } catch (err) {
    console.warn('[daily-summary] failed to freeze day snapshot:', err)
  }
}

// Manual trigger used by the notification harness. Bypasses time-of-day and
// once-per-day gates. Uses real AI copy when a provider is connected.
export async function fireTestDailySummaryNotification(
  kind: 'evening-wrap' | 'morning-brief',
): Promise<{ ok: boolean; reason?: string; route?: string }> {
  const now = new Date()
  const today = localDateString(now)
  const yesterday = shiftLocalDateString(today, -1)

  try {
    if (kind === 'morning-brief') {
      const narrative = await getAiNarrative(yesterday)
      if (!narrative) return { ok: false, reason: 'no-ai-content' }
      const route = `/wrapped?date=${yesterday}&source=daily-summary`
      notifyWithNavigation('Yesterday, in one line', narrative.lead, route, { actionText: 'Open' })
      return { ok: true, route }
    }

    const teaser = await tryGetWrappedTeaser(today)
    if (!teaser) return { ok: false, reason: 'no-ai-content' }
    const route = buildEveningWrapRoute(today)
    notifyWithNavigation('Your evening wrap', teaser, route)
    return { ok: true, route }
  } catch (err) {
    console.warn('[daily-summary] manual trigger failed:', err)
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

export function setDailySummaryNotificationWindow(window: BrowserWindow | null): void {
  setDailySummaryNavigationWindow(window)
}

export function startDailySummaryNotifier(window?: BrowserWindow | null): void {
  if (window) {
    setDailySummaryNavigationWindow(window)
  }
  if (notifierTimer) return

  const runChecks = () => {
    void (async () => {
      try {
        await checkYesterdayRecap()
        await checkCarryoverNudge()
        await checkDailySummary()
      } catch (err) {
        console.warn('[daily-summary] notifier check failed:', err)
      }
    })()
  }

  runChecks()
  notifierTimer = setInterval(runChecks, 60_000)
  _triggerDailySummaryChecks = runChecks
}

let _triggerDailySummaryChecks: (() => void) | null = null

export function triggerDailySummaryChecks(): void {
  _triggerDailySummaryChecks?.()
}
