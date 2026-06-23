import WebSocket from 'ws'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const CDP_PORT = 9222
const OUT_DIR = path.join(process.cwd(), 'artifacts', 'dev-105-shots')

const SECTION_GROUPS = [
  { items: [{ id: 'general', label: 'General' }, { id: 'notifications', label: 'Notifications' }, { id: 'billing', label: 'Billing' }, { id: 'usage', label: 'Usage' }] },
  { items: [{ id: 'ai', label: 'Provider & model' }, { id: 'memory', label: 'Memory' }] },
  { items: [{ id: 'labels', label: 'Labels' }, { id: 'clients', label: 'Clients' }, { id: 'privacy', label: 'Privacy & tracking' }] },
  { items: [{ id: 'mcp', label: 'MCP server' }, { id: 'capture', label: 'Capture health' }, { id: 'updates', label: 'Updates' }] },
]
const SECTION_LABELS = Object.fromEntries(SECTION_GROUPS.flatMap(g => g.items).map(s => [s.id, s.label]))

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => resolve(JSON.parse(data)))
    }).on('error', reject)
  })
}

function cdpCall(ws, method, params = {}, id = 1) {
  return new Promise((resolve, reject) => {
    const handler = (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.id === id) {
        ws.off('message', handler)
        if (msg.error) reject(new Error(JSON.stringify(msg.error)))
        else resolve(msg.result)
      }
    }
    ws.on('message', handler)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

function cdpEval(ws, expression, id) {
  return cdpCall(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: false,
    allowUnsafeEvalBlockingAgainstNoSandbox: true,
  }, id)
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const targets = await fetchJson(`http://localhost:${CDP_PORT}/json/list`)
  const pageTarget = targets.find((t) => t.type === 'page')
  if (!pageTarget) { console.error('No page target'); process.exit(1) }

  console.log('Connecting to:', pageTarget.webSocketDebuggerUrl)
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.on('open', resolve)
    ws.on('error', reject)
  })

  let nextId = 10
  const call = (method, params) => cdpCall(ws, method, params, nextId++)
  const eval_ = (expr) => cdpEval(ws, expr, nextId++)

  await call('Page.enable')
  await call('Runtime.enable')
  await sleep(1500)

  // Navigate to Settings — the app uses react-router, so we navigate via hash or click.
  // First, check what's on screen and navigate to settings.
  const navResult = await eval_(`
    (async () => {
      // Try clicking the Settings nav item
      const navItems = document.querySelectorAll('nav a, nav button, [data-nav]');
      let settingsEl = null;
      for (const el of navItems) {
        if (el.textContent && el.textContent.toLowerCase().includes('setting')) {
          settingsEl = el;
          break;
        }
      }
      if (settingsEl) {
        settingsEl.click();
        return 'clicked settings nav';
      }
      return 'no settings nav found, items: ' + Array.from(navItems).map(e => e.textContent).join('|');
    })()
  `)
  console.log('Nav result:', JSON.stringify(navResult.result?.value ?? navResult.result))
  await sleep(2500)

  // Wait for settings rail to appear
  const settingsCheck = await eval_(`document.querySelector('aside') ? 'rail found' : 'no rail'`)
  console.log('Settings check:', JSON.stringify(settingsCheck.result?.value ?? settingsCheck.result))

  // Screenshot each section by clicking the rail items
  const sections = [
    'general', 'notifications', 'billing', 'usage',
    'ai', 'memory',
    'labels', 'clients', 'privacy',
    'mcp', 'capture', 'updates',
  ]

  for (const section of sections) {
    // Click the rail item for this section
    const clickResult = await eval_(`
      (async () => {
        // Look for the settings rail and find items by data attribute or text
        const rail = document.querySelector('aside nav');
        if (!rail) return 'no rail';
        const buttons = rail.querySelectorAll('button');
        const labels = ${JSON.stringify(SECTION_LABELS)};
        for (const btn of buttons) {
          const text = btn.textContent.trim();
          // Match by label text (case-insensitive, trimmed)
          for (const [id, label] of Object.entries(labels)) {
            if (text.toLowerCase().includes(label.toLowerCase())) {
              if (id === '${section}') {
                btn.click();
                return 'clicked ' + id;
              }
            }
          }
        }
        return 'not found: ${section}';
      })()
    `)
    console.log(`Section ${section}:`, JSON.stringify(clickResult.result?.value ?? clickResult.result))
    await sleep(1200)

    // Capture screenshot
    const screenshot = await call('Page.captureScreenshot', { format: 'png' })
    const buf = Buffer.from(screenshot.data, 'base64')
    const outPath = path.join(OUT_DIR, `${section}.png`)
    fs.writeFileSync(outPath, buf)
    console.log(`  saved ${outPath} (${buf.length} bytes)`)
  }

  // Also capture the full rail view
  await sleep(500)
  const screenshot = await call('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(OUT_DIR, 'rail-final.png'), Buffer.from(screenshot.data, 'base64'))

  console.log('Done. Screenshots in', OUT_DIR)
  ws.close()
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
