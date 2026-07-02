// CDP verification for the timeline v8 work: clamped bounds, delete button,
// detail panel sections, tag chips, week/month views.
import WebSocket from 'ws'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const CDP_PORT = 9222
const OUT_DIR = process.env.OUT_DIR || path.join('/Users/tonny/Dev-Personal/daylens', 'artifacts', 'timeline-v8-verify')

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
  await sleep(800)

  const nav = (hash) => evalJs(`location.hash = ${JSON.stringify(hash)}; 'ok'`)

  // ── Day view: today (provisional live day, clamped to first activity → now)
  await nav('#/timeline?view=day&date=2026-07-02')
  await sleep(2500)
  const todayInfo = await evalJs(`(() => {
    const gutterLabels = [...document.querySelectorAll('div')].filter(el =>
      el.style.transform === 'translateY(-50%)').map(el => el.textContent)
    const blocks = [...document.querySelectorAll('[data-timeline-block-id]')].length
    return JSON.stringify({ firstHour: gutterLabels[0], lastHour: gutterLabels[gutterLabels.length-1], hourCount: gutterLabels.length, blocks })
  })()`)
  console.log('today:', todayInfo)
  await shot('01-day-today')

  // ── Day view: July 1 (persisted, real blocks)
  await nav('#/timeline?view=day&date=2026-07-01')
  await sleep(2500)
  const julyInfo = await evalJs(`(() => {
    const gutterLabels = [...document.querySelectorAll('div')].filter(el =>
      el.style.transform === 'translateY(-50%)').map(el => el.textContent)
    const blocks = [...document.querySelectorAll('[data-timeline-block-id]')].length
    const chips = [...document.querySelectorAll('button')].filter(b => /·\\s*\\d+$/.test(b.textContent.trim())).map(b => b.textContent.trim())
    return JSON.stringify({ firstHour: gutterLabels[0], lastHour: gutterLabels[gutterLabels.length-1], hourCount: gutterLabels.length, blocks, filterChips: chips })
  })()`)
  console.log('july1:', julyInfo)
  await shot('02-day-jul1')

  // Click the first block → inspector with tag chips, sections, Delete button.
  const clicked = await evalJs(`(() => {
    const el = document.querySelector('[data-timeline-block-id]')
    if (!el) return 'no block found'
    el.click()
    return 'clicked'
  })()`)
  console.log('block click:', clicked)
  await sleep(1200)
  const inspectorInfo = await evalJs(`(() => {
    const panel = document.querySelector('[data-timeline-inspector="true"]')
    if (!panel) return 'no inspector'
    const text = panel.textContent
    return JSON.stringify({
      hasDelete: /Delete/.test(text),
      hasRename: /Rename/.test(text),
      hasWhatYouWereIn: /What you were in/i.test(text),
      hasDetours: /Detours/.test(text),
      hasEvidenceOld: /EVIDENCE/i.test(text) && !/What you were in/i.test(text),
      hasSideTripsOld: /Side trips/i.test(text),
    })
  })()`)
  console.log('inspector:', inspectorInfo)
  await shot('03-day-jul1-inspector')

  // ── Week view (shared clamped hour scale)
  await nav('#/timeline?view=week&date=2026-07-01')
  await sleep(3000)
  await shot('04-week')

  // ── Month view
  await nav('#/timeline?view=month&date=2026-07-01')
  await sleep(2500)
  await shot('05-month')

  console.log('Done. Screenshots in', OUT_DIR)
  ws.close()
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
