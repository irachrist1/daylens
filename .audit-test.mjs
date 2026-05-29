// Drive Daylens via CDP, send three production questions, capture the answers.
// Reads ai_messages directly to confirm each answer landed.

import { WebSocket } from 'ws'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CDP_LIST = 'http://127.0.0.1:9222/json/list'
const DB_PATH = join(homedir(), 'Library/Application Support/DaylensWindows/daylens.sqlite')

function sqlite(sql) {
  const out = execFileSync('sqlite3', [DB_PATH, '-cmd', '.mode list', '-cmd', '.headers off', '-cmd', '.separator |', sql], { encoding: 'utf8' })
  return out
}

const QUESTIONS = [
  'What did I work on today?',
  'How long was I in Ghostty during Building?',
  'What did I learn about machine learning this week?',
]

async function getRendererTarget() {
  const res = await fetch(CDP_LIST)
  const tabs = await res.json()
  const page = tabs.find((t) => t.type === 'page' && t.url.includes('localhost:5173'))
  if (!page) throw new Error('No Daylens renderer target found')
  return page.webSocketDebuggerUrl
}

function cdp(ws) {
  let id = 0
  const pending = new Map()
  const handlers = new Map()
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString())
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
    } else if (msg.method && handlers.has(msg.method)) {
      handlers.get(msg.method)(msg.params)
    }
  })
  return {
    send(method, params = {}) {
      const reqId = ++id
      ws.send(JSON.stringify({ id: reqId, method, params }))
      return new Promise((resolve, reject) => pending.set(reqId, { resolve, reject }))
    },
    on(method, fn) { handlers.set(method, fn) },
  }
}

async function evalInPage(client, expr) {
  const res = await client.send('Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
  })
  if (res.exceptionDetails) {
    throw new Error(`CDP eval failed: ${JSON.stringify(res.exceptionDetails)}`)
  }
  return res.result.value
}

async function getLatestMessageId() {
  const out = sqlite('SELECT COALESCE(MAX(id), 0) FROM ai_messages').trim()
  return Number(out) || 0
}

async function waitForNewAssistantMessage(sinceId, timeoutMs = 120000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const out = sqlite(
      `SELECT id || '__SEP__' || thread_id || '__SEP__' || content FROM ai_messages WHERE id > ${sinceId} AND role='assistant' ORDER BY id DESC LIMIT 1`
    ).trim()
    if (out) {
      const [id, threadId, ...rest] = out.split('__SEP__')
      const content = rest.join('__SEP__')
      if (content && content.trim().length > 0) {
        return { id: Number(id), thread_id: Number(threadId), content }
      }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return null
}

async function sendQuestion(client, question) {
  // Force AI tab.
  await evalInPage(client, `window.location.hash = '#/ai'; null`)
  await new Promise((r) => setTimeout(r, 500))

  // Open a fresh thread so we don't follow up an existing one.
  await evalInPage(
    client,
    `(() => {
      const buttons = Array.from(document.querySelectorAll('button'))
      const newChat = buttons.find((b) => /new chat/i.test(b.title || b.getAttribute('title') || b.textContent || ''))
      if (newChat) newChat.click()
      return null
    })()`,
  )
  await new Promise((r) => setTimeout(r, 600))

  // Find the textarea and dispatch input + Enter.
  const ok = await evalInPage(
    client,
    `(() => {
      const textarea = document.querySelector('textarea')
      if (!textarea) return 'no-textarea'
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(textarea, ${JSON.stringify(question)})
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      textarea.focus()
      const ev = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
      textarea.dispatchEvent(ev)
      return 'sent'
    })()`,
  )
  if (ok !== 'sent') throw new Error('failed to send: ' + ok)
}

async function main() {
  const wsUrl = await getRendererTarget()
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  const client = cdp(ws)
  await client.send('Runtime.enable')
  await client.send('Page.enable')

  const results = []
  for (const q of QUESTIONS) {
    console.log(`\n===== Q: ${q} =====`)
    const sinceId = await getLatestMessageId()
    await sendQuestion(client, q)
    console.log(`  sent. waiting for answer (since msg id=${sinceId})...`)
    const reply = await waitForNewAssistantMessage(sinceId, 120000)
    if (!reply) {
      console.log('  TIMEOUT — no assistant response within 120s')
      results.push({ question: q, content: null })
    } else {
      console.log(`  got msg id=${reply.id} (thread=${reply.thread_id}, ${reply.content.length} chars)`)
      results.push({ question: q, threadId: reply.thread_id, content: reply.content })
    }
    await new Promise((r) => setTimeout(r, 2000))
  }

  ws.close()

  console.log('\n\n========== RESULTS ==========\n')
  for (const r of results) {
    console.log(`\n>>> ${r.question}\n`)
    console.log(r.content ?? '<no answer>')
    console.log('\n---')
  }
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
