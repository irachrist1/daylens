import { WebSocket } from 'ws'
const tabs = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = tabs.find((t) => t.type === 'page' && t.url.includes('index.html'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej) })
let id = 0; const pending = new Map()
ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) } })
const send = (method, params={}) => { const i=++id; ws.send(JSON.stringify({id:i,method,params})); return new Promise(r=>pending.set(i,r)) }
await send('Runtime.enable')
const ev = async (e) => (await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true})).result.value
await ev(`window.location.hash='#/ai'; null`)
await new Promise(r=>setTimeout(r,1500))
console.log(await ev(`JSON.stringify({
  hash: location.hash,
  inputs: document.querySelectorAll('input').length,
  searchInputs: document.querySelectorAll('input[type=search]').length,
  textareas: document.querySelectorAll('textarea').length,
  ariaSearch: !!document.querySelector('input[aria-label="Search local Daylens history"]'),
  bodyText: document.body.innerText.slice(0,200)
})`))
ws.close()
