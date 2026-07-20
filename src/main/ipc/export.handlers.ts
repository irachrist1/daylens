// IPC for Settings → Export (DEV-196). The renderer sees plans, progress
// events, results, and verification reports — never a raw database row. The
// export itself is generated entirely locally by historyExport.ts; nothing
// here can reach the network, and it needs no model and no billing state.
import { app, dialog, ipcMain } from 'electron'
import { IPC } from '@shared/types'
import type { HistoryExportPlan, HistoryExportRunResult, HistoryExportVerification } from '@shared/types'
import { getDb } from '../services/database'
import { planHistoryExport, runHistoryExport, verifyHistoryExport } from '../services/historyExport'

export function registerExportHandlers(): void {
  ipcMain.handle(
    IPC.EXPORT.PLAN,
    (_event, payload: { includeHighSensitivity?: boolean } = {}): HistoryExportPlan => {
      return planHistoryExport(getDb(), { includeHighSensitivity: payload.includeHighSensitivity })
    },
  )

  ipcMain.handle(IPC.EXPORT.CHOOSE_DESTINATION, async (): Promise<{ canceled: boolean; dir?: string }> => {
    const result = await dialog.showOpenDialog({
      title: 'Choose where to save your Daylens export',
      buttonLabel: 'Export here',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return { canceled: true }
    return { canceled: false, dir: result.filePaths[0] }
  })

  ipcMain.handle(
    IPC.EXPORT.RUN,
    async (
      event,
      payload: { destinationDir: string; includeHighSensitivity?: boolean },
    ): Promise<HistoryExportRunResult> => {
      return runHistoryExport(getDb(), {
        destinationDir: payload.destinationDir,
        includeHighSensitivity: payload.includeHighSensitivity,
        appVersion: app.getVersion(),
        onProgress: (progress) => {
          if (!event.sender.isDestroyed()) event.sender.send(IPC.EXPORT.PROGRESS, progress)
        },
      })
    },
  )

  // Re-verify any previous export: the person picks the export folder, and we
  // re-check every checksum and row count against its manifest.
  ipcMain.handle(
    IPC.EXPORT.VERIFY,
    async (_event, payload: { exportDir?: string } = {}): Promise<
      { canceled: true } | { canceled: false; exportDir: string; verification: HistoryExportVerification }
    > => {
      let dir = payload.exportDir
      if (!dir) {
        const result = await dialog.showOpenDialog({
          title: 'Choose a Daylens export folder to verify',
          buttonLabel: 'Verify',
          properties: ['openDirectory'],
        })
        if (result.canceled || result.filePaths.length === 0) return { canceled: true }
        dir = result.filePaths[0]
      }
      return { canceled: false, exportDir: dir, verification: await verifyHistoryExport(dir) }
    },
  )
}
