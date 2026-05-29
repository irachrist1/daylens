import { WebSocket } from 'ws'

const CDP_LIST = 'http://127.0.0.1:9222/json/list'

async function getTarget() {
  const tabs = await (await fetch(CDP_LIST)).json()
  const page = tabs.find((t) => t.type === 'page' && t.url.includes('index.html'))
  if (!page) throw new Error('no renderer target')
  return page.webSocketDebuggerUrl
}

function cdp(ws) {
  let id = 0
  const pending = new Map()
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString())
    if (m.id != null && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id); pending.delete(m.id)
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
    }
  })
  return {
    send: (method, params = {}) => {
      const reqId = ++id
      ws.send(JSON.stringify({ id: reqId, method, params }))
      return new Promise((res, rej) => pending.set(reqId, { resolve: res, reject: rej }))
    },
  }
}

async function evalIn(c, expr) {
  const r = await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
  return r.result.value
}

const ws = new WebSocket(await getTarget())
await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej) })
const c = cdp(ws)
await c.send('Runtime.enable')

await evalIn(c, `window.location.hash = '#/ai'; null`)
await new Promise((r) => setTimeout(r, 1200))

const result = await evalIn(c, `(() => {
  const input = document.querySelector('input[type="search"][aria-label="Search local Daylens history"]')
  if (!input) return { found: false }
  // Walk up to the order:1 sticky wrapper (the div we made sticky).
  let el = input
  for (let i = 0; i < 6 && el; i++) {
    const cs = getComputedStyle(el)
    if (cs.position === 'sticky') {
      const scroller = el.closest('div[style*="overflow"]') || el.parentElement
      return {
        found: true,
        position: cs.position,
        top: cs.top,
        zIndex: cs.zIndex,
        background: cs.backgroundColor,
        tag: el.tagName,
      }
    }
    el = el.parentElement
  }
  return { found: true, position: 'NOT-STICKY', searched: 6 }
})()`)

console.log('C14 sticky-header check:', JSON.stringify(result, null, 2))
ws.close()
