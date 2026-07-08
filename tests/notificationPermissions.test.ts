import test from 'node:test'
import assert from 'node:assert/strict'

// Tests share the same Electron process (and thus the same settings-stub
// singleton) within one file. All assertions are sequenced as one state
// machine walk to avoid cross-test leakage.

test('notificationPermissions: state machine and permission logic', async () => {
  const original = process.platform
  try {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    const mod = await import('../src/main/services/notificationPermissions.ts')

    // ── 1. Fresh state: not-determined ─────────────────────────────────
    assert.equal(mod.getNotificationPermissionState(), 'not-determined')
    assert.equal(mod.canDeliverNotifications(), true,
      'not-determined allows delivery (lets macOS show its own permission dialog)')
    assert.equal(mod.notificationBlockedReason(), null)

    // ── 2. Delivery failure → denied ─────────────────────────────────────
    await mod.handleDeliveryFailure()
    assert.equal(mod.getNotificationPermissionState(), 'denied')
    assert.equal(mod.canDeliverNotifications(), false)
    const reason = mod.notificationBlockedReason()
    assert.notEqual(reason, null)
    assert.match(reason!, /System Settings/)

    // ── 3. Recovery: denied → granted (user enables in settings) ─────────
    await mod.handleDeliverySuccess()
    assert.equal(mod.getNotificationPermissionState(), 'granted')
    assert.equal(mod.canDeliverNotifications(), true)
    assert.equal(mod.notificationBlockedReason(), null)

    // ── 4. Regress: granted → denied (OS revokes or settings change) ────
    await mod.handleDeliveryFailure()
    assert.equal(mod.getNotificationPermissionState(), 'denied')
    assert.equal(mod.canDeliverNotifications(), false)

    // ── 5. Full recovery back to granted ────────────────────────────────
    await mod.handleDeliverySuccess()
    assert.equal(mod.getNotificationPermissionState(), 'granted')
    assert.equal(mod.canDeliverNotifications(), true)
  } finally {
    Object.defineProperty(process, 'platform', { value: original })
  }
})

test('notificationPermissions: non-darwin platforms always return granted', async () => {
  const original = process.platform
  try {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const mod = await import('../src/main/services/notificationPermissions.ts')
    assert.equal(mod.getNotificationPermissionState(), 'granted')
    assert.equal(mod.canDeliverNotifications(), true)
    assert.equal(mod.notificationBlockedReason(), null)
  } finally {
    Object.defineProperty(process, 'platform', { value: original })
  }
})
