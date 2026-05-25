// Real-DB harness: copies the live Daylens DB to a temp directory and points
// Electron's userData path there before initDb() runs. The original DB is
// never opened by the harness — only the copy.
//
// Returns the absolute path to the copy so the runner can clean it up.

import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export interface RealDbContext {
  tempUserData: string
  copiedDbPath: string
  originalUserData: string
  originalDbPath: string
}

function defaultDaylensUserDataDir(): string {
  // app.getPath('userData') returns a sandboxed temp path under
  // ELECTRON_RUN_AS_NODE, so we resolve the real Daylens location by
  // platform instead of trusting that. The current Electron build's
  // productName resolves to "DaylensWindows" on macOS (legacy from the
  // Windows-launch branch); we probe known names and pick the one whose
  // sqlite file exists and has the expected v18+ snake_case schema.
  const home = os.homedir()
  const candidates: string[] = []
  if (process.platform === 'darwin') {
    candidates.push(
      path.join(home, 'Library', 'Application Support', 'DaylensWindows'),
      path.join(home, 'Library', 'Application Support', 'Daylens'),
    )
  } else if (process.platform === 'win32') {
    const roaming = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming')
    candidates.push(
      path.join(roaming, 'DaylensWindows'),
      path.join(roaming, 'Daylens'),
    )
  } else {
    const cfg = process.env.XDG_CONFIG_HOME ?? path.join(home, '.config')
    candidates.push(
      path.join(cfg, 'DaylensWindows'),
      path.join(cfg, 'Daylens'),
    )
  }
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'daylens.sqlite'))) return dir
  }
  return candidates[0]
}

export function stageReadOnlyCopyOfRealDb(): RealDbContext {
  const originalUserData = process.env.DAYLENS_REAL_USER_DATA ?? defaultDaylensUserDataDir()
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

  // Copy the main DB plus -wal / -shm sidecars if present, so any
  // un-checkpointed pages come along.
  fs.copyFileSync(originalDbPath, copiedDbPath)
  for (const sidecar of ['daylens.sqlite-wal', 'daylens.sqlite-shm']) {
    const src = path.join(originalUserData, sidecar)
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(tempUserData, sidecar))
    }
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
