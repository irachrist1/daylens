// IPC for Settings → Connections (DEV-186). Thin — every behavior lives in
// src/main/connectors/service.ts. The renderer only ever sees the
// ConnectorListing projection: no credentials, no cursors, no config paths,
// no raw provider errors (spec: "The interface does not display raw tokens,
// internal cursors, or provider errors that reveal secrets").
import { app, dialog, ipcMain } from 'electron'
import { IPC } from '@shared/types'
import type { ConnectorId } from '@shared/types'
import { getDb } from '../services/database'
import {
  connectConnector,
  disconnectConnector,
  listConnectorListings,
  syncConnector,
} from '../connectors/service'

export function registerConnectorHandlers(): void {
  ipcMain.handle(IPC.CONNECTORS.LIST, () => {
    return listConnectorListings(getDb())
  })

  ipcMain.handle(IPC.CONNECTORS.CONNECT, async (
    _e,
    payload: { connectorId: ConnectorId; config?: Record<string, unknown> },
  ) => {
    const summary = await connectConnector(getDb(), payload.connectorId, payload.config ?? {})
    return { summary, connectors: listConnectorListings(getDb()) }
  })

  ipcMain.handle(IPC.CONNECTORS.DISCONNECT, async (
    _e,
    payload: { connectorId: ConnectorId; deleteData?: boolean },
  ) => {
    await disconnectConnector(getDb(), payload.connectorId, {
      deleteData: payload.deleteData === true,
      userDataPath: app.getPath('userData'),
    })
    return { connectors: listConnectorListings(getDb()) }
  })

  ipcMain.handle(IPC.CONNECTORS.SYNC_NOW, async (_e, payload: { connectorId: ConnectorId }) => {
    const summary = await syncConnector(getDb(), payload.connectorId)
    return { summary, connectors: listConnectorListings(getDb()) }
  })

  // The .ics picker runs in the MAIN process so the renderer never handles
  // filesystem paths it didn't choose through the OS dialog.
  ipcMain.handle(IPC.CONNECTORS.PICK_ICS_FILE, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose a calendar file',
      properties: ['openFile'],
      filters: [{ name: 'Calendar files', extensions: ['ics'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}
