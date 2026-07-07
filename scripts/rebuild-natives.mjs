// Rebuild native modules against the local Electron ABI after install.
// Uses @electron/rebuild's JS API instead of the CLI: the CLI does
// require('yargs/yargs'), and on Node >= 26 the CJS loader parses that
// extensionless shim inside yargs 17's "type: module" package as ESM,
// which crashes. CI workflows still call `npx electron-rebuild` on Node 20/22,
// where the CLI works.
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { rebuild } = require('@electron/rebuild')

const projectRoot = path.resolve(import.meta.dirname, '..')
const electronVersion = require('electron/package.json').version

await rebuild({
  buildPath: projectRoot,
  electronVersion,
  force: true,
  onlyModules: ['better-sqlite3', '@paymoapp/active-window', 'keytar'],
})

console.log(`Rebuilt native modules for Electron ${electronVersion}`)
