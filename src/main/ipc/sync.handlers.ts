import { ipcMain } from 'electron'
import { IPC } from '@shared/types'

export function registerSyncHandlers(): void {
  ipcMain.handle(IPC.SYNC.GET_STATUS, async () => {
    return {
      isLinked: false,
      workspaceId: null,
      lastHeartbeatAt: null,
      lastSuccessfulSyncAt: null,
      state: 'local_only',
      lastFailureAt: null,
      lastFailureMessage: null,
    }
  })

  ipcMain.handle(IPC.SYNC.LINK, async () => {
    throw new Error('Sync is disabled in this offline private build.')
  })

  ipcMain.handle(IPC.SYNC.CREATE_BROWSER_LINK, async () => {
    throw new Error('Sync is disabled in this offline private build.')
  })

  ipcMain.handle(IPC.SYNC.DISCONNECT, async () => {
    return { success: true }
  })

  ipcMain.handle(IPC.SYNC.GET_MNEMONIC, async () => {
    return null
  })
}
