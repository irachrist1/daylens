import fs from 'node:fs'
import path from 'node:path'

export type RealDayExternalBoundary =
  | 'analytics'
  | 'billing'
  | 'credential-store'
  | 'icon'
  | 'intercom'
  | 'model-provider'
  | 'provider-validation'
  | 'updater'

export function isRealDayHarness(): boolean {
  return process.env.DAYLENS_REAL_DAY_HARNESS === '1'
}

export function isRealDayExternalAccessAllowed(boundary: RealDayExternalBoundary): boolean {
  if (!isRealDayHarness()) return true
  return boundary === 'model-provider' && process.env.DAYLENS_REAL_DAY_ALLOW_MODEL_NETWORK === '1'
}

export function assertRealDayExternalAccessAllowed(boundary: RealDayExternalBoundary): void {
  if (!isRealDayExternalAccessAllowed(boundary)) {
    throw new Error(`Real-day harness blocked external ${boundary} access.`)
  }
}

function canonicalPath(targetPath: string): string {
  let cursor = path.resolve(targetPath)
  const missingSegments: string[] = []

  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor)
    if (parent === cursor) break
    missingSegments.unshift(path.basename(cursor))
    cursor = parent
  }

  let resolved = cursor
  try {
    resolved = fs.realpathSync.native(cursor)
  } catch {
    // The resolved absolute path still gives a safe comparison if no ancestor exists.
  }
  return path.resolve(resolved, ...missingSegments)
}

function containsPath(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(parentPath, candidatePath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export function assertIsolatedRealDayUserData(
  devUserDataPath: string | undefined,
  liveUserDataPath: string,
): string {
  if (!isRealDayHarness()) return devUserDataPath?.trim() ?? ''

  const requestedPath = devUserDataPath?.trim()
  if (!requestedPath) {
    throw new Error('DAYLENS_REAL_DAY_HARNESS requires DAYLENS_DEV_USERDATA.')
  }

  const isolatedPath = canonicalPath(requestedPath)
  const livePath = canonicalPath(liveUserDataPath)
  if (containsPath(livePath, isolatedPath) || containsPath(isolatedPath, livePath)) {
    throw new Error(`DAYLENS_DEV_USERDATA must not overlap the live Daylens profile: ${livePath}`)
  }

  return isolatedPath
}
