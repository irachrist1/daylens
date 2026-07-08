#!/usr/bin/env node
// Notification test harness — exercises the app's actual notification delivery
// pipeline (deliverNotification, canDeliverNotifications, permission state)
// rather than creating raw Electron Notification objects.
//
// Usage:
//   DAYLENS_REAL_ELECTRON=1 ELECTRON_RUN_AS_NODE=1 electron \
//     --loader ./tests/support/ts-loader.mjs \
//     scripts/fire-test-notifications.mjs
//
// The env var DAYLENS_REAL_ELECTRON=1 tells ts-loader not to stub the electron
// module so real Notification objects are used.

import { setTimeout as delay } from 'node:timers/promises'
import { app, Notification } from 'electron'
import { deliverNotification } from '../src/main/services/notificationDelivery.ts'
import {
  canDeliverNotifications,
  getNotificationPermissionState,
  requestNotificationPermission,
  handleDeliverySuccess,
  handleDeliveryFailure,
} from '../src/main/services/notificationPermissions.ts'

const KINDS = [
  {
    kind: 'evening-wrap',
    title: 'Your evening wrap',
    body: 'You closed the notification gap and pushed the Windows parity work before shipping.',
  },
  {
    kind: 'morning-brief',
    title: 'Yesterday, in one line',
    body: 'Yesterday you shipped Intercom support, cleared the version regression, and pushed main.',
  },
  {
    kind: 'idle-reminder',
    title: 'Daylens',
    body: "You've been away from focused work for 10 minutes.",
  },
  {
    kind: 'focus-nudge',
    title: 'Daylens',
    body: "YouTube isn't on your focus plan — you've been there 10 minutes.",
  },
]

async function main() {
  await app.whenReady()

  let permission = getNotificationPermissionState()
  console.log(`[notification-harness] permission=${permission}`)

  if (permission === 'not-determined' && process.platform === 'darwin') {
    console.log('[notification-harness] requesting macOS notification permission…')
    permission = await requestNotificationPermission()
    console.log(`[notification-harness] permission after request=${permission}`)
  }

  if (!canDeliverNotifications()) {
    console.warn('[notification-harness] notifications blocked — cannot deliver')
  }

  const results = []
  for (const entry of KINDS) {
    if (!canDeliverNotifications()) {
      console.log(`[notification-harness] ${entry.kind}: blocked (no permission)`)
      results.push({ kind: entry.kind, ok: false, reason: 'notifications-blocked' })
      continue
    }

    const shown = deliverNotification({
      title: entry.title,
      body: entry.body,
      surface: `harness:${entry.kind}`,
    })

    console.log(`[notification-harness] ${entry.kind}: ${shown ? 'shown' : 'blocked'}`)
    results.push({ kind: entry.kind, ok: shown })
    await delay(750)
  }

  // Fallback: when the app's pipeline is blocked, try raw Notification as a
  // diagnostic — this distinguishes "app delivery logic blocked" from
  // "OS permission denied" or "notifications unsupported".
  if (results.every((r) => !r.ok) && !Notification.isSupported()) {
    console.warn('[notification-harness] Notifications are not supported on this system.')
  } else if (results.every((r) => !r.ok) && getNotificationPermissionState() === 'denied') {
    console.warn('[notification-harness] Notifications are off for Daylens. Open System Settings → Notifications → Daylens and allow alerts.')
  }

  console.log(JSON.stringify({ permission: getNotificationPermissionState(), results }, null, 2))
  app.exit(results.some((r) => !r.ok) ? 1 : 0)
}

main().catch((error) => {
  console.error('[notification-harness] failed:', error)
  app.exit(1)
})
