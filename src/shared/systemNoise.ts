// One source of truth for invisible OS identities. These appear as the
// "frontmost app" or as historical rows but are never a user-initiated app:
// counting them inflates totals, and surfacing them to the AI/MCP leaks the
// shape of the machine. Capture, queries, projections, and the evidence
// boundary all import this so the policy can never drift between layers.

export interface AppIdentityCandidate {
  bundleId?: string | null
  appName?: string | null
}

const SYSTEM_NOISE_BUNDLE_IDS = new Set([
  'com.apple.loginwindow',
  'com.apple.dock',
  'com.apple.systemuiserver',
  'com.apple.notificationcenterui',
  'com.apple.controlcenter',
  'com.apple.screensaver.engine',
  'com.apple.backgroundtaskmanagementagent',
  'com.apple.usernotificationcenter',
  'com.apple.finder',
  'com.apple.siri',
  'com.apple.siri.agent',
  'com.apple.windowmanager',
])

const SYSTEM_NOISE_APP_NAMES = new Set([
  'loginwindow',
  'windowserver',
  'universalaccessd',
  'dock',
  'systemuiserver',
  'finder',
  'siri',
  'usernotificationcenter',
  'notification center',
  // Windows OS-level processes
  'dwm.exe',
  'csrss.exe',
  'svchost.exe',
  // Windows lock screen and screensaver
  'lockapp',
  'lockapp.exe',
  'scrnsave.scr',
])

export function isSystemNoiseApp(candidate: AppIdentityCandidate): boolean {
  const bundleId = candidate.bundleId?.trim().toLowerCase() ?? ''
  const appName = candidate.appName?.trim().toLowerCase() ?? ''
  return SYSTEM_NOISE_BUNDLE_IDS.has(bundleId) || SYSTEM_NOISE_APP_NAMES.has(appName)
}
