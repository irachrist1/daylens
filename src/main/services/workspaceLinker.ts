export interface WorkspaceResult {
  workspaceId: string
  mnemonic: string
  linkCode: string
  linkToken: string
}

export interface BrowserLinkResult {
  displayCode: string
  fullToken: string
}

export interface SyncStatus {
  isLinked: boolean
  workspaceId: string | null
  lastHeartbeatAt: number | null
  lastSuccessfulSyncAt: number | null
  state: 'local_only' | 'linked' | 'pending_first_sync' | 'healthy' | 'stale' | 'failed'
  lastFailureAt?: number | null
  lastFailureMessage?: string | null
}

export interface SyncRuntimeState {
  lastHeartbeatAt: number | null
  lastSuccessfulDaySyncAt: number | null
  lastHeartbeatFailureAt: number | null
  lastHeartbeatFailureMessage: string | null
  lastDaySyncFailureAt: number | null
  lastDaySyncFailureMessage: string | null
  hasCompletedInitialDaySync: boolean
}

export async function createWorkspace(): Promise<WorkspaceResult> {
  throw new Error('Remote sync is disabled in this offline build.')
}

export async function createBrowserLink(): Promise<BrowserLinkResult> {
  throw new Error('Browser sync is disabled in this offline build.')
}

export async function recoverWorkspace(_mnemonic: string): Promise<string> {
  throw new Error('Remote recovery is disabled in this offline build.')
}

export async function repairStoredWorkspaceSession(): Promise<boolean> {
  return false
}

export async function disconnect(): Promise<void> {
  // no-op
}

export async function getSyncStatus(_runtime?: SyncRuntimeState): Promise<SyncStatus> {
  return {
    isLinked: false,
    workspaceId: null,
    lastHeartbeatAt: null,
    lastSuccessfulSyncAt: null,
    state: 'local_only',
    lastFailureAt: null,
    lastFailureMessage: null,
  }
}

export async function getStoredMnemonic(): Promise<string | null> {
  return null
}

export function getConvexSiteUrl(): string {
  return ''
}

export async function getSessionToken(): Promise<string | null> {
  return null
}
