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
  buildWeeklyBriefRoute,
  buildDailyReportRoute,
  openDailySummaryRoute,
  setDailySummaryNavigationWindow,
} from './dailySummaryNavigation'
import { deliverNotification } from './notificationDelivery'

import {
  decideDailySummary,
  decideYesterdayRecap,
  decideWeeklyBrief,
  workRhythmWindows,
  canAttemptAiNarrative,
  recordAiNarrativeAttempt,
  aiNarrativeAttemptsExhausted,
  type AiAttemptKind,
  type DailyNotifierState,
} from '../lib/dailySummaryScheduler'
import { factOnlyRecapLine } from '../lib/wrappedNarrative'
import { factOnlyWeeklyLine } from '../lib/wrappedPeriodNarrative'
import { buildWrappedPeriodFacts, getWrappedPeriodWrap } from './wrappedPeriodNarrative'
import { buildDayWrapFacts } from '../../renderer/lib/dayWrapScenes'
import { getWrapProviderState } from './aiOrchestration'

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
//
// onStale 'regenerate': a brief is generated from the facts as they stand at
// delivery time, never served from a stale cache. A stored wrap whose facts
// hash still matches the day is reused (it IS the current facts); one that
// drifted is regenerated and persisted before the notification fires, so the
// line on the lock screen is by construction the lead of the wrap it opens.
async function getAiNarrative(dateStr: string): Promise<AIWrappedNarrative | null> {
  try {
    const today = localDateString(new Date())
    const liveSession = dateStr === today ? getCurrentSession() : null
    const payload = getTimelineDayPayload(getDb(), dateStr, liveSession)
    const narrative = await Promise.race([
      getWrappedNarrative(payload, { triggerSource: 'system', onStale: 'regenerate' }),
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

/** Total tracked seconds across the completed week ending on `anchorDate`. */
function secondsTrackedInWeekEnding(anchorDate: string): number {
  let total = 0
  for (let offset = 0; offset > -7; offset -= 1) {
    total += secondsTrackedOn(shiftLocalDateString(anchorDate, offset))
  }
  return total
}

// Activity-free notification text (briefs.md §Notification content and
// privacy): the person can choose lock-screen-safe copy that names no
// activity at all — without losing the brief. The gate still runs the full
// content path first, so the fallback order (real line, fact-only line,
// silence) is unchanged: an activity-free notification only fires when the
// brief it opens actually exists.
function notificationBody(contentLine: string, activityFree: string): string {
  return (getSettings().activityFreeNotificationText ?? false) ? activityFree : contentLine
}

// The deterministic floor of the evening recap: a line made only of the day's
// shared corrected facts (the same payload every other surface reads), or null
// when the day is too thin to say anything honest. Fallback order when AI
// can't write the recap: this fact-only line, then silence — never a guess.
function deterministicRecapLine(dateStr: string): string | null {
  try {
    const today = localDateString(new Date())
    const liveSession = dateStr === today ? getCurrentSession() : null
    const payload = getTimelineDayPayload(getDb(), dateStr, liveSession)
    return factOnlyRecapLine(buildDayWrapFacts(payload))
  } catch {
    return null
  }
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
    // With a connected provider, the recap is written from the current facts
    // (attempt-budgeted); the fact-only line steps in only once no written
    // recap can come today. Without one, the fact-only line IS the recap.
    const providerConnected = await getWrapProviderState()
      .then((s) => s.connected)
      .catch(() => false)

    if (providerConnected && withAiAttemptBudget('evening-wrap', today)) {
      const teaser = await tryGetWrappedTeaser(today)
      if (teaser) {
        notifyWithNavigation('Your evening wrap', notificationBody(teaser, 'Your evening wrap is ready.'), buildEveningWrapRoute(today))
        writeState({ ...readState(), lastDailySummaryDate: today })
        return
      }
    }

    // No AI recap this round. If a retry could still produce one later in the
    // window, hold the notification for it; otherwise end the day's window
    // with the deterministic fact-only line (then silence when even that has
    // nothing honest to say).
    if (providerConnected && !aiNarrativeAttemptsExhausted(readState(), 'evening-wrap', today)) return
    const line = deterministicRecapLine(today)
    if (!line) return
    notifyWithNavigation('Your evening wrap', notificationBody(line, 'Your evening wrap is ready.'), buildEveningWrapRoute(today))
    writeState({ ...readState(), lastDailySummaryDate: today })
  } finally {
    dailySummaryPreparing = false
  }
}

// §4.1 — The morning brief: yesterday's recap. Fires first thing in the
// morning, only when you did NOT already generate a recap yesterday. The body
// is a fresh, specific one-liner about yesterday, generated from the facts as
// they stand at delivery time (corrections made overnight are in it), readable
// without opening the app. Fallback order when no written line can come
// (briefs.md §Failure behavior): the deterministic fact-only line built from
// the same shared corrected facts, then silence — never a canned teaser,
// never a stale cache.
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
    const providerConnected = await getWrapProviderState()
      .then((s) => s.connected)
      .catch(() => false)

    if (providerConnected && withAiAttemptBudget('yesterday-recap', yesterday)) {
      const narrative = await getAiNarrative(yesterday)
      if (narrative) {
        void tryPrepareAIReport(yesterday) // warm the full report in the background
        notifyWithNavigation(
          'Yesterday, in one line',
          notificationBody(narrative.lead, "Yesterday's brief is ready."),
          `/wrapped?date=${yesterday}&source=daily-summary`,
          { actionText: 'Open' },
        )
        writeState({ ...readState(), lastYesterdayRecapDate: today })
        return
      }
    }

    // No written line this round. Hold the window while a retry could still
    // produce one; once the budget is spent (or there is no provider at all),
    // fall back to the deterministic fact-only line — then silence.
    if (providerConnected && !aiNarrativeAttemptsExhausted(readState(), 'yesterday-recap', yesterday)) return
    const line = deterministicRecapLine(yesterday)
    if (!line) return
    notifyWithNavigation(
      'Yesterday, in one line',
      notificationBody(line, "Yesterday's brief is ready."),
      `/wrapped?date=${yesterday}&source=daily-summary`,
      { actionText: 'Open' },
    )
    writeState({ ...readState(), lastYesterdayRecapDate: today })
  } finally {
    dailySummaryPreparing = false
  }
}

// The weekly brief (briefs.md): fires at the week boundary — Monday morning —
// and opens the completed week's wrap. Content follows the same one-fact-system
// rules as the other briefs: the wrap's own lead when a provider can write it
// (generated from the facts at delivery time, never a stale cache), else the
// deterministic fact-only weekly line summed from the same frozen snapshots
// the wrap shows, else silence.
async function checkWeeklyBrief(): Promise<void> {
  if (dailySummaryPreparing) return

  const settings = getSettings()
  const now = new Date()
  const today = localDateString(now)
  // The completed week ends yesterday (Sunday when today is the Monday
  // boundary) — the anchor the week wrap opens on.
  const anchor = shiftLocalDateString(today, -1)
  const state = readState()

  // Query-cost guard only — the decision function below re-checks both and
  // stays the single authority the tests drive. Without this, the notifier's
  // 60s cadence would sum a week of sessions every minute of every day.
  if (now.getDay() !== 1 || state.lastWeeklyBriefAnchor === anchor) return

  const windows = workRhythmWindows(settings.workRhythm)
  const decision = decideWeeklyBrief({
    now,
    state,
    weekSecondsTracked: secondsTrackedInWeekEnding(anchor),
    weeklyBriefEnabled: settings.weeklyBriefEnabled ?? true,
    weekAnchorDate: anchor,
    morningStartHour: windows.morningStartHour,
    morningEndHour: windows.morningEndHour,
  })
  if (!decision.fire) return

  dailySummaryPreparing = true
  try {
    const providerConnected = await getWrapProviderState()
      .then((s) => s.connected)
      .catch(() => false)

    if (providerConnected && withAiAttemptBudget('weekly-brief', anchor)) {
      const lead = await tryGetWeeklyWrapLead(anchor)
      if (lead) {
        notifyWithNavigation(
          'Your week, wrapped',
          notificationBody(lead, 'Your weekly brief is ready.'),
          buildWeeklyBriefRoute(anchor),
          { actionText: 'Open' },
        )
        writeState({ ...readState(), lastWeeklyBriefAnchor: anchor })
        return
      }
    }

    // No written line this round. Hold the window while a retry could still
    // produce one; once the budget is spent (or there is no provider at all),
    // fall back to the deterministic fact-only weekly line — then silence.
    if (providerConnected && !aiNarrativeAttemptsExhausted(readState(), 'weekly-brief', anchor)) return
    const line = deterministicWeeklyLine(anchor)
    if (!line) return
    notifyWithNavigation(
      'Your week, wrapped',
      notificationBody(line, 'Your weekly brief is ready.'),
      buildWeeklyBriefRoute(anchor),
      { actionText: 'Open' },
    )
    writeState({ ...readState(), lastWeeklyBriefAnchor: anchor })
  } finally {
    dailySummaryPreparing = false
  }
}

// The weekly wrap's own lead — ONLY when it came from the provider, generated
// or verified fresh at delivery time (onStale 'regenerate': a stored week wrap
// whose facts hash still matches is reused because it IS the current facts; a
// drifted one is regenerated before the notification fires). Null means no
// written line can honestly be pushed this round.
async function tryGetWeeklyWrapLead(anchorDate: string): Promise<string | null> {
  try {
    const { narrative } = await Promise.race([
      getWrappedPeriodWrap('week', anchorDate, { triggerSource: 'system', onStale: 'regenerate' }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('weekly wrap timed out')), AI_REPORT_TIMEOUT_MS * 2)),
    ])
    if (!narrative || narrative.source !== 'ai' || !narrative.lead) return null
    return narrative.lead
  } catch {
    return null
  }
}

