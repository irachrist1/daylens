import fs from 'node:fs'
import path from 'node:path'
import { Notification, app } from 'electron'
import { getAppSummariesForRange, getRecentFocusSessions } from '../db/queries'
import { getDb } from './database'
import { localDateString, localDayBounds } from '../lib/localDate'

interface DailyNotifierState {
  lastDailySummaryDate?: string
  lastMorningNudgeDate?: string
  lastDigestDate?: string
}

let notifierTimer: ReturnType<typeof setInterval> | null = null

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours === 0) return `${minutes}m`
  return `${hours}h ${minutes}m`
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

function sendNotification(title: string, body: string): void {
  if (!Notification.isSupported()) return
  new Notification({ title, body }).show()
}

function checkDailySummary(): void {
  const now = new Date()
  const hour = now.getHours()
  const minute = now.getMinutes()
  const today = localDateString(now)
  const state = readState()

  const withinWindow = hour === 17 && minute >= 30 || hour === 18 && minute <= 30
  if (!withinWindow || state.lastDailySummaryDate === today) return

  const [fromMs, toMs] = localDayBounds(today)
  const summaries = getAppSummariesForRange(getDb(), fromMs, toMs)
  const totalTracked = summaries.reduce((sum, summary) => sum + summary.totalSeconds, 0)
  const focusSeconds = summaries
    .filter((summary) => summary.isFocused)
    .reduce((sum, summary) => sum + summary.totalSeconds, 0)
  const focusPct = totalTracked > 0 ? Math.round((focusSeconds / totalTracked) * 100) : 0
  const topApp = summaries[0]?.appName ?? 'No app data yet'
  const focusSessionsCount = getRecentFocusSessions(getDb(), 50)
    .filter((session) => session.startTime >= fromMs && session.startTime < toMs)
    .length

  let prefix = ''
  if (focusPct >= 80) prefix = 'Great day! '
  else if (focusPct < 50 && totalTracked > 7200) prefix = 'Distracting day - '

  const focusSuffix = focusSessionsCount > 0 ? ` · ${focusSessionsCount} focus sessions` : ''
  sendNotification(
    'Daylens - Your Day Summary',
    `${prefix}${focusPct}% focused · ${formatDuration(totalTracked)} tracked · ${topApp} was your most used app${focusSuffix}`,
  )

  writeState({ ...state, lastDailySummaryDate: today })
}

function checkMorningNudge(): void {
  const now = new Date()
  const day = now.getDay()
  const hour = now.getHours()
  const minute = now.getMinutes()
  const today = localDateString(now)
  const state = readState()

  const weekday = day >= 1 && day <= 5
  const withinWindow = hour === 8 && minute >= 45 || hour === 9 && minute <= 30
  if (!weekday || !withinWindow || state.lastMorningNudgeDate === today) return

  const [fromMs, toMs] = localDayBounds(today)
  const summaries = getAppSummariesForRange(getDb(), fromMs, toMs)
  const totalTracked = summaries.reduce((sum, summary) => sum + summary.totalSeconds, 0)
  if (totalTracked > 0) return

  sendNotification(
    'Daylens',
    "Good morning - Daylens is tracking. Start a Focus Session when you're ready to do deep work.",
  )

  writeState({ ...state, lastMorningNudgeDate: today })
}

function checkDailyDigest(): void {
  const now = new Date()
  const hour = now.getHours()
  const minute = now.getMinutes()
  const today = localDateString(now)
  const state = readState()

  // Fire at exactly 6:00 PM (18:00), checked once per minute
  if (hour !== 18 || minute !== 0) return
  if (state.lastDigestDate === today) return

  const [fromMs, toMs] = localDayBounds(today)
  const summaries = getAppSummariesForRange(getDb(), fromMs, toMs)
  const totalSecs = summaries.reduce((sum, s) => sum + s.totalSeconds, 0)

  // Skip if nothing tracked
  if (totalSecs < 60) return

  const focusSecs = summaries.filter((s) => s.isFocused).reduce((sum, s) => sum + s.totalSeconds, 0)
  const focusPct = Math.round((focusSecs / totalSecs) * 100)
  const topApp = summaries[0]?.appName ?? '—'

  sendNotification(
    'Your day at a glance',
    `You tracked ${formatDuration(totalSecs)} today, ${focusPct}% focused. Top app: ${topApp}. Open Daylens for full insights.`,
  )

  writeState({ ...state, lastDigestDate: today })
}

export function startDailySummaryNotifier(): void {
  if (notifierTimer) return

  const runChecks = () => {
    try {
      checkMorningNudge()
      checkDailySummary()
      checkDailyDigest()
    } catch (err) {
      console.warn('[daily-summary] notifier check failed:', err)
    }
  }

  runChecks()
  notifierTimer = setInterval(runChecks, 60_000)
}
