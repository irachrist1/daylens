// IPC for Settings → Connections (DEV-186 listing, DEV-188 lifecycle). The
// renderer sees the ConnectorListing projection and sanitized action
// summaries, nothing else — no credentials, no cursors, no config paths, no
// raw provider errors (spec: "The interface does not display raw tokens,
// internal cursors, or provider errors that reveal secrets").
import { app, ipcMain } from 'electron'
import { IPC, type ConnectorId } from '@shared/types'
import { containsCredential } from '@shared/credentialPatterns'
import { getDb } from '../services/database'
import {
  connectConnector,
  disconnectConnector,
  listConnectorListings,
  syncConnector,
} from '../connectors/service'

/** Belt and suspenders on the IPC boundary: a message that smells like a
 *  credential never crosses to the renderer. */
function sanitizedError(error: unknown): Error {
  const message = error instanceof Error ? error.message : 'The connector action failed.'
  return new Error(containsCredential(message)
    ? 'The connector action failed (details withheld: the error contained credential-shaped content).'
    : message)
}

export function registerConnectorHandlers(): void {
  ipcMain.handle(IPC.CONNECTORS.LIST, () => {
    return listConnectorListings(getDb())
  })

  ipcMain.handle(IPC.CONNECTORS.CONNECT, async (event, connectorId: ConnectorId, config: Record<string, unknown>) => {
    try {
      return await connectConnector(getDb(), connectorId, config ?? {}, {
        // Honest progress for the bounded initial import: the renderer shows
        // "waiting for your browser" vs "importing your history" truthfully.
        onProgress: (phase) => {
          try { event.sender.send(IPC.CONNECTORS.PROGRESS, { connectorId, phase }) } catch { /* window gone */ }
        },
      })
    } catch (error) {
      throw sanitizedError(error)
    }
  })

  ipcMain.handle(IPC.CONNECTORS.SYNC, async (_event, connectorId: ConnectorId) => {
    try {
      return await syncConnector(getDb(), connectorId)
    } catch (error) {
      throw sanitizedError(error)
    }
  })

  ipcMain.handle(IPC.CONNECTORS.DISCONNECT, async (_event, connectorId: ConnectorId, options: { deleteData?: boolean }) => {
    try {
      await disconnectConnector(getDb(), connectorId, {
        deleteData: options?.deleteData === true,
        userDataPath: app.getPath('userData'),
      })
    } catch (error) {
      throw sanitizedError(error)
    }
  })
}
