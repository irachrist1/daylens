import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, Notification, app } from 'electron'
import { getSessionsForRange } from '../db/queries'
import { localDateString, localDayBounds } from '../lib/localDate'
import { getDb } from './database'
import { getSettings } from './settings'
import { prepareDailyReport } from './ai'

interface DailyNotifierState {
  lastDailySummaryDate?: string
  lastMorningNudgeDate?: string
}

let notifierTimer: ReturnType<typeof setInterval> | null = null
let navigationWindow: BrowserWindow | null = null
let dailySummaryPreparing = false

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

function notifyWithNavigation(title: string, body: string, route: string): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({ title, body })
  notification.on('click', () => {
    if (!navigationWindow || navigationWindow.isDestroyed()) return
    if (navigationWindow.isMinimized()) navigationWindow.restore()
    navigationWindow.show()
    navigationWindow.focus()
    navigationWindow.webContents.send('navigate', route)
  })
  notification.show()
}

function hasTrackedActivityToday(today: string): boolean {
  const [fromMs, toMs] = localDayBounds(today)
  return getSessionsForRange(getDb(), fromMs, toMs).length > 0
}

function hasReachedLocalTime(now: Date, hour: number, minute = 0): boolean {
  return now.getHours() > hour || (now.getHours() === hour && now.getMinutes() >= minute)
}

function dailyReportRoute(report: { threadId: number | null; artifactId: number | null }): string {
  const params = new URLSearchParams()
  if (report.threadId != null) params.set('threadId', String(report.threadId))
  if (report.artifactId != null) params.set('artifactId', String(report.artifactId))
  params.set('source', 'daily-summary')
  const query = params.toString()
  return query ? `/ai?${query}` : '/ai'
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
  if (!hasTrackedActivityToday(today)) return

  dailySummaryPreparing = true
  try {
    const report = await prepareDailyReport(today)
    if (report.status !== 'ready') return
    notifyWithNavigation('Daylens', 'Your day report is ready.', dailyReportRoute(report))
    writeState({ ...state, lastDailySummaryDate: today })
  } finally {
    dailySummaryPreparing = false
  }
}

function checkMorningNudge(): void {
  const settings = getSettings()
  if (!settings.morningNudgeEnabled) return

  const now = new Date()
  const today = localDateString(now)
  const state = readState()
  if (state.lastMorningNudgeDate === today) return
  if (!hasReachedLocalTime(now, 9) || now.getHours() >= 12) return
  if (hasTrackedActivityToday(today)) return

  notifyWithNavigation('Daylens', 'Open your timeline and start the main thread for today.', '/timeline')
  writeState({ ...state, lastMorningNudgeDate: today })
}

export function setDailySummaryNotificationWindow(window: BrowserWindow | null): void {
  navigationWindow = window
}

export function startDailySummaryNotifier(window?: BrowserWindow | null): void {
  if (window) {
    navigationWindow = window
  }
  if (notifierTimer) return

  const runChecks = () => {
    void (async () => {
      try {
        checkMorningNudge()
        await checkDailySummary()
      } catch (err) {
        console.warn('[daily-summary] notifier check failed:', err)
      }
    })()
  }

  runChecks()
  notifierTimer = setInterval(runChecks, 60_000)
}