// The weekly brief's deterministic floor: a line made only of the week's
// summed frozen-snapshot facts (the same totals the wrap and Timeline show),
// or null when the week is too thin to say anything honest.
function deterministicWeeklyLine(anchorDate: string): string | null {
  try {
    return factOnlyWeeklyLine(buildWrappedPeriodFacts('week', anchorDate))
  } catch {
    return null
  }
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
// once-per-day/week gates. Uses real AI copy when a provider is connected,
// with the same fallback order as the real checks (fact-only line, then an
// honest failure) so what you test is what ships.
export async function fireTestDailySummaryNotification(
  kind: 'evening-wrap' | 'morning-brief' | 'weekly-brief',
): Promise<{ ok: boolean; reason?: string; route?: string }> {
  const now = new Date()
  const today = localDateString(now)
  const yesterday = shiftLocalDateString(today, -1)

  try {
    if (kind === 'morning-brief') {
      const narrative = await getAiNarrative(yesterday)
      const line = narrative?.lead ?? deterministicRecapLine(yesterday)
      if (!line) return { ok: false, reason: 'no-recap-content' }
      const route = `/wrapped?date=${yesterday}&source=daily-summary`
      notifyWithNavigation('Yesterday, in one line', notificationBody(line, "Yesterday's brief is ready."), route, { actionText: 'Open' })
      return { ok: true, route }
    }

    if (kind === 'weekly-brief') {
      const line = (await tryGetWeeklyWrapLead(yesterday)) ?? deterministicWeeklyLine(yesterday)
      if (!line) return { ok: false, reason: 'no-weekly-content' }
      const route = buildWeeklyBriefRoute(yesterday)
      notifyWithNavigation('Your week, wrapped', notificationBody(line, 'Your weekly brief is ready.'), route, { actionText: 'Open' })
      return { ok: true, route }
    }

    // Same fallback order as the real evening check: the written recap when a
    // provider can produce one, else the deterministic fact-only line.
    const teaser = (await tryGetWrappedTeaser(today)) ?? deterministicRecapLine(today)
    if (!teaser) return { ok: false, reason: 'no-recap-content' }
    const route = buildEveningWrapRoute(today)
    notifyWithNavigation('Your evening wrap', notificationBody(teaser, 'Your evening wrap is ready.'), route)
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
        await checkWeeklyBrief()
        await checkYesterdayRecap()
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
