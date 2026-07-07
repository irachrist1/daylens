// Intercom Messenger (Fin). The renderer only ever handles public values — the
// App ID ships in the widget URL for every Intercom customer. Identity
// Verification's user_hash is HMAC-SHA256 of the user id with a secret that
// lives only in services/billing, so main fetches it from there and it arrives
// null until that secret is configured (the Messenger then boots unverified).
import { ipc } from './ipc'

declare const __INTERCOM_APP_ID__: string
declare const __INTERCOM_API_BASE__: string

// Region matters: a US app_id served against the wrong regional api_base (or vice
// versa) loads a blank Messenger with no error. US is the default; the build can
// override to EU (https://api-iam.eu.intercom.io) or AU
// (https://api-iam.au.intercom.io) via INTERCOM_API_BASE.
const INTERCOM_API_BASE = (typeof __INTERCOM_API_BASE__ === 'string' && __INTERCOM_API_BASE__.trim())
  || 'https://api-iam.intercom.io'
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
  script.onerror = () => {
    console.error('[intercom] widget script failed to load from', script.src)
  }
  document.head.appendChild(script)
}

let booted = false

// Boot once per app run, identified from main-process truth (device id, version,
// billing state, tracked-day counts). The floating launcher is always hidden:
// the Messenger is opened only from Settings → Help & support (showIntercom),
// never as an always-on bubble over the timeline.
export async function bootIntercom(): Promise<void> {
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

  // Identity Verification gate. If the workspace has IV enabled, booting an
  // identified user (user_id) WITHOUT a valid user_hash is rejected and the
  // Messenger renders blank. So we only send the identified payload once the
  // backend has returned a real user_hash (which needs the IV secret in
  // services/billing/.env); until then we boot as an anonymous visitor —
  // anonymous leads are never gated by IV, so the Messenger and Fin work now.
  const verified = Boolean(identity?.userHash)

  window.intercomSettings = {
    api_base: INTERCOM_API_BASE,
    app_id: appId,
    // No always-on bubble; the only entry point is the Settings button.
    hide_default_launcher: true,
    ...(verified && identity
      ? {
          user_id: identity.userId,
          user_hash: identity.userHash,
          ...(identity.email ? { email: identity.email } : {}),
          platform: identity.platform,
          version: identity.version,
          subscription_status: identity.subscriptionStatus,
          days_since_install: identity.daysSinceInstall,
          total_tracked_days: identity.totalTrackedDays,
        }
      : {}),
  }
  console.info('[intercom] booting', { appId, apiBase: INTERCOM_API_BASE, identified: verified })
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
