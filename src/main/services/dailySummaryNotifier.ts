import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, Notification, app, nativeImage } from 'electron'
import { getSessionsForRange } from '../db/queries'
import { localDateString, localDayBounds } from '../lib/localDate'
import { getDb } from './database'
import { getSettings } from './settings'
import { prepareDailyReport } from './ai'
import { getWrappedNarrative } from './wrappedNarrative'
import { getCurrentSession } from './tracking'
import { getTimelineDayPayload } from './workBlocks'
import {
  buildDailyReportRoute,
  openDailySummaryRoute,
  setDailySummaryNavigationWindow,
} from './dailySummaryNavigation'

import {
  decideDailySummary,
  decideMorningNudge,
  type DailyNotifierState,
} from '../lib/dailySummaryScheduler'

// How long to wait for AI report preparation before firing the notification
// without it. Wrapped opens instantly with deterministic content regardless.
const AI_REPORT_TIMEOUT_MS = 12_000

let notifierTimer: ReturnType<typeof setInterval> | null = null
let dailySummaryPreparing = false

// Hold references so Electron does not GC notifications before the user clicks
// them. macOS in particular drops the click handler if the JS object is freed.
const liveNotifications = new Set<Notification>()

function notificationIcon(): Electron.NativeImage | undefined {
  try {
    const iconPath = app.isPackaged
      ? path.join(process.resourcesPath, 'build', 'icon.png')
      : path.join(__dirname, '..', '..', 'build', 'icon.png')
    const img = nativeImage.createFromPath(iconPath)
    return img.isEmpty() ? undefined : img
  } catch {
    return undefined
  }
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

function notifyWithNavigation(title: string, body: string, route: string, options: { actionText?: string } = {}): void {
  if (!Notification.isSupported()) {
    console.warn('[daily-summary] notifications not supported on this platform')
    return
  }

  const icon = notificationIcon()
  const notification = new Notification({
    title,
    body,
    silent: false,
    icon,
    // Action buttons on macOS require notification entitlement; on Windows they
    // need a registered AppUserModelID toast. Body click is universally reliable,
    // so we keep actions optional and non-load-bearing.
    actions: options.actionText && process.platform === 'darwin'
      ? [{ type: 'button', text: options.actionText }]
      : undefined,
  })

  liveNotifications.add(notification)

  const openRoute = () => {
    console.log('[daily-summary] notification clicked, opening route:', route)
    openDailySummaryRoute(route)
  }

  notification.on('click', openRoute)
  notification.on('action', openRoute)
  notification.on('show', () => { console.log('[daily-summary] notification shown:', title) })
  notification.on('failed', (_e, err) => { console.warn('[daily-summary] notification failed:', err) })
  notification.on('close', () => { liveNotifications.delete(notification) })

  notification.show()

  // Belt-and-suspenders: drop the strong reference after a long timeout in case
  // 'close' never fires on a given platform.
  setTimeout(() => { liveNotifications.delete(notification) }, 30 * 60 * 1000)
}


// Best-effort fetch of the WrappedNarrative for a given date. Pre-warms the
// in-process cache so the user opens Wrapped to an AI-overlaid lead instantly,
// and surfaces a 1-2 sentence teaser for the notification body. Falls through
// to the deterministic fallback on any failure — notifications are never
// blocked.
async function tryGetWrappedTeaser(
  dateStr: string,
  surface: 'morning' | 'evening' = 'evening',
): Promise<string | null> {
  try {
    const today = localDateString(new Date())
    const liveSession = dateStr === today ? getCurrentSession() : null
    const payload = getTimelineDayPayload(getDb(), dateStr, liveSession)
    const narrative = await Promise.race([
      getWrappedNarrative(payload),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), AI_REPORT_TIMEOUT_MS)),
    ])
    if (!narrative?.lead) return null
    // Evening wrap: pair the lead (recap) with the nudge (tomorrow posture) per
    // PRODUCT-SPEC. Keep under ~140 chars so macOS/Windows don't truncate in
    // the middle of the second sentence.
    if (surface === 'evening' && narrative.nudge) {
      const combined = `${narrative.lead.trim()} ${narrative.nudge.trim()}`
      if (combined.length <= 160) return combined
    }
    return narrative.lead
  } catch {
    return null
  }
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

  const decision = decideDailySummary({
    now,
    state,
    todaySecondsTracked: secondsTrackedOn(today),
    dailySummaryEnabled: settings.dailySummaryEnabled ?? true,
    todayDateString: today,
  })
  if (!decision.fire) return

  dailySummaryPreparing = true
  try {
    const teaser = await tryGetWrappedTeaser(today, 'evening')
    const ai = await tryPrepareAIReport(today)
    const route = ai?.route ?? `/wrapped?date=${today}&source=daily-summary`
    // Evening fallback body: grounded in the day having real activity (the
    // scheduler already filtered for `todaySecondsTracked > 0`), but neutral
    // enough to stay truthful when the AI teaser is unavailable.
    const body = teaser ?? 'Your day is in. Open the recap.'
    notifyWithNavigation('Daylens', body, route)
    writeState({ ...state, lastDailySummaryDate: today })
  } finally {
    dailySummaryPreparing = false
  }
}

