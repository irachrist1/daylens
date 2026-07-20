import { ipcMain } from 'electron'
import { getDb } from '../services/database'
import {
  searchArtifacts,
  searchBlocks,
  searchBrowser,
  searchSessions,
  type SearchOptions,
} from '../db/queries'
import { searchNatural } from '../services/naturalSearch'
import { searchExact } from '../services/exactSearch'
import { ensureDayMemoryIndexed } from '../services/memoryIndex'
import { localDateString } from '../lib/localDate'

const SEARCH_CHANNELS = {
  ALL: 'search:all',
  SESSIONS: 'search:sessions',
  BLOCKS: 'search:blocks',
  BROWSER: 'search:browser',
  ARTIFACTS: 'search:artifacts',
  NATURAL: 'search:natural',
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

function freshenLiveDayIndex(): void {
  try {
    ensureDayMemoryIndexed(getDb(), localDateString())
  } catch (error) {
    console.error('[search] live-day index refresh failed', error)
  }
}

export function registerSearchHandlers(): void {
  // DEV-178: the palette's shared query is the exact retrieval path —
  // entities (alias-aware) + corrected memory records + FTS, one ranked list.
  ipcMain.handle(SEARCH_CHANNELS.ALL, (_event, payload: { query?: string; opts?: SearchOptions } | string) => {
    const { query, opts } = normalizePayload(payload)
    return searchExact(getDb(), query, opts)
  })

  ipcMain.handle(SEARCH_CHANNELS.SESSIONS, (_event, payload: { query?: string; opts?: SearchOptions } | string) => {
    const { query, opts } = normalizePayload(payload)
    freshenLiveDayIndex()
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

  // S1: natural-language search (provider-interpreted terms over FTS).
  ipcMain.handle(SEARCH_CHANNELS.NATURAL, (_event, payload: { query?: string; opts?: SearchOptions } | string) => {
    const { query, opts } = normalizePayload(payload)
    return searchNatural(query, opts)
  })
}
