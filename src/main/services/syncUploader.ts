import { getDeviceId } from './credentials'
import { localDateString, daysFromTodayLocalDateString } from '../lib/localDate'
import {
  getConvexSiteUrl,
  getSessionToken,
  repairStoredWorkspaceSession,
} from './workspaceLinker'
import { buildRemoteSyncPayload, buildWorkspaceLivePresence } from './remoteSync'
import { onTrackingTick } from './tracking'
import { getDb } from './database'
import { projectDay, reprojectStaleDays } from '../core/projections/chunk2'
import { invalidateProjectionScope } from '../core/projections/invalidation'
import { runEveningConsolidation } from '../jobs/eveningConsolidation'

const HEARTBEAT_INTERVAL_MS = 15_000
const SYNC_INTERVAL_MS = 60_000
const TRACKING_SYNC_DEBOUNCE_MS = 20_000

const dirtyDays = new Set<string>()
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let syncTimer: ReturnType<typeof setInterval> | null = null
let unsubscribeTrackingTick: (() => void) | null = null
let lastHeartbeatAt: number | null = null
let lastSuccessfulDaySyncAt: number | null = null
let lastHeartbeatFailureAt: number | null = null
let lastHeartbeatFailureMessage: string | null = null
let lastDaySyncFailureAt: number | null = null
let lastDaySyncFailureMessage: string | null = null
let hasCompletedInitialDaySync = false
let lastTrackingTriggeredHeartbeatAt = 0
let heartbeatInFlight = false
let syncInFlight = false
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
  if (heartbeatTimer || syncTimer) return

  lastObservedLocalDate = todayStr()
  markDirty(lastObservedLocalDate)

  setTimeout(() => {
    void heartbeatNow()
    void syncNow()
  }, 5_000)

  heartbeatTimer = setInterval(() => {
    void heartbeatNow()
  }, HEARTBEAT_INTERVAL_MS)

  syncTimer = setInterval(() => {
    const currentDate = todayStr()
    if (currentDate !== lastObservedLocalDate) {
      const finalizedDate = lastObservedLocalDate
      lastObservedLocalDate = currentDate
      markDirty(finalizedDate)
      projectFinalizedDay(finalizedDate, 'day-rollover')
    }
    markDirty(currentDate)
    void syncNow()
  }, SYNC_INTERVAL_MS)

  unsubscribeTrackingTick = onTrackingTick(() => {
    // Heartbeat-only on the tracking tick. The full per-dirty-day snapshot upload
    // is left to the SYNC_INTERVAL_MS timer below, so steady tracking no longer
    // rebuilds and ships the remote payload every few seconds (F12). markDirty
    // keeps today queued for that periodic sync.
    markDirty(todayStr())
    const now = Date.now()
    if (now - lastTrackingTriggeredHeartbeatAt < TRACKING_SYNC_DEBOUNCE_MS) {
      return
    }
    lastTrackingTriggeredHeartbeatAt = now
    void heartbeatNow()
  })

  console.log('[sync] started', {
    heartbeatSeconds: HEARTBEAT_INTERVAL_MS / 1000,
    syncSeconds: SYNC_INTERVAL_MS / 1000,
  })
}

export function stopSync(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
  if (syncTimer) {
    clearInterval(syncTimer)
    syncTimer = null
  }
  if (unsubscribeTrackingTick) {
    unsubscribeTrackingTick()
    unsubscribeTrackingTick = null
  }
  markDirty(todayStr())
  console.log('[sync] stopped')
}

export async function syncNowForQuit(): Promise<void> {
  markDirty(todayStr())
  await heartbeatNow()
  await syncNow()
}

export function markDirty(dateStr: string): void {
  dirtyDays.add(dateStr)
}

export function getLastSyncAt(): number | null {
  return lastSuccessfulDaySyncAt
}

export function getSyncRuntimeState(): SyncRuntimeState {
  return {
    lastHeartbeatAt,
    lastSuccessfulDaySyncAt,
    lastHeartbeatFailureAt,
    lastHeartbeatFailureMessage,
    lastDaySyncFailureAt,
    lastDaySyncFailureMessage,
    hasCompletedInitialDaySync,
  }
}