async function checkMorningNudge(): Promise<void> {
  if (dailySummaryPreparing) return

  const settings = getSettings()
  const now = new Date()
  const today = localDateString(now)
  const yesterday = localDateString(new Date(now.getTime() - 86_400_000))
  const state = readState()

  const decision = decideMorningNudge({
    now,
    state,
    todaySecondsTracked: secondsTrackedOn(today),
    yesterdaySecondsTracked: secondsTrackedOn(yesterday),
    morningNudgeEnabled: settings.morningNudgeEnabled ?? true,
    todayDateString: today,
    yesterdayDateString: yesterday,
  })
  if (!decision.fire) return

  dailySummaryPreparing = true
  try {
    const teaser = await tryGetWrappedTeaser(yesterday, 'morning')
    const ai = await tryPrepareAIReport(yesterday)
    const route = ai?.route ?? `/wrapped?date=${yesterday}&source=daily-summary`
    notifyWithNavigation(
      'Yesterday\'s recap is ready',
      teaser ?? 'Carry yesterday\'s thread into today.',
      route,
      { actionText: 'Open' },
    )
    writeState({ ...state, lastMorningNudgeDate: today })
  } finally {
    dailySummaryPreparing = false
  }
}

// Manual trigger used by the developer shortcut. Bypasses time-of-day and
// once-per-day gates so the user can verify notifications and click-through
// on demand. Picks the morning brief before noon, evening summary after.
export async function fireTestDailyNotification(): Promise<{ ok: boolean; reason?: string }> {
  if (!Notification.isSupported()) return { ok: false, reason: 'notifications-unsupported' }

  const now = new Date()
  const today = localDateString(now)
  const yesterday = localDateString(new Date(now.getTime() - 86_400_000))
  const isMorning = now.getHours() < 12
  const targetDate = isMorning ? yesterday : today

  try {
    const teaser = await tryGetWrappedTeaser(targetDate, isMorning ? 'morning' : 'evening')
    const ai = await tryPrepareAIReport(targetDate)
    const route = ai?.route ?? `/wrapped?date=${targetDate}&source=daily-summary`

    if (isMorning) {
      notifyWithNavigation(
        'Yesterday\'s recap is ready',
        teaser ?? 'Carry yesterday\'s thread into today.',
        route,
        { actionText: 'Open' },
      )
    } else {
      notifyWithNavigation('Daylens', teaser ?? 'Your day is in. Open the recap.', route)
    }
    return { ok: true }
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
        await checkMorningNudge()
        await checkDailySummary()
      } catch (err) {
        console.warn('[daily-summary] notifier check failed:', err)
      }
    })()
  }

  runChecks()
  notifierTimer = setInterval(runChecks, 60_000)
}
