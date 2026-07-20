// Connector credential storage (connectors.md §Authorization, DEV-186).
//
// Tokens live in the operating-system secure store — the SAME vault and
// service name the AI provider keys already use (services/settings.ts) — and
// NOWHERE else: never SQLite, never electron-store, never logs, analytics,
// model context, export, MCP, or sync payloads. The only thing any other
// module may learn about a stored credential is whether one exists.
//
// The store is injectable so the hermetic test suite can prove the lifecycle
// (set → present → clear → absent) and the hygiene rule (nothing readable
// about a connection ever contains the secret) without an OS keychain.

import type { ConnectorId } from '@shared/types'
import { ensureSecureStore, getSecureStore } from '../services/secureStore'

const KEYTAR_SERVICE = 'Daylens Desktop'

export interface ConnectorSecretStore {
  getPassword(service: string, account: string): Promise<string | null>
  setPassword(service: string, account: string, password: string): Promise<void>
  deletePassword(service: string, account: string): Promise<boolean>
}

export function connectorSecretAccount(connectorId: ConnectorId): string {
  return `connector-${connectorId}-token`
}

export async function setConnectorSecret(
  connectorId: ConnectorId,
  secret: string,
  store: ConnectorSecretStore | null = null,
): Promise<void> {
  const vault = store ?? ensureSecureStore(`Saving the ${connectorId} connection credential`)
  await vault.setPassword(KEYTAR_SERVICE, connectorSecretAccount(connectorId), secret)
}

export async function getConnectorSecret(
  connectorId: ConnectorId,
  store: ConnectorSecretStore | null = null,
): Promise<string | null> {
  try {
    const vault = store ?? getSecureStore()
    if (!vault) return null
    return await vault.getPassword(KEYTAR_SERVICE, connectorSecretAccount(connectorId))
  } catch {
    return null
  }
}

export async function hasConnectorSecret(
  connectorId: ConnectorId,
  store: ConnectorSecretStore | null = null,
): Promise<boolean> {
  return (await getConnectorSecret(connectorId, store)) != null
}

/** Disconnect step 2 (connectors.md §Disconnection): delete the stored
 *  credential. Best-effort — a missing vault or absent key is not an error. */
export async function clearConnectorSecret(
  connectorId: ConnectorId,
  store: ConnectorSecretStore | null = null,
): Promise<void> {
  try {
    const vault = store ?? getSecureStore()
    if (!vault) return
    await vault.deletePassword(KEYTAR_SERVICE, connectorSecretAccount(connectorId))
  } catch {
    // The key may not exist — fine; disconnect proceeds.
  }
}
