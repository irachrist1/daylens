import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { resolvePreloadPath } from '../src/main/lib/preloadPath.ts'

test('preload path supports Forge and standalone packaged layouts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-preload-path-'))
  try {
    const mainDir = path.join(root, 'dist', 'main')
    fs.mkdirSync(mainDir, { recursive: true })

    const forgePreload = path.join(mainDir, 'preload.js')
    fs.writeFileSync(forgePreload, '')
    assert.equal(resolvePreloadPath(mainDir), forgePreload)

    fs.rmSync(forgePreload)
    const packagedPreload = path.join(root, 'dist', 'preload.js')
    fs.writeFileSync(packagedPreload, '')
    assert.equal(resolvePreloadPath(mainDir), packagedPreload)

    fs.rmSync(packagedPreload)
    assert.throws(() => resolvePreloadPath(mainDir), /preload bundle is missing/i)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
