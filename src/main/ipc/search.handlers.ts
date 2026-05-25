import { ipcMain } from 'electron'
import { getDb } from '../services/database'
import {
  searchAll,
  searchArtifacts,
  searchBlocks,
  searchBrowser,
  searchSessions,
  type SearchOptions,
} from '../db/queries'

const SEARCH_CHANNELS = {
  ALL: 'search:all',
  SESSIONS: 'search:sessions',
  BLOCKS: 'search:blocks',
  BROWSER: 'search:browser',
  ARTIFACTS: 'search:artifacts',
} as const

function normalizePayload(payload: { query?: string; opts?: SearchOptions } | string): {
  query: string
  opts: SearchOptions
} {
  if (typeof payload === 'string') {
    return { query: payload, opts: {} }
  }
  return {
    query: payload?.query ?? '',
    opts: payload?.opts ?? {},
  }
}

export function registerSearchHandlers(): void {
  ipcMain.handle(SEARCH_CHANNELS.ALL, (_event, payload: { query?: string; opts?: SearchOptions } | string) => {
    const { query, opts } = normalizePayload(payload)
    return searchAll(getDb(), query, opts)
  })

  ipcMain.handle(SEARCH_CHANNELS.SESSIONS, (_event, payload: { query?: string; opts?: SearchOptions } | string) => {
    const { query, opts } = normalizePayload(payload)
    return searchSessions(getDb(), query, opts)
  })

  ipcMain.handle(SEARCH_CHANNELS.BLOCKS, (_event, payload: { query?: string; opts?: SearchOptions } | string) => {
    const { query, opts } = normalizePayload(payload)
    return searchBlocks(getDb(), query, opts)
  })

  ipcMain.handle(SEARCH_CHANNELS.BROWSER, (_event, payload: { query?: string; opts?: SearchOptions } | string) => {
    const { query, opts } = normalizePayload(payload)
    return searchBrowser(getDb(), query, opts)
  })

  ipcMain.handle(SEARCH_CHANNELS.ARTIFACTS, (_event, payload: { query?: string; opts?: SearchOptions } | string) => {
    const { query, opts } = normalizePayload(payload)
    return searchArtifacts(getDb(), query, opts)
  })
}
