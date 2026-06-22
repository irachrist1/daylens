// Drives the REAL built MCP server subprocess (dist/mcp-server/index.cjs) over
// stdio JSON-RPC, exactly as Claude Desktop / Cursor would — with the exclusion
// env that src/main/services/mcpServer.ts hands it. Proves the excluded app and
// site are absent from a real MCP tool response on real captured data.
import { spawn } from 'node:child_process'

const [dbPath, date = '2026-06-21'] = process.argv.slice(2)
if (!dbPath) {
  console.error('usage: verify-mcp-subprocess.mjs <dbPath> [date]')
  process.exit(2)
}
const SERVER = 'dist/mcp-server/index.cjs'
// Production spawns the bundle under the Electron binary with ELECTRON_RUN_AS_NODE
// (see mcpServer.ts) so the better-sqlite3 native ABI matches. Mirror that here.
const ELECTRON = 'node_modules/.bin/electron'

function run(env) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ELECTRON, [SERVER], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DAYLENS_DB_PATH: dbPath, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    proc.stdout.on('data', (c) => { out += c })
    proc.stderr.on('data', (c) => { err += c })
    proc.on('error', reject)
    proc.on('exit', () => {
      const text = out
        .split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l) } catch { return null } })
        .filter(Boolean)
        .find((m) => m.id === 2)?.result?.content?.[0]?.text ?? ''
      if (!text && err) console.error('[stderr]', err.trim())
      resolve(text.toLowerCase())
    })

    const send = (obj) => proc.stdin.write(JSON.stringify(obj) + '\n')
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'verify', version: '1' } } })
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'getDaySummary', arguments: { date } } })
    setTimeout(() => { proc.stdin.end(); proc.kill('SIGTERM') }, 4000)
  })
}

function bounded(haystack, token) {
  return new RegExp(`(^|[^a-z0-9])${token}(?=$|[^a-z0-9])`, 'i').test(haystack)
}

const off = await run({ DAYLENS_TRACKING_CONTROLS_ENABLED: '0' })
const on = await run({
  DAYLENS_TRACKING_CONTROLS_ENABLED: '1',
  DAYLENS_TRACKING_EXCLUDED_APPS: JSON.stringify(['dia']),
  DAYLENS_TRACKING_EXCLUDED_SITES: JSON.stringify(['youtube.com']),
})

console.log(`\n=== REAL MCP subprocess boundary (${SERVER}) date=${date} ===`)
const checks = [
  ['MCP subprocess: app "dia" present when controls OFF', bounded(off, 'dia')],
  ['MCP subprocess: app "dia" ABSENT when excluded', !bounded(on, 'dia')],
  ['MCP subprocess: site "youtube" present when OFF', on.length > 0 && off.includes('youtube')],
  ['MCP subprocess: site "youtube" ABSENT when excluded', !on.includes('youtube')],
  ['MCP subprocess: returned a real payload', on.length > 100],
]
let pass = true
for (const [label, ok] of checks) {
  if (!ok) pass = false
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
}
console.log(`\n${pass ? 'MCP SUBPROCESS BOUNDARY PROVEN' : 'MCP SUBPROCESS CHECK FAILED'}\n`)
process.exit(pass ? 0 : 1)
