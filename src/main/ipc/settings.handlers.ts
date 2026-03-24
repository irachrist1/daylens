import { ipcMain, app } from 'electron'
import {
  getSettings,
  setSettings,
  hasAnthropicApiKey,
  setAnthropicApiKey,
  clearAnthropicApiKey,
} from '../services/settings'
import { IPC } from '@shared/types'
import type { AppSettings } from '@shared/types'

export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC.SETTINGS.GET, () => {
    return getSettings()
  })

  ipcMain.handle(IPC.SETTINGS.SET, async (_e, partial: Partial<AppSettings>) => {
    await setSettings(partial)
    if ('launchOnLogin' in partial && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: partial.launchOnLogin as boolean })
    }
  })

  ipcMain.handle(IPC.SETTINGS.HAS_API_KEY, async () => {
    return hasAnthropicApiKey()
  })

  ipcMain.handle(IPC.SETTINGS.SET_API_KEY, async (_e, key: string) => {
    if (key.trim()) {
      await setAnthropicApiKey(key.trim())
    } else {
      await clearAnthropicApiKey()
    }
  })

  ipcMain.handle(IPC.SETTINGS.CLEAR_API_KEY, async () => {
    await clearAnthropicApiKey()
  })
}
