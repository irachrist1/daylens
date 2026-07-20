// IPC for the Settings → Memory entity browser (DEV-177) and the
// Settings → Agent file access surface (DEV-184). Same handler patterns as
// db.handlers.ts: thin, synchronous where possible, everything reads/writes
// through the services.
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC } from '@shared/types'
import { getDb } from '../services/database'
import {
  getEntityDetail,
  listEntities,
  listSuggestedEntityMerges,
  type EntityType,
} from '../services/entities/entityRepository'
import { resolveEntityTimelineBlockRefs } from '../services/entities/blockRefRemap'
import { mergeGroupIds } from '../services/entities/entityRepository'
import {
  applyEntityCorrection,
  previewEntityCorrection,
  type EntityCorrectionCommand,
} from '../services/entities/entityCorrections'
import { undoCorrection } from '../services/correctionCommands'
import { createProject } from '../core/query/attributionResolvers'
import {
  addFileAccessGrant,
  listFileAccessGrants,
  listFileDisclosures,
  revokeFileAccessGrant,
  type FileAccessState,
} from '../services/fileAccess'

export function registerEntityHandlers(): void {
  ipcMain.handle(IPC.ENTITIES.LIST, (
    _e,
    payload: { type?: EntityType | null; search?: string | null; limit?: number } = {},
  ) => {
    return listEntities(getDb(), payload)
  })

  ipcMain.handle(IPC.ENTITIES.DETAIL, (_e, entityId: string) => {
    const db = getDb()
    const detail = getEntityDetail(db, entityId)
    if (!detail) return null
    const groupIds = mergeGroupIds(db, detail.id)
    const blockRefs = resolveEntityTimelineBlockRefs(db, groupIds)
    return { ...detail, blockRefs }
  })

  ipcMain.handle(IPC.ENTITIES.SUGGESTED_MERGES, () => {
    return listSuggestedEntityMerges(getDb())
  })

  ipcMain.handle(IPC.ENTITIES.PREVIEW_CORRECTION, (_e, command: EntityCorrectionCommand) => {
    return previewEntityCorrection(getDb(), command)
  })

  ipcMain.handle(IPC.ENTITIES.APPLY_CORRECTION, (_e, command: EntityCorrectionCommand) => {
    return applyEntityCorrection(getDb(), command)
  })

  ipcMain.handle(IPC.ENTITIES.UNDO_CORRECTION, (_e, correctionId: string) => {
    return undoCorrection(getDb(), correctionId)
  })

  ipcMain.handle(IPC.ENTITIES.CREATE_PROJECT, (
    _e,
    payload: { name: string; clientId?: string | null; color?: string | null },
  ) => {
    return createProject(payload, getDb())
  })

  ipcMain.handle(IPC.FILE_ACCESS.LIST_GRANTS, (_e, payload: { includeRevoked?: boolean } = {}) => {
    return listFileAccessGrants(getDb(), payload)
  })

  ipcMain.handle(IPC.FILE_ACCESS.ADD_GRANT, (
    _e,
    payload: { scopeKind: 'file' | 'folder'; path: string; state: FileAccessState; allowHighSensitivity?: boolean },
  ) => {
    return addFileAccessGrant(getDb(), { ...payload, source: 'settings' })
  })

  ipcMain.handle(IPC.FILE_ACCESS.REVOKE_GRANT, (_e, grantId: string) => {
    return revokeFileAccessGrant(getDb(), grantId)
  })

  ipcMain.handle(IPC.FILE_ACCESS.LIST_DISCLOSURES, (_e, payload: { limit?: number } = {}) => {
    return listFileDisclosures(getDb(), payload)
  })

  ipcMain.handle(IPC.FILE_ACCESS.PICK_PATH, async (
    event,
    payload: { scopeKind?: 'file' | 'folder' } = {},
  ): Promise<{ path: string; scopeKind: 'file' | 'folder' } | null> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const scopeKind = payload.scopeKind === 'file' ? 'file' : 'folder'
    const options = {
      properties: (scopeKind === 'folder'
        ? ['openDirectory', 'createDirectory']
        : ['openFile']) as Array<'openDirectory' | 'createDirectory' | 'openFile'>,
      title: scopeKind === 'folder' ? 'Choose a folder for the AI' : 'Choose a file for the AI',
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    const chosen = result.filePaths[0]
    if (!chosen) return null
    return { path: chosen, scopeKind }
  })
}
