// The connector registry (DEV-186). One place that knows every connector the
// Connections wave brings: Google Calendar, Outlook Calendar, GitHub, Linear,
// Granola. This ticket ships the CONTRACT — proven end to end by the fake
// provider in the test suite — so every entry is manifest-only
// (`available: false`) until its adapter lands and calls
// registerConnectorAdapter. Settings lists them today with their real
// read-only scopes and what-it-brings copy; the page gains lifecycle
// affordances the day a provider becomes connectable.

import type { ConnectorId } from '@shared/types'
import type { ConnectorAdapter, ConnectorManifest } from './contract'

const HOUR = 60 * 60 * 1000

// Upcoming direct adapters: exact planned read-only scopes, honest copy.
const UPCOMING_MANIFESTS: ConnectorManifest[] = [
  {
    id: 'google_calendar',
    displayName: 'Google Calendar',
    providerKind: 'calendar',
    integration: 'direct',
    authKind: 'oauth',
    readOnly: true,
    scopes: [
      { scope: 'https://www.googleapis.com/auth/calendar.readonly', grants: 'Reads your calendars and events. Never creates, edits, or deletes anything.' },
    ],
    whatItBrings:
      'Your meetings as they actually happen — titles, times, attendees, and responses — kept in sync automatically. A scheduled event only becomes "you met" when your day\'s activity supports it.',
    sensitivity: 'standard',
    syncCadenceMs: HOUR,
    lookbackDays: 90,
    rateLimit: { maxRequestsPerMinute: 60, backoffBaseMs: 5_000, backoffMaxMs: HOUR },
    available: false,
  },
  {
    id: 'outlook_calendar',
    displayName: 'Outlook Calendar',
    providerKind: 'calendar',
    integration: 'direct',
    authKind: 'oauth',
    readOnly: true,
    scopes: [
      { scope: 'Calendars.Read', grants: 'Reads your Outlook calendars and events through Microsoft Graph. Read-only.' },
    ],
    whatItBrings:
      'Meetings from your Outlook or Microsoft 365 calendar — titles, times, attendees — synced automatically alongside everything Daylens observes locally.',
    sensitivity: 'standard',
    syncCadenceMs: HOUR,
    lookbackDays: 90,
    rateLimit: { maxRequestsPerMinute: 60, backoffBaseMs: 5_000, backoffMaxMs: HOUR },
    available: false,
  },
  {
    id: 'github',
    displayName: 'GitHub',
    providerKind: 'code',
    integration: 'direct',
    authKind: 'oauth',
    readOnly: true,
    scopes: [
      { scope: 'metadata:read', grants: 'Reads the names and identity of the repositories you choose. GitHub requires this for any repository access.' },
      { scope: 'contents:read', grants: 'Lists your commits — times and subject lines only. Daylens never ingests file contents, diffs, or bodies, and never pushes.' },
      { scope: 'pull_requests:read', grants: 'Reads pull requests and reviews you are involved in — titles, states, and who was involved. Never writes, comments, or merges.' },
      { scope: 'issues:read', grants: 'Reads issues you created or are assigned — titles and states. Never comments or edits.' },
    ],
    whatItBrings:
      'What you actually shipped — commits, pull requests, and reviews with their real repository identity, so "worked on the billing service" becomes a claim your history can back.',
    sensitivity: 'standard',
    syncCadenceMs: HOUR,
    lookbackDays: 90,
    rateLimit: { maxRequestsPerMinute: 60, backoffBaseMs: 10_000, backoffMaxMs: HOUR },
    available: false,
  },
  {
    id: 'linear',
    displayName: 'Linear',
    providerKind: 'issues',
    integration: 'direct',
    authKind: 'oauth',
    readOnly: true,
    scopes: [
      { scope: 'read', grants: 'Reads workspaces, teams, projects, cycles, and issues. Read-only.' },
    ],
    whatItBrings:
      'The issues and projects your work maps to — status changes, cycles, and relationships — so time spent connects to the tickets it moved.',
    sensitivity: 'standard',
    syncCadenceMs: 2 * HOUR,
    lookbackDays: 90,
    rateLimit: { maxRequestsPerMinute: 30, backoffBaseMs: 10_000, backoffMaxMs: HOUR },
    available: false,
  },
  {
    id: 'granola',
    displayName: 'Granola',
    providerKind: 'meetings',
    integration: 'direct',
    authKind: 'token',
    readOnly: true,
    scopes: [
      { scope: 'notes:read', grants: 'Reads meeting identity, participants, and your notes and summaries where your account permits. Daylens never records meeting audio.' },
    ],
    whatItBrings:
      'What happened IN your meetings — participants, notes, and action items from Granola — attached to the meetings your calendar and day already know about.',
    sensitivity: 'personal',
    syncCadenceMs: 2 * HOUR,
    lookbackDays: 90,
    rateLimit: { maxRequestsPerMinute: 30, backoffBaseMs: 10_000, backoffMaxMs: HOUR },
    available: false,
  },
]

const adapters = new Map<ConnectorId, ConnectorAdapter>()
const manifests = new Map<ConnectorId, ConnectorManifest>()
let seeded = false

/** A provider ticket calls this with its working adapter; the manifest flips
 *  to the adapter's own (available: true) and Settings gains the connector. */
export function registerConnectorAdapter(adapter: ConnectorAdapter): void {
  ensureRegistered() // registering one provider must never hide the others
  adapters.set(adapter.manifest.id, adapter)
  manifests.set(adapter.manifest.id, adapter.manifest)
}

function ensureRegistered(): void {
  if (seeded) return
  seeded = true
  for (const manifest of UPCOMING_MANIFESTS) {
    if (!manifests.has(manifest.id)) manifests.set(manifest.id, manifest)
  }
}

export function getConnectorAdapter(connectorId: ConnectorId): ConnectorAdapter | null {
  ensureRegistered()
  return adapters.get(connectorId) ?? null
}

export function getConnectorManifest(connectorId: ConnectorId): ConnectorManifest | null {
  ensureRegistered()
  return manifests.get(connectorId) ?? null
}

/** Every known connector, working adapters first, stable order inside each group. */
export function listConnectorManifests(): ConnectorManifest[] {
  ensureRegistered()
  return [...manifests.values()].sort((left, right) => {
    if (left.available !== right.available) return left.available ? -1 : 1
    return left.displayName.localeCompare(right.displayName)
  })
}
