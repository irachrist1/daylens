import WebSocket from 'ws'
import http from 'node:http'
const expr = process.argv[2]
const targets = await new Promise((res, rej) => { http.get('http://localhost:9222/json/list', r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))) }).on('error', rej) })
const t = targets.find(t => t.type === 'page')
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })
const result = await new Promise((res, rej) => {
  ws.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.id === 1) { if (m.error) rej(new Error(JSON.stringify(m.error))); else res(m.result) } })
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }))
})
console.log(JSON.stringify(result.result?.value ?? result, null, 2))
ws.close()
