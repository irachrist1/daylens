import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import { getSettings } from './settings'

declare const __POSTHOG_KEY__: string
declare const __POSTHOG_HOST__: string

type PostHogClient = { capture: (args: object) => void; shutdown: () => Promise<void> }
let _posthog: PostHogClient | null = null

// Start with a temporary UUID; replaced with the persisted ID once the store loads
let distinctId: string = randomUUID()

// Load or create the persisted analytics ID (anonymous — never linked to name/email/API key)
void (async () => {
  try {
    const { default: Store } = await import('electron-store')
    const store = new Store() as { get: (k: string, d?: unknown) => unknown; set: (k: string, v: unknown) => void }
    let id = store.get('analyticsId', null) as string | null
    if (!id) {
      id = randomUUID()
      store.set('analyticsId', id)
    }
    distinctId = id
  } catch {
    // Keep the temp UUID if store fails
  }
})()

function getPosthog(): PostHogClient | null {
  if (!getSettings().analyticsOptIn) return null
  if (!__POSTHOG_KEY__) return null

  if (!_posthog) {
    try {
      // Dynamic require so PostHog is never instantiated unless opted in
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { PostHog } = require('posthog-node') as typeof import('posthog-node')
      _posthog = new PostHog(__POSTHOG_KEY__, {
        host: __POSTHOG_HOST__ || 'https://us.i.posthog.com',
        flushInterval: 30_000,
      }) as unknown as PostHogClient
    } catch {
      return null
    }
  }

  return _posthog
}

export function capture(event: string, properties?: Record<string, unknown>): void {
  try {
    const client = getPosthog()
    if (!client) return
    client.capture({
      distinctId,
      event,
      properties: {
        app_version: app.getVersion(),
        platform: process.platform,
        ...properties,
      },
    })
  } catch {
    // Never let analytics crash the app
  }
}

export function shutdown(): void {
  try {
    void _posthog?.shutdown()
  } catch {
    // Best-effort
  }
}
