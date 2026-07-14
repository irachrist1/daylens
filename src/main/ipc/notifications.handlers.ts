import { ipcMain } from 'electron'
import { IPC } from '@shared/types'
import {
  getNotificationPermissionState,
  openNotificationSettings,
  requestNotificationPermission,
} from '../services/notificationPermissions'
import { fireAllTestNotifications, fireTestNotification } from '../services/notificationHarness'
import type { TestNotificationKind } from '../services/notificationHarness'
import { isRealDayHarness } from '../lib/realDayHarness'

export function registerNotificationHandlers(): void {
  ipcMain.handle(IPC.NOTIFICATIONS.GET_PERMISSION_STATE, () => getNotificationPermissionState())
  ipcMain.handle(IPC.NOTIFICATIONS.REQUEST_PERMISSION, async () => requestNotificationPermission())
  ipcMain.handle(IPC.NOTIFICATIONS.OPEN_SETTINGS, async () => {
    await openNotificationSettings()
  })
  ipcMain.handle('dev:fire-test-notifications', async () => (
    isRealDayHarness() ? [] : fireAllTestNotifications()
  ))
  ipcMain.handle(
    'dev:fire-test-notification',
    async (_event, kind: TestNotificationKind) => (
      isRealDayHarness() ? { delivered: false, reason: 'Disabled during a private real-day replay.' } : fireTestNotification(kind)
    ),
  )
}
