import { localDateString, daysFromTodayLocalDateString } from '../lib/localDate'
import { getDb } from './database'
import { projectDay, reprojectStaleDays } from '../core/projections/chunk2'
import { invalidateProjectionScope } from '../core/projections/invalidation'
import { runEveningConsolidation } from '../jobs/eveningConsolidation'

let dayCheckTimer: ReturnType<typeof setInterval> | null = null
let lastObservedLocalDate = todayStr()

export interface SyncRuntimeState {
  lastHeartbeatAt: number | null
  lastSuccessfulDaySyncAt: number | null
  lastHeartbeatFailureAt: number | null
  lastHeartbeatFailureMessage: string | null
  lastDaySyncFailureAt: number | null
  lastDaySyncFailureMessage: string | null
  hasCompletedInitialDaySync: boolean
}

export function startSync(): void {
  if (dayCheckTimer) return

  lastObservedLocalDate = todayStr()

  // Periodically check for local day rollovers in the background (every 30 seconds)
  dayCheckTimer = setInterval(() => {
    const currentDate = todayStr()
    if (currentDate !== lastObservedLocalDate) {
      const finalizedDate = lastObservedLocalDate
      lastObservedLocalDate = currentDate
      projectFinalizedDay(finalizedDate, 'day-rollover')
    }
  }, 30_000)

  console.log('[sync] offline day-rollover scheduler started')
}

export function stopSync(): void {
  if (dayCheckTimer) {
    clearInterval(dayCheckTimer)
    dayCheckTimer = null
  }
  console.log('[sync] offline day-rollover scheduler stopped')
}

export async function syncNowForQuit(): Promise<void> {
  // Syncing with Convex is disabled; no-op on quit to keep it fast.
}

export function markDirty(_dateStr: string): void {
  // Sync is disabled; no-op.
}

export function getLastSyncAt(): number | null {
  return null
}

export function getSyncRuntimeState(): SyncRuntimeState {
  return {
    lastHeartbeatAt: null,
    lastSuccessfulDaySyncAt: null,
    lastHeartbeatFailureAt: null,
    lastHeartbeatFailureMessage: null,
    lastDaySyncFailureAt: null,
    lastDaySyncFailureMessage: null,
    hasCompletedInitialDaySync: false,
  }
}

export function finalizePreviousDay(): void {
  const yesterday = daysFromTodayLocalDateString(-1)

  // Stagger the heavy startup calculations across macrotasks to keep Electron responsive
  const steps: Array<() => void> = [
    () => projectFinalizedDayProjection(yesterday, 'startup-finalize'),
    () => consolidateWorkMemory(yesterday, 'startup-finalize'),
    () => reprojectStaleProjectionDays(),
  ]

  const runStep = (index: number): void => {
    if (index >= steps.length) return
    try {
      steps[index]()
    } finally {
      setImmediate(() => runStep(index + 1))
    }
  }
  setImmediate(() => runStep(0))
}

function projectFinalizedDayProjection(dateStr: string, reason: string): void {
  try {
    const result = projectDay(getDb(), dateStr, { finalize: true })
    if (result.skipped) {
      console.log('[projection] skipped finalized day', { date: dateStr, reason: result.reason })
    } else {
      invalidateProjectedDay(dateStr, reason)
      console.log('[projection] finalized day', {
        date: dateStr,
        events: result.events,
        sessions: result.sessions,
        blocks: result.blocks,
        reason,
      })
    }
  } catch (error) {
    console.warn('[projection] failed to finalize day:', error)
  }
}

function projectFinalizedDay(dateStr: string, reason: string): void {
  projectFinalizedDayProjection(dateStr, reason)
  consolidateWorkMemory(dateStr, reason)
}

function consolidateWorkMemory(dateStr: string, reason: string): void {
  try {
    const outcome = runEveningConsolidation(getDb(), dateStr)
    if (outcome.skipped) {
      console.log('[work-memory] consolidation skipped', { date: dateStr, reason, skipReason: outcome.reason })
      return
    }
    console.log('[work-memory] consolidated day', {
      date: dateStr,
      reason,
      newCandidates: outcome.newCandidates,
      promoted: outcome.promoted,
      decayed: outcome.decayed,
      backfilled: outcome.backfilled,
    })
  } catch (error) {
    console.warn('[work-memory] consolidation failed:', error)
  }
}

function reprojectStaleProjectionDays(): void {
  try {
    const result = reprojectStaleDays(getDb(), { maxDays: 7 })
    for (const date of result.reprojected) {
      invalidateProjectedDay(date, 'projection-version')
    }
    if (result.reprojected.length > 0 || result.skipped.length > 0) {
      console.log('[projection] stale-day sweep', result)
    }
  } catch (error) {
    console.warn('[projection] failed stale-day sweep:', error)
  }
}

function invalidateProjectedDay(dateStr: string, reason: string): void {
  invalidateProjectionScope('timeline', reason, { date: dateStr })
  invalidateProjectionScope('apps', reason, { date: dateStr })
  invalidateProjectionScope('insights', reason, { date: dateStr })
}

function todayStr(): string {
  return localDateString()
}
