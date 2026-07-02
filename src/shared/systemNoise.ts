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
  'com.apple.securityagent',
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
  'securityagent',
  'securityagenthelper',
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
  // Windows shell chrome and logon UI — never user-initiated apps
  'logonui.exe',
  'shellexperiencehost.exe',
  'searchhost.exe',
  'startmenuexperiencehost.exe',
  'textinputhost.exe',
])

// Window titles that belong to the OS itself, not to any work the user did.
// A capture can report a legitimate app as the foreground process while the
// actual visible surface is the lock screen or a notification toast — those
// must never count as time (invariant 11) and must never name a block
// (invariant 5). Matched on the exact, trimmed, lowercased title so a real
// page like "Notification settings" is never swept up.
const SYSTEM_NOISE_WINDOW_TITLES = new Set([
  'new notification',
  'notification center',
  'windows default lock screen',
  'lock screen',
  'windows shell experience host',
])

export function isSystemNoiseApp(candidate: AppIdentityCandidate): boolean {
  const bundleId = candidate.bundleId?.trim().toLowerCase() ?? ''
  const appName = candidate.appName?.trim().toLowerCase() ?? ''
  return SYSTEM_NOISE_BUNDLE_IDS.has(bundleId) || SYSTEM_NOISE_APP_NAMES.has(appName)
}

export function isSystemNoiseTitle(title: string | null | undefined): boolean {
  if (!title) return false
  return SYSTEM_NOISE_WINDOW_TITLES.has(title.trim().toLowerCase())
}
