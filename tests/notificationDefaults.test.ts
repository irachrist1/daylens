import test from 'node:test'
import assert from 'node:assert/strict'

test('notification settings default to on for new installs', async () => {
  const { getSettings } = await import('../src/main/services/settings.ts')
  const settings = getSettings()
  assert.equal(settings.dailySummaryEnabled, true)
  assert.equal(settings.morningNudgeEnabled, true)
  assert.equal(settings.distractionAlertsEnabled, true)
})

test('notification permission state defaults to undefined (reads as not-determined in getNotificationPermissionState)', async () => {
  const { getSettings } = await import('../src/main/services/settings.ts')
  const settings = getSettings()
  assert.equal(settings.notificationPermissionState, undefined)
})
