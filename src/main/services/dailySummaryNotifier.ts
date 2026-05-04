import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, Notification, app, nativeImage } from 'electron'
import { getSessionsForRange } from '../db/queries'
import { localDateString, localDayBounds } from '../lib/localDate'
import { getDb } from './database'
import { getSettings, hasApiKey } from './settings'
import { prepareDailyReport } from './ai'
import {
  buildDailyReportRoute,
  openDailySummaryRoute,
  setDailySummaryNavigationWindow,
} from './dailySummaryNavigation'

interface DailyNotifierState {
  lastDailySummaryDate?: string
  lastMorningNudgeDate?: string
}

// Minimum tracked seconds before Wrapped has enough signal to be worth notifying.
// Matches the 'partial' threshold from the renderer quality model.
const NOTIFY_MIN_SECONDS = 45 * 60

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

// Returns true only when the day has enough tracked time for a meaningful Wrapped.
// A session count check is too weak — any accidental app open would pass it.
function hasEnoughActivityOn(date: string): boolean {
  const [fromMs, toMs] = localDayBounds(date)
  const sessions = getSessionsForRange(getDb(), fromMs, toMs)
  const totalSeconds = sessions.reduce((sum, s) => sum + s.durationSeconds, 0)
  return totalSeconds >= NOTIFY_MIN_SECONDS
}

function hasAnyActivityOn(date: string): boolean {
  const [fromMs, toMs] = localDayBounds(date)
  return getSessionsForRange(getDb(), fromMs, toMs).length > 0
}

function hasReachedLocalTime(now: Date, hour: number, minute = 0): boolean {
  return now.getHours() > hour || (now.getHours() === hour && now.getMinutes() >= minute)
}

// Tries to prep an AI report but resolves null if AI is unavailable or too slow.
// Wrapped is never blocked on this — it opens instantly with deterministic content.
async function tryPrepareAIReport(dateStr: string): Promise<{ route: string } | null> {
  const settings = getSettings()
  const provider = settings.aiProvider ?? 'anthropic'

  let aiAvailable = false
  try {
    aiAvailable = await hasApiKey(provider)
  } catch {
    aiAvailable = false
  }

  if (!aiAvailable) return null

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

async function checkDailySummary(): Promise<void> {
  const settings = getSettings()
  if (!settings.dailySummaryEnabled) return
  if (dailySummaryPreparing) return

  const now = new Date()
  const today = localDateString(now)
  const state = readState()
  if (state.lastDailySummaryDate === today) return
  if (!hasReachedLocalTime(now, 18)) return
  if (!hasEnoughActivityOn(today)) return

  dailySummaryPreparing = true
  try {
    const ai = await tryPrepareAIReport(today)
    const route = ai?.route ?? `/wrapped?date=${today}&source=daily-summary`
    notifyWithNavigation('Daylens', 'Your day is ready.', route)
    writeState({ ...state, lastDailySummaryDate: today })
  } finally {
    dailySummaryPreparing = false
  }
}

async function checkMorningNudge(): Promise<void> {
  const settings = getSettings()
  if (!settings.morningNudgeEnabled) return
  if (dailySummaryPreparing) return

  const now = new Date()
  const today = localDateString(now)
  const yesterday = localDateString(new Date(now.getTime() - 86_400_000))
  const state = readState()
  if (state.lastMorningNudgeDate === today) return
  if (!hasReachedLocalTime(now, 9) || now.getHours() >= 12) return
  if (hasAnyActivityOn(today)) return
  if (!hasEnoughActivityOn(yesterday)) return

  dailySummaryPreparing = true
  try {
    const ai = await tryPrepareAIReport(yesterday)
    const route = ai?.route ?? `/wrapped?date=${yesterday}&source=daily-summary`
    notifyWithNavigation(
      'Yesterday\'s recap is ready',
      "Carry the best signal from yesterday into today.",
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
    const ai = await tryPrepareAIReport(targetDate)
    const route = ai?.route ?? `/wrapped?date=${targetDate}&source=daily-summary`

    if (isMorning) {
      notifyWithNavigation(
        'Yesterday\'s recap is ready',
        "Carry the best signal from yesterday into today.",
        route,
        { actionText: 'Open' },
      )
    } else {
      notifyWithNavigation('Daylens', 'Your day is ready.', route)
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
