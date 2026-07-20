// IPC for Settings → Connections (DEV-186). Listing only in this slice: the
// renderer sees the ConnectorListing projection and nothing else — no
// credentials, no cursors, no config paths, no raw provider errors (spec:
// "The interface does not display raw tokens, internal cursors, or provider
// errors that reveal secrets"). Lifecycle channels (connect/disconnect/sync)
// arrive with the first connectable provider.
import { ipcMain } from 'electron'
import { IPC } from '@shared/types'
import { getDb } from '../services/database'
import { listConnectorListings } from '../connectors/service'

export function registerConnectorHandlers(): void {
  ipcMain.handle(IPC.CONNECTORS.LIST, () => {
    return listConnectorListings(getDb())
  })
}
