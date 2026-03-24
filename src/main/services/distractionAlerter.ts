import fs from 'node:fs'
import path from 'node:path'
import { Notification, app } from 'electron'
import type { AppCategory } from '@shared/types'
import { FOCUSED_CATEGORIES } from '@shared/types'
import { getCurrentSession } from './tracking'
import { localDateString } from '../lib/localDate'
import { getSessionsForRange } from '../db/queries'
import { getDb } from './database'

interface DistractionState {
  appCooldowns?: Record<string, number>
  breakReminderCooldownUntil?: number
}

interface RollingEntry {
  at: number
  appName: string
  seconds: number
}

let distractionTimer: ReturnType<typeof setInterval> | null = null
const rollingWindow: RollingEntry[] = []

function statePath(): string {
  return path.join(app.getPath('userData'), 'distraction-alert-state.json')
}

function readState(): DistractionState {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8')) as DistractionState
  } catch {
    return {}
  }
}

function writeState(state: DistractionState): void {
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2))
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours === 0) return `${minutes}m`
  return `${hours}h ${minutes}m`
}

function isDistractingCategory(category: AppCategory): boolean {
  return category === 'entertainment' || category === 'social'
}

function pruneWindow(nowMs: number): void {
  while (rollingWindow.length > 0 && rollingWindow[0].at < nowMs - 60 * 60_000) {
    rollingWindow.shift()
  }
}

function sendNotification(title: string, body: string): void {
  if (!Notification.isSupported()) return
  new Notification({ title, body }).show()
}

function checkDistraction(): void {
  const now = new Date()
  const hour = now.getHours()
  if (hour < 8 || hour >= 21) return

  const live = getCurrentSession()
  const nowMs = Date.now()
  pruneWindow(nowMs)

  if (!live || !isDistractingCategory(live.category)) return

  rollingWindow.push({
    at: nowMs,
    appName: live.appName,
    seconds: 60,
  })
  pruneWindow(nowMs)

  const state = readState()
  const cooldowns = state.appCooldowns ?? {}
  const lastAlertAt = cooldowns[live.bundleId] ?? 0
  if (nowMs - lastAlertAt < 2 * 60 * 60_000) return

  const continuousSeconds = Math.max(0, Math.round((nowMs - live.startTime) / 1_000))
  const rollingSeconds = rollingWindow
    .filter((entry) => entry.appName === live.appName)
    .reduce((sum, entry) => sum + entry.seconds, 0)

  if (continuousSeconds < 25 * 60 || rollingSeconds < 25 * 60) return

  sendNotification(
    `Still on ${live.appName}?`,
    `You've been on ${live.appName} for ${formatDuration(continuousSeconds)}. A short reset now can keep the rest of the hour from slipping away.`,
  )

  cooldowns[live.bundleId] = nowMs
  writeState({ appCooldowns: cooldowns })
}

// ─── Smart Break Reminder ────────────────────────────────────────────────────

let breakCheckCount = 0

function checkBreakReminder(): void {
  const now = new Date()
  const hour = now.getHours()
  if (hour < 8 || hour >= 21) return

  const live = getCurrentSession()
  // Do not fire if no live session (user has paused tracking) in last 5 min
  if (!live) return

  const nowMs = Date.now()
  const state = readState()

  // Check cooldown
  if (state.breakReminderCooldownUntil && nowMs < state.breakReminderCooldownUntil) return

  try {
    const db = getDb()
    const windowStart = nowMs - 90 * 60_000
    const sessions = getSessionsForRange(db, windowStart, nowMs)

    // Total deep-work seconds in last 90 min
    const totalFocusSec = sessions
      .filter((s) => FOCUSED_CATEGORIES.includes(s.category))
      .reduce((sum, s) => {
        const start = Math.max(s.startTime, windowStart)
        const end = s.endTime ? Math.min(s.endTime, nowMs) : nowMs
        return sum + Math.max(0, Math.round((end - start) / 1_000))
      }, 0)

    if (totalFocusSec < 75 * 60) return

    // Check for meeting sessions in last 5 min
    const meetingWindow = nowMs - 5 * 60_000
    const hasMeeting = sessions.some(
      (s) => s.category === 'meetings' && s.startTime >= meetingWindow,
    )
    if (hasMeeting) return

    sendNotification(
      'Time for a break',
      "You've been focused for over 75 minutes. A 5-minute break can help.",
    )

    writeState({ ...state, breakReminderCooldownUntil: nowMs + 30 * 60_000 })
  } catch (err) {
    console.warn('[distraction] break reminder check failed:', err)
  }
}

export function startDistractionAlerter(): void {
  if (distractionTimer) return

  try {
    const today = localDateString()
    const state = readState()
    if (!state.appCooldowns) {
      writeState({ ...state, appCooldowns: {}, lastSeenDate: today } as DistractionState & { lastSeenDate: string })
    }
  } catch {}

  checkDistraction()
  distractionTimer = setInterval(() => {
    try {
      checkDistraction()
      // Check break reminder every 5 ticks (5 minutes)
      breakCheckCount++
      if (breakCheckCount % 5 === 0) {
        checkBreakReminder()
      }
    } catch (err) {
      console.warn('[distraction] alerter check failed:', err)
    }
  }, 60_000)
}
