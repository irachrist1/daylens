import type { NotificationPermissionState } from '@shared/types'
import { buildEveningWrapRoute, openDailySummaryRoute } from './dailySummaryNavigation'
import { deliverNotification, getNotificationDeliveryBlockedReason } from './notificationDelivery'
import { getNotificationPermissionState, requestNotificationPermission } from './notificationPermissions'
import { fireTestDistractionNotification } from './distractionAlerter'
import { fireTestDailySummaryNotification } from './dailySummaryNotifier'

export type TestNotificationKind =
  | 'evening-wrap'
  | 'morning-brief'
  | 'weekly-brief'
  | 'idle-reminder'
  | 'focus-nudge'

export interface TestNotificationResult {
  kind: TestNotificationKind
  ok: boolean
  reason?: string
}

const HARNESS_COPY: Record<TestNotificationKind, { title: string; body: string; route?: string }> = {
  'evening-wrap': {
    title: 'Your evening wrap',
    body: 'You closed the notification gap and pushed the Windows parity work before shipping.',
    route: buildEveningWrapRoute(new Date().toISOString().slice(0, 10)),
  },
  'morning-brief': {
    title: 'Yesterday, in one line',
    body: 'Yesterday you shipped Intercom support, cleared the version regression, and pushed main.',
    route: '/wrapped?date=2026-07-06&source=daily-summary',
  },
  'weekly-brief': {
    title: 'Your week, wrapped',
    body: 'A week carried by the notification rebuild, with Thursday the biggest day.',
    route: '/wrapped?period=week&date=2026-07-06&source=weekly-brief',
  },
  'idle-reminder': {
    title: 'Daylens',
    body: "You've been away from focused work for 10 minutes.",
  },
  'focus-nudge': {
    title: 'Daylens',
    body: "YouTube isn't on your focus plan — you've been there 10 minutes.",
  },
}

export async function fireTestNotification(kind: TestNotificationKind): Promise<TestNotificationResult> {
  const permission = getNotificationPermissionState()
  if (permission === 'unsupported') return { kind, ok: false, reason: 'notifications-unsupported' }
  if (permission === 'denied') {
    return { kind, ok: false, reason: getNotificationDeliveryBlockedReason() ?? 'notifications-denied' }
  }

  try {
    switch (kind) {
      case 'evening-wrap':
      case 'morning-brief':
      case 'weekly-brief': {
        const result = await fireTestDailySummaryNotification(kind)
        if (result.ok) return { kind, ok: true }
        const fallback = HARNESS_COPY[kind]
        const shown = deliverNotification({
          title: fallback.title,
          body: fallback.body,
          actionText: kind !== 'evening-wrap' ? 'Open' : undefined,
          onClick: fallback.route ? () => openDailySummaryRoute(fallback.route!) : undefined,
          surface: `harness:${kind}`,
        })
        return shown
          ? { kind, ok: true, reason: result.reason ? `fallback:${result.reason}` : undefined }
          : { kind, ok: false, reason: getNotificationDeliveryBlockedReason() ?? 'notifications-blocked' }
      }
      case 'idle-reminder':
      case 'focus-nudge': {
        const shown = fireTestDistractionNotification(kind)
        return shown
          ? { kind, ok: true }
          : { kind, ok: false, reason: getNotificationDeliveryBlockedReason() ?? 'notifications-blocked' }
      }
      default:
        return { kind, ok: false, reason: 'unknown-kind' }
    }
  } catch (err) {
    return {
      kind,
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function fireAllTestNotifications(): Promise<{
  permission: NotificationPermissionState
  results: TestNotificationResult[]
}> {
  const permission = getNotificationPermissionState()
  console.log(`[notification-harness] permission=${permission}`)

  if (permission === 'not-determined' && process.platform === 'darwin') {
    console.log('[notification-harness] requesting macOS notification permission…')
    const requested = await requestNotificationPermission()
    console.log(`[notification-harness] permission after request=${requested}`)
  }

  const kinds: TestNotificationKind[] = [
    'evening-wrap',
    'morning-brief',
    'weekly-brief',
    'idle-reminder',
    'focus-nudge',
  ]

  const results: TestNotificationResult[] = []
  for (const kind of kinds) {
    const result = await fireTestNotification(kind)
    results.push(result)
    console.log(
      `[notification-harness] ${kind}: ${result.ok ? 'shown' : 'blocked'}${result.reason ? ` (${result.reason})` : ''}`,
    )
    await new Promise((resolve) => setTimeout(resolve, 750))
  }

  const blocked = getNotificationDeliveryBlockedReason()
  if (blocked) console.warn(`[notification-harness] ${blocked}`)

  return {
    permission: getNotificationPermissionState(),
    results,
  }
}

/** Back-compat for the dev shortcut and existing IPC handler. */
export async function fireTestDailyNotification(): Promise<{ ok: boolean; reason?: string }> {
  const summary = await fireAllTestNotifications()
  const failed = summary.results.find((result) => !result.ok)
  return failed
    ? { ok: false, reason: failed.reason ?? 'notification-failed' }
    : { ok: true }
}
