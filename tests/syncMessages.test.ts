import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeSyncFailureMessage } from '../src/shared/syncMessages.ts'

test('sync failure messages hide expired token stack traces', () => {
  const raw = 'day sync failed for 2026-04-29: 500 {"code":"[Request ID: abc] Server Error: Uncaught Error: Could not validate token: Token expired 620742 seconds ago","trace":"at async <anonymous> (../convex/http.ts:303:8)"}'
  assert.equal(
    sanitizeSyncFailureMessage(raw),
    'Workspace link expired. Reconnect this device.',
  )
})

test('sync failure messages hide server internals', () => {
  assert.equal(
    sanitizeSyncFailureMessage('500 [Request ID: abc] Server Error: Convex stack trace'),
    'Workspace sync hit a server problem. Try again in a moment.',
  )
})

test('sync failure messages treat jwt expiry as a reconnect action', () => {
  assert.equal(
    sanitizeSyncFailureMessage('JWTExpired: exp claim timestamp check failed [Request ID: xyz]'),
    'Workspace link expired. Reconnect this device.',
  )
})
