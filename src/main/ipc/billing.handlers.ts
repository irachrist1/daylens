import fs from 'node:fs/promises'
import { dialog, ipcMain, shell } from 'electron'
import { IPC } from '@shared/types'
import {
  createFlutterwaveCheckout,
  createPolarCheckout,
  getBillingAccess,
  getBillingPortalUrl,
  getBillingUsage,
  invalidateBillingAccess,
} from '../services/billing'

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function registerBillingHandlers(): void {
  ipcMain.handle(IPC.BILLING.GET_ACCESS, () => getBillingAccess())
  ipcMain.handle(IPC.BILLING.REFRESH, () => {
    invalidateBillingAccess()
    return getBillingAccess({ force: true })
  })
  ipcMain.handle(IPC.BILLING.GET_USAGE, (_event, payload: { from: number; to: number }) => (
    getBillingUsage(payload.from, payload.to)
  ))
  ipcMain.handle(IPC.BILLING.CREATE_POLAR_CHECKOUT, async () => {
    await shell.openExternal(await createPolarCheckout())
    return true
  })
  ipcMain.handle(IPC.BILLING.CREATE_FLUTTERWAVE_CHECKOUT, async (_event, payload: { email: string }) => {
    await shell.openExternal(await createFlutterwaveCheckout(payload.email))
    return true
  })
  ipcMain.handle(IPC.BILLING.OPEN_PORTAL, async () => {
    await shell.openExternal(await getBillingPortalUrl())
    return true
  })
  ipcMain.handle(IPC.BILLING.EXPORT_USAGE_CSV, async (_event, payload: { from: number; to: number }) => {
    const report = await getBillingUsage(payload.from, payload.to)
    const result = await dialog.showSaveDialog({
      title: 'Export AI usage',
      defaultPath: `daylens-ai-usage-${new Date(payload.from).toISOString().slice(0, 10)}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    const lines = [
      ['Date', 'Type', 'Feature', 'Screen', 'Trigger', 'Provider', 'Model', 'Input tokens', 'Output tokens', 'Cache read tokens', 'Cache write tokens', 'Total tokens', 'Cost USD', 'Success'],
      ...report.rows.map((row) => [
        new Date(row.occurredAt).toISOString(),
        row.type,
        row.feature,
        row.screen ?? '',
        row.triggerSource ?? '',
        row.provider ?? '',
        row.model ?? '',
        row.inputTokens ?? '',
        row.outputTokens ?? '',
        row.cacheReadTokens ?? '',
        row.cacheWriteTokens ?? '',
        row.tokens ?? '',
        row.costUsd ?? '',
        row.success ? 'yes' : 'no',
      ]),
    ]
    await fs.writeFile(result.filePath, lines.map((line) => line.map(csvCell).join(',')).join('\n'), 'utf8')
    return { canceled: false, path: result.filePath }
  })
}
