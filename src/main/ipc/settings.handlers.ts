import { app, ipcMain } from 'electron'
import { ANALYTICS_EVENT, sanitizeSettingsChangedKeys } from '@shared/analytics'
import {
  getSettingsAsync,
  setSettings,
  hasApiKey,
  setApiKey,
  clearApiKey,
} from '../services/settings'
import { capture, updateAnalyticsPreference } from '../services/analytics'
import { syncLinuxLaunchOnLogin } from '../services/linuxDesktop'
import { validateProviderConnection } from '../services/providerValidation'
import { getMcpServerConfig, startMcpServer, stopMcpServer } from '../services/mcpServer'
import { IPC } from '@shared/types'
import type { AIProvider, AIProviderMode, AppSettings } from '@shared/types'
import { invalidateProjectionScope } from '../core/projections/invalidation'

export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC.SETTINGS.GET, async () => {
    return getSettingsAsync()
  })

  ipcMain.handle(IPC.SETTINGS.SET, async (_e, partial: Partial<AppSettings>) => {
    const previous = await getSettingsAsync()
    const rawChangedKeys = Object.keys(partial).filter((key) => (
      JSON.stringify(previous[key as keyof AppSettings]) !== JSON.stringify(partial[key as keyof AppSettings])
    ))
    const changedKeys = sanitizeSettingsChangedKeys(rawChangedKeys)

    await setSettings(partial)

    const analyticsWillEnable = !previous.analyticsOptIn && partial.analyticsOptIn === true
    const analyticsWillDisable = previous.analyticsOptIn && partial.analyticsOptIn === false

    if (analyticsWillEnable) {
      await updateAnalyticsPreference(true)
    }

    if ('launchOnLogin' in partial && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: Boolean(partial.launchOnLogin) })
      await syncLinuxLaunchOnLogin(Boolean(partial.launchOnLogin))
    }

    // Only reload Insights when an AI model/provider value actually changed —
    // not merely because the key was present in the saved partial (F42). Saving
    // unrelated settings no longer triggers a full Insights projection reload.
    const AI_INVALIDATING_KEYS = ['aiProvider', 'anthropicModel', 'openaiModel', 'googleModel']
    if (rawChangedKeys.some((key) => AI_INVALIDATING_KEYS.includes(key))) {
      invalidateProjectionScope('insights', 'ai_settings_changed')
    }

    if ('mcpServerEnabled' in partial) {
      if (partial.mcpServerEnabled) {
        startMcpServer()
      } else {
        stopMcpServer()
      }
    }

    if (changedKeys.length > 0) {
      capture(ANALYTICS_EVENT.SETTINGS_CHANGED, {
        settings_changed_keys: changedKeys,
        surface: 'settings',
        trigger: 'settings',
      })
    }

    if (analyticsWillDisable) {
      await updateAnalyticsPreference(false)
    }
  })

  ipcMain.handle(IPC.SETTINGS.HAS_API_KEY, async (_e, provider?: AIProviderMode) => {
    const resolvedProvider = provider ?? (await getSettingsAsync()).aiProvider ?? 'anthropic'
    return hasApiKey(resolvedProvider)
  })

  ipcMain.handle(IPC.SETTINGS.SET_API_KEY, async (_e, key: string, provider?: AIProviderMode) => {
    const resolvedProvider = provider ?? (await getSettingsAsync()).aiProvider ?? 'anthropic'
    if (key.trim()) {
      await setApiKey(resolvedProvider, key.trim())
    } else {
      await clearApiKey(resolvedProvider)
    }
    invalidateProjectionScope('insights', 'ai_credentials_changed')
  })

  ipcMain.handle(IPC.SETTINGS.CLEAR_API_KEY, async (_e, provider?: AIProviderMode) => {
    const resolvedProvider = provider ?? (await getSettingsAsync()).aiProvider ?? 'anthropic'
    await clearApiKey(resolvedProvider)
    invalidateProjectionScope('insights', 'ai_credentials_changed')
  })

  ipcMain.handle(IPC.SETTINGS.VALIDATE_API_KEY, async (_e, payload: { provider: AIProvider; key: string }) => {
    return validateProviderConnection(payload.provider, payload.key)
  })

  ipcMain.handle(IPC.MCP.GET_CONFIG, () => getMcpServerConfig())
}