export function finalizePreviousDay(): void {
  const yesterday = daysFromTodayLocalDateString(-1)
  markDirty(yesterday)

  // Stagger the heavy startup chain across macrotasks instead of running
  // finalize -> consolidation -> reproject sweep -> sync back-to-back in one
  // tick (the old ~10s-after-launch CPU/IO spike). setImmediate hands the event
  // loop back between phases so the window and tracking poll stay responsive.
  const steps: Array<() => void> = [
    () => projectFinalizedDayProjection(yesterday, 'startup-finalize'),
    () => consolidateWorkMemory(yesterday, 'startup-finalize'),
    () => reprojectStaleProjectionDays(),
    () => { void syncNow() },
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

// Projection only. Day-rollover finalize pairs this with consolidation; the
// staggered startup path runs the two as separate macrotasks.
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

async function heartbeatNow(): Promise<void> {
  if (heartbeatInFlight) return
  heartbeatInFlight = true

  try {
    const siteUrl = getConvexSiteUrl()
    const sessionToken = await getSessionToken()
    const deviceId = await getDeviceId()

    if (!siteUrl || !sessionToken || !deviceId) {
      return
    }

    const presence = buildWorkspaceLivePresence(deviceId)
    const res = await postWithSessionRepair(
      siteUrl,
      sessionToken,
      'remote/heartbeat',
      presence,
    )

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      recordHeartbeatFailure(`heartbeat failed: ${res.status} ${text}`.trim())
      return
    }

    recordHeartbeatSuccess()
  } catch (error) {
    recordHeartbeatFailure(`heartbeat error: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    heartbeatInFlight = false
  }
}

async function syncNow(): Promise<void> {
  if (syncInFlight || dirtyDays.size === 0) return
  syncInFlight = true

  try {
    const siteUrl = getConvexSiteUrl()
    const sessionToken = await getSessionToken()
    const deviceId = await getDeviceId()

    if (!siteUrl || !sessionToken || !deviceId) {
      return
    }

    const dates = [...dirtyDays].sort()

    for (const dateStr of dates) {
      try {
        const payload = buildRemoteSyncPayload(dateStr, deviceId)
        const res = await postWithSessionRepair(
          siteUrl,
          sessionToken,
          'remote/syncDay',
          payload,
        )

        if (!res.ok) {
          const text = await res.text().catch(() => '')
          recordDaySyncFailure(`day sync failed for ${dateStr}: ${res.status} ${text}`.trim())
          continue
        }

        dirtyDays.delete(dateStr)
        hasCompletedInitialDaySync = true
        recordDaySyncSuccess()
        console.log(`[sync] remote day synced ${dateStr}`)
      } catch (error) {
        recordDaySyncFailure(`day sync error for ${dateStr}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  } finally {
    syncInFlight = false
  }
}

function todayStr(): string {
  return localDateString()
}

function recordHeartbeatSuccess(): void {
  lastHeartbeatAt = Date.now()
  lastHeartbeatFailureAt = null
  lastHeartbeatFailureMessage = null
}

function recordHeartbeatFailure(message: string): void {
  lastHeartbeatFailureAt = Date.now()
  lastHeartbeatFailureMessage = message
  console.warn('[sync]', message)
}

function recordDaySyncSuccess(): void {
  lastSuccessfulDaySyncAt = Date.now()
  lastDaySyncFailureAt = null
  lastDaySyncFailureMessage = null
}

function recordDaySyncFailure(message: string): void {
  lastDaySyncFailureAt = Date.now()
  lastDaySyncFailureMessage = message
  console.warn('[sync]', message)
}

async function postWithSessionRepair(
  siteUrl: string,
  sessionToken: string,
  path: string,
  body: unknown,
): Promise<Response> {
  const initial = await post(siteUrl, sessionToken, path, body)
  if (initial.ok) {
    return initial
  }

  const initialText = await initial.clone().text().catch(() => '')
  if (!shouldAttemptSessionRepair(initial.status, initialText)) {
    return initial
  }

  const repaired = await repairStoredWorkspaceSession()
  if (!repaired) {
    return initial
  }

  const freshToken = await getSessionToken()
  if (!freshToken) {
    return initial
  }

  return post(siteUrl, freshToken, path, body)
}

function post(
  siteUrl: string,
  sessionToken: string,
  path: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${siteUrl}/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sessionToken}`,
    },
    body: JSON.stringify(body),
  })
}

function shouldAttemptSessionRepair(status: number, bodyText: string): boolean {
  if (status !== 401 && status !== 403) return false

  return bodyText.includes('identity mismatch')
    || bodyText.includes('Unknown device')
    || bodyText.includes('Not authenticated')
    || bodyText.includes('Session revoked')
}
