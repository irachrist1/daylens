import { app } from 'electron'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { chooseUserDataPath } from '../../src/main/services/userData'

export interface RealDbContext {
  tempUserData: string
  copiedDbPath: string
  originalUserData: string
  originalDbPath: string
}

interface StageRealDbOptions {
  settingsOverride?: Record<string, unknown>
}

function appDataPath(): string {
  const home = os.homedir()
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support')
  }
  if (process.platform === 'win32') {
    return process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming')
  }
  return process.env.XDG_CONFIG_HOME ?? path.join(home, '.config')
}

export async function stageReadOnlyCopyOfRealDb(options: StageRealDbOptions = {}): Promise<RealDbContext> {
  const originalUserData = process.env.DAYLENS_REAL_USER_DATA
    ?? chooseUserDataPath(appDataPath(), process.platform)
  const originalDbPath = path.join(originalUserData, 'daylens.sqlite')
  if (!fs.existsSync(originalDbPath)) {
    throw new Error(
      `[ai-behaviour] Real DB not found at ${originalDbPath}. ` +
      `Open Daylens at least once so it creates one, then re-run.`,
    )
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), `daylens-behaviour-${stamp}-`))
  const copiedDbPath = path.join(tempUserData, 'daylens.sqlite')

  let source: Database.Database | null = null
  try {
    source = new Database(originalDbPath, { readonly: true, fileMustExist: true })
    source.pragma('query_only = ON')
    await source.backup(copiedDbPath)
  } catch (error) {
    fs.rmSync(tempUserData, { recursive: true, force: true })
    throw error
  } finally {
    if (source?.open) {
      source.close()
    }
  }

  const configPath = path.join(originalUserData, 'config.json')
  if (fs.existsSync(configPath)) {
    fs.copyFileSync(configPath, path.join(tempUserData, 'config.json'))
  }
  if (options.settingsOverride) {
    const stagedConfigPath = path.join(tempUserData, 'config.json')
    let settings: Record<string, unknown> = {}
    try {
      settings = JSON.parse(fs.readFileSync(stagedConfigPath, 'utf8')) as Record<string, unknown>
    } catch {
      settings = {}
    }
    fs.writeFileSync(stagedConfigPath, JSON.stringify({ ...settings, ...options.settingsOverride }, null, 2))
  }

  // Reroute Electron's userData lookups for this process. The real-stub
  // exposes setPath('userData') which flips the internal override.
  app.setPath('userData', tempUserData)

  return { tempUserData, copiedDbPath, originalUserData, originalDbPath }
}

export function cleanupRealDbCopy(ctx: RealDbContext): void {
  try {
    fs.rmSync(ctx.tempUserData, { recursive: true, force: true })
  } catch {
    // Best-effort
  }
}
