import fs from 'node:fs'
import path from 'node:path'

export function resolvePreloadPath(mainBundleDirectory: string): string {
  const adjacent = path.join(mainBundleDirectory, 'preload.js')
  if (fs.existsSync(adjacent)) return adjacent

  const standalone = path.join(mainBundleDirectory, '..', 'preload.js')
  if (fs.existsSync(standalone)) return standalone

  throw new Error(
    `Daylens preload bundle is missing. Checked ${adjacent} and ${standalone}.`,
  )
}
