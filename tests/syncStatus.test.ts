import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveSyncState } from '../src/main/services/syncState.ts'
import type { SyncRuntimeState } from '../src/main/services/syncUploader.ts'

function runtime(overrides: Partial<SyncRuntimeState> = {}): SyncRuntimeState {
  return {
    lastHeartbeatAt: null,
    lastSuccessfulDaySyncAt: null,
    lastHeartbeatFailureAt: null,
    lastHeartbeatFailureMessage: null,
    lastDaySyncFailureAt: null,
    lastDaySyncFailureMessage: null,
    hasCompletedInitialDaySync: false,
    ...overrides,
  }
}

test('heartbeat freshness does not clear a newer durable sync failure', () => {
  const now = Date.parse('2026-04-20T12:00:00Z')
  const state = deriveSyncState(runtime({
    hasCompletedInitialDaySync: true,
    lastSuccessfulDaySyncAt: now - 120_000,
    lastDaySyncFailureAt: now - 60_000,
    lastHeartbeatAt: now - 5_000,
  }), true, now)

  assert.equal(state, 'failed')
})

test('linked workspaces stay pending until the first durable sync lands', () => {
  const now = Date.parse('2026-04-20T12:00:00Z')
  const state = deriveSyncState(runtime({
    lastHeartbeatAt: now - 5_000,
  }), true, now)

  assert.equal(state, 'pending_first_sync')
})

test('fresh heartbeat plus successful durable sync reports healthy', () => {
  const now = Date.parse('2026-04-20T12:00:00Z')
  const state = deriveSyncState(runtime({
    hasCompletedInitialDaySync: true,
    lastSuccessfulDaySyncAt: now - 30_000,
    lastHeartbeatAt: now - 5_000,
  }), true, now)

  assert.equal(state, 'healthy')
})

test('stale heartbeat marks the linked workspace stale even after a successful sync', () => {
  const now = Date.parse('2026-04-20T12:00:00Z')
  const state = deriveSyncState(runtime({
    hasCompletedInitialDaySync: true,
    lastSuccessfulDaySyncAt: now - 30_000,
    lastHeartbeatAt: now - (5 * 60_000 + 1),
  }), true, now)

  assert.equal(state, 'stale')
})
