// One-off CDP driver to verify the calendar redesign in the running dev app.
// Usage: node scripts/calendar-verify.mjs
import WebSocket from 'ws'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const CDP_PORT = 9222
const OUT_DIR = process.env.OUT_DIR || path.join(process.cwd(), 'artifacts', 'calendar-verify')

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

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const targets = await fetchJson(`http://localhost:${CDP_PORT}/json/list`)
  const pageTarget = targets.find((t) => t.type === 'page')
  if (!pageTarget) { console.error('No page target'); process.exit(1) }
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject) })

  let nextId = 10
  const call = (method, params) => cdpCall(ws, method, params, nextId++)
  const evalJs = async (expression) => {
    const res = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails))
    return res.result?.value
  }
  const shot = async (name) => {
    const s = await call('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), Buffer.from(s.data, 'base64'))
    console.log('saved', name)
  }

  await call('Page.enable')
  await call('Runtime.enable')
  await sleep(1000)

  const nav = (hash) => evalJs(`location.hash = ${JSON.stringify(hash)}; 'ok'`)

  // Day view — July 1 (12 real blocks).
  await nav('#/timeline?view=day&date=2026-07-01')
  await sleep(2500)
  await shot('01-day-jul1')

  // Click the first block to open the inspector.
  const clicked = await evalJs(`(() => {
    const el = document.querySelector('[data-timeline-block-id]')
    if (!el) return 'no block found'
    el.click()
    return 'clicked ' + el.dataset.timelineBlockId
  })()`)
  console.log('block click:', clicked)
  await sleep(1200)
  await shot('02-day-block-selected')

  // Day view — today (live/provisional).
  await nav('#/timeline?view=day&date=2026-07-02')
  await sleep(2500)
  await shot('03-day-today')

  // Week view.
  await nav('#/timeline?view=week&date=2026-07-01')
  await sleep(3500)
  await shot('04-week')

  // Month view.
  await nav('#/timeline?view=month&date=2026-07-01')
  await sleep(3000)
  await shot('05-month')

  // Previous month for coverage.
  await nav('#/timeline?view=month&date=2026-06-01')
  await sleep(2500)
  await shot('06-month-june')

  // Console errors, if any.
  const errors = await evalJs(`window.__calendarVerifyErrors ?? 'n/a'`)
  console.log('page errors marker:', errors)

  console.log('Done. Screenshots in', OUT_DIR)
  ws.close()
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
