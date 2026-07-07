import { app, ipcMain } from 'electron'
import { IPC, type IntercomIdentity } from '@shared/types'
import { getAnalyticsDistinctId } from '../services/analytics'
import { getBillingAccess, getIntercomUserHash } from '../services/billing'
import { getDb } from '../services/database'
import { getDaysTracked } from '../db/queries'
import { getSettings } from '../services/settings'

// Assembles the identify payload the renderer boots the Intercom Messenger with.
// Everything here is public or device-local; the one secret-derived field
// (userHash) is computed by services/billing and arrives as null until the
// Identity Verification secret exists there.
export function registerIntercomHandlers(): void {
  ipcMain.handle(IPC.INTERCOM.GET_IDENTITY, async (): Promise<IntercomIdentity> => {
    const settings = getSettings()
    const daysSinceInstall = settings.firstLaunchDate > 0
      ? Math.floor((Date.now() - settings.firstLaunchDate) / 86_400_000)
      : 0

    let totalTrackedDays = 0
    try {
      totalTrackedDays = getDaysTracked(getDb(), 0)
    } catch {
      // DB not ready — identify without the attribute rather than fail the boot.
    }

    const access = await getBillingAccess().catch(() => null)
    const subscriptionStatus = access
      ? (access.mode === 'subscription' && access.subscriptionStatus ? access.subscriptionStatus : access.mode)
      : 'unknown'

    const userId = getAnalyticsDistinctId()
    return {
      userId,
      // No connected-account email exists in the desktop app today (nothing is
      // stored anywhere in main or renderer) — send null until accounts exist.
      email: null,
      userHash: await getIntercomUserHash(userId),
      platform: process.platform,
      version: app.getVersion(),
      subscriptionStatus,
      daysSinceInstall,
      totalTrackedDays,
    }
  })
}
