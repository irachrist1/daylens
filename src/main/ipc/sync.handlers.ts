import { ipcMain } from 'electron'
import { IPC } from '@shared/types'
import {
  createWorkspace,
  createBrowserLink,
  disconnect,
  getSyncStatus,
  getStoredMnemonic,
} from '../services/workspaceLinker'
import { getLastSyncAt, startSync, stopSync } from '../services/syncUploader'

export function registerSyncHandlers(): void {
  ipcMain.handle(IPC.SYNC.GET_STATUS, async () => {
    return getSyncStatus(getLastSyncAt())
  })

  ipcMain.handle(IPC.SYNC.LINK, async () => {
    const result = await createWorkspace()
    // Start syncing after linking
    startSync()
    return result
  })

  ipcMain.handle(IPC.SYNC.CREATE_BROWSER_LINK, async () => {
    return createBrowserLink()
  })

  ipcMain.handle(IPC.SYNC.DISCONNECT, async () => {
    stopSync()
    await disconnect()
    return { success: true }
  })

  ipcMain.handle(IPC.SYNC.GET_MNEMONIC, async () => {
    return getStoredMnemonic()
  })
}
