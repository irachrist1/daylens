// Intercom Messenger (Fin). The renderer only ever handles public values — the
// App ID ships in the widget URL for every Intercom customer. Identity
// Verification's user_hash is HMAC-SHA256 of the user id with a secret that
// lives only in services/billing, so main fetches it from there and it arrives
// null until that secret is configured (the Messenger then boots unverified).
import { ipc } from './ipc'

declare const __INTERCOM_APP_ID__: string

const INTERCOM_API_BASE = 'https://api-iam.intercom.io'
const WIDGET_SCRIPT_ID = 'intercom-widget-script'

type IntercomFn = ((...args: unknown[]) => void) & { q?: unknown[][] }

declare global {
  interface Window {
    Intercom?: IntercomFn
    intercomSettings?: Record<string, unknown>
  }
}

// The official loader snippet, unwound: install a queueing stub so calls made
// before the widget script arrives are replayed in order once it loads.
function intercom(): IntercomFn {
  if (!window.Intercom) {
    const stub: IntercomFn = (...args: unknown[]) => {
      stub.q!.push(args)
    }
    stub.q = []
    window.Intercom = stub
  }
  return window.Intercom
}

function injectWidgetScript(appId: string): void {
  if (document.getElementById(WIDGET_SCRIPT_ID)) return
  const script = document.createElement('script')
  script.id = WIDGET_SCRIPT_ID
  script.async = true
  script.src = `https://widget.intercom.io/widget/${appId}`
  document.head.appendChild(script)
}

let booted = false

// Boot once per app run, identified from main-process truth (device id, version,
// billing state, tracked-day counts). `showLauncher: false` keeps the floating
// bubble hidden — used during onboarding so it can't overlap the setup flow;
// setIntercomLauncherVisible(true) reveals it afterwards.
export async function bootIntercom(options: { showLauncher: boolean }): Promise<void> {
  if (booted) return
  const appId = (__INTERCOM_APP_ID__ || '').trim()
  if (!appId) return
  booted = true

  let identity = null
  try {
    identity = await ipc.intercom.getIdentity()
  } catch {
    // Identity unavailable — boot anonymous rather than not at all.
  }

  window.intercomSettings = {
    api_base: INTERCOM_API_BASE,
    app_id: appId,
    hide_default_launcher: !options.showLauncher,
    ...(identity
      ? {
          user_id: identity.userId,
          ...(identity.email ? { email: identity.email } : {}),
          ...(identity.userHash ? { user_hash: identity.userHash } : {}),
          platform: identity.platform,
          version: identity.version,
          subscription_status: identity.subscriptionStatus,
          days_since_install: identity.daysSinceInstall,
          total_tracked_days: identity.totalTrackedDays,
        }
      : {}),
  }
  intercom()('boot', window.intercomSettings)
  injectWidgetScript(appId)
}

export function showIntercom(): void {
  intercom()('show')
}

// Custom events are targeting hooks for dashboard-authored tours and messages
// (e.g. the post-onboarding tooltip tour fires off `onboarding_completed`).
export function trackIntercomEvent(name: string, metadata?: Record<string, unknown>): void {
  intercom()('trackEvent', name, metadata)
}

export function setIntercomLauncherVisible(visible: boolean): void {
  intercom()('update', { hide_default_launcher: !visible })
}
