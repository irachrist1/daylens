import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import WebSocket from 'ws'

function argument(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`)
}

function fail(message) {
  throw new Error(`[real-day desktop] ${message}`)
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function availablePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') return reject(new Error('No TCP port'))
      server.close(() => resolve(address.port))
    })
  })
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let body = ''
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => {
        try {
          resolve(JSON.parse(body))
        } catch (error) {
          reject(error)
        }
      })
    })
    request.once('error', reject)
    request.setTimeout(2_000, () => request.destroy(new Error('CDP request timed out')))
  })
}

async function pageTarget(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const targets = await getJson(`http://127.0.0.1:${port}/json/list`)
      const page = targets.find((target) => target.type === 'page')
      if (page?.webSocketDebuggerUrl) return page
    } catch (error) {
      lastError = error
    }
    await wait(250)
  }
  throw new Error(`No Electron renderer CDP target after ${timeoutMs}ms: ${lastError ?? 'unknown error'}`)
}

class Cdp {
  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString())
      if (!message.id) return
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)))
      else pending.resolve(message.result)
    })
  }

  call(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression) {
    const response = await this.call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    })
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description ?? JSON.stringify(response.exceptionDetails))
    }
    return response.result?.value
  }

  close() {
    this.socket.close()
  }
}

async function connect(port) {
  const target = await pageTarget(port)
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  const cdp = new Cdp(socket)
  await cdp.call('Runtime.enable')
  await cdp.call('Page.enable')
  return cdp
}

async function waitFor(cdp, expression, description, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    last = await cdp.evaluate(expression)
    if (last) return last
    await wait(200)
  }
  throw new Error(`Timed out waiting for ${description}; last value: ${JSON.stringify(last)}`)
}

async function navigate(cdp, hash, readyExpression, description) {
  await cdp.evaluate(`location.hash = ${JSON.stringify(hash)}; true`)
  return waitFor(cdp, readyExpression, description)
}

const rendererHelpers = String.raw`
  const setValue = (node, value) => {
    const proto = node instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, node instanceof HTMLInputElement ? 'value' : 'textContent')?.set
    if (setter) setter.call(node, value)
    else if (node instanceof HTMLInputElement) node.value = value
    else node.textContent = value
    node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }))
    node.dispatchEvent(new Event('change', { bubbles: true }))
  }
`

async function timelineObservation(cdp, date) {
  await navigate(
    cdp,
    `#/timeline?view=day&date=${date}`,
    `document.querySelector('[data-timeline-block-id]') !== null`,
    `Timeline blocks for ${date}`,
  )
  const result = await cdp.evaluate(`(async () => {
    const payload = await window.daylens.db.getTimelineDay(${JSON.stringify(date)})
    const domBlocks = [...document.querySelectorAll('[data-timeline-block-id]')]
    return {
      route: location.hash,
      domBlockCount: domBlocks.length,
      ipcBlockCount: payload.blocks.length,
      totalTrackedSeconds: payload.totalTrackedSeconds,
      totalFocusedSeconds: payload.totalFocusedSeconds,
      labels: payload.blocks.map((block) => block.label.current),
      blockIds: payload.blocks.map((block) => block.id),
      visibleText: document.body.innerText.slice(0, 12000),
    }
  })()`)
  assert.equal(result.route, `#/timeline?view=day&date=${date}`)
  assert.equal(
    result.domBlockCount,
    result.ipcBlockCount,
    `Timeline rendered ${result.domBlockCount} blocks but production IPC returned ${result.ipcBlockCount}`,
  )
  assert.ok(result.domBlockCount > 0, `Timeline rendered no blocks for ${date}`)

  await cdp.evaluate(`document.querySelector('[data-timeline-block-id]')?.click(); true`)
  await waitFor(cdp, `document.querySelector('[data-timeline-inspector="true"]') !== null`, 'block detail')
  result.firstBlockDetail = await cdp.evaluate(`(() => {
    const dialog = document.querySelector('[data-timeline-inspector="true"]')
    return {
      text: dialog.innerText.slice(0, 5000),
    }
  })()`)
  return result
}

async function openEditor(cdp, blockIndex) {
  await cdp.evaluate(`(() => {
    const block = document.querySelectorAll('[data-timeline-block-id]')[${blockIndex}]
    if (!block) return false
    const rect = block.getBoundingClientRect()
    block.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + Math.min(20, rect.width / 2),
      clientY: rect.top + Math.min(20, rect.height / 2),
    }))
    return true
  })()`)
  await waitFor(cdp, `document.querySelector('[role="menu"]') !== null`, 'Timeline block context menu')
  await cdp.evaluate(`(() => {
    const edit = [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent.trim() === 'Edit')
    edit?.click()
    return Boolean(edit)
  })()`)
  await waitFor(cdp, `document.querySelector('[role="dialog"][aria-label="Edit block"]') !== null`, 'block editor')
}

async function appsObservation(cdp, date) {
  await navigate(cdp, '#/apps', `document.querySelector('[aria-label="Previous period"]') !== null`, 'Apps day view')
  const current = await cdp.evaluate(`new Date().toLocaleDateString('en-CA')`)
  const daysBack = Math.round((Date.parse(`${current}T12:00:00`) - Date.parse(`${date}T12:00:00`)) / 86400000)
  if (daysBack < 0 || daysBack > 90) fail(`Apps replay date ${date} is ${daysBack} days from ${current}`)
  for (let index = 0; index < daysBack; index += 1) {
    await cdp.evaluate(`document.querySelector('[aria-label="Previous period"]')?.click(); true`)
    await wait(120)
  }
  const result = await waitFor(
    cdp,
    `(async () => {
      const rows = await window.daylens.db.getAppSummariesForDate(${JSON.stringify(date)})
      if (!rows.length) return null
      return {
        route: location.hash,
        ipcCount: rows.length,
        totalSeconds: rows.reduce((sum, row) => sum + row.totalSeconds, 0),
        apps: rows.map((row) => ({ name: row.appName, seconds: row.totalSeconds })),
        visibleText: document.body.innerText.slice(0, 12000),
      }
    })()`,
    `Apps rows for ${date}`,
  )
  for (const app of result.apps.slice(0, 5)) {
    assert.match(result.visibleText, new RegExp(app.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))
  }
  return result
}

async function searchObservation(cdp, query) {
  await cdp.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', metaKey: true, bubbles: true })); true`)
  await waitFor(cdp, `document.querySelector('[aria-label="Search Daylens or run a command"]') !== null`, 'command palette')
  await cdp.evaluate(`(() => {
    ${rendererHelpers}
    const input = document.querySelector('[aria-label="Search Daylens or run a command"]')
    setValue(input, ${JSON.stringify(query)})
    return true
  })()`)
  await wait(900)
  const result = await cdp.evaluate(`(() => {
    const palette = document.querySelector('[role="dialog"][aria-label="Daylens command palette"]')
    return { query: ${JSON.stringify(query)}, text: palette?.innerText.slice(0, 8000) ?? '', optionCount: palette?.querySelectorAll('[role="option"]').length ?? 0 }
  })()`)
  assert.ok(result.text.length > 0, `Search returned no visible output for ${query}`)
  await cdp.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); true`)
  return result
}

async function correctionAndDeletion(cdp, date) {
  const correctionLabel = 'Real-day replay correction'
  await navigate(cdp, `#/timeline?view=day&date=${date}`, `document.querySelectorAll('[data-timeline-block-id]').length >= 2`, 'two Timeline blocks for mutation checks')
  const before = await cdp.evaluate(`window.daylens.db.getTimelineDay(${JSON.stringify(date)})`)
  const correctedId = before.blocks[0].id
  const deletedId = before.blocks[1].id

  await openEditor(cdp, 0)
  await cdp.evaluate(`(() => {
    ${rendererHelpers}
    setValue(document.querySelector('[aria-label="Block title"]'), ${JSON.stringify(correctionLabel)})
    const save = [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Save')
    save?.click()
    return true
  })()`)
  await waitFor(cdp, `document.querySelector('[role="dialog"][aria-label="Edit block"]') === null`, 'saved correction')
  const corrected = await cdp.evaluate(`window.daylens.db.getTimelineDay(${JSON.stringify(date)})`)
  assert.equal(corrected.blocks.find((block) => block.id === correctedId)?.label.current, correctionLabel)

  await openEditor(cdp, 1)
  await cdp.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent.trim() === 'Delete block')
    button?.click()
    return true
  })()`)
  await waitFor(cdp, `document.querySelector('[role="dialog"][aria-label="Edit block"]') === null`, 'deleted block')
  const deleted = await cdp.evaluate(`window.daylens.db.getTimelineDay(${JSON.stringify(date)})`)
  assert.ok(!deleted.blocks.some((block) => block.id === deletedId), `Deleted block ${deletedId} resurfaced`)
  assert.ok(deleted.blocks.some((block) => block.label.current === correctionLabel), 'Correction disappeared after deletion rebuild')
  return {
    correctionLabel,
    correctedId,
    deletedId,
    blocksBefore: before.blocks.length,
    blocksAfter: deleted.blocks.length,
    trackedSecondsBefore: before.totalTrackedSeconds,
    trackedSecondsAfter: deleted.totalTrackedSeconds,
  }
}

async function aiObservation(cdp, date) {
  const question = `Give me a concise, source-grounded reconstruction of ${date}. State tracked time, major apps, meetings, and any uncertainty or cross-surface disagreement.`
  await navigate(cdp, '#/ai', `document.querySelector('[aria-label="Ask Daylens about your work history"]') !== null`, 'AI composer')
  await cdp.evaluate(`(() => {
    ${rendererHelpers}
    const editor = document.querySelector('[aria-label="Ask Daylens about your work history"]')
    setValue(editor, ${JSON.stringify(question)})
    const send = document.querySelector('[aria-label="Send message"]')
    send?.click()
    return true
  })()`)
  await waitFor(
    cdp,
    `(() => !document.querySelector('[aria-label="Stop generating"]') && document.body.innerText.includes(${JSON.stringify(date)}))()`,
    'complete AI response',
    180_000,
  )
  const result = await cdp.evaluate(`(() => {
    const main = document.querySelector('main')
    return { question: ${JSON.stringify(question)}, visibleText: main?.innerText.slice(-20000) ?? '' }
  })()`)
  assert.match(result.visibleText, new RegExp(date.replaceAll('-', '.')))
  return result
}

async function main() {
  if (process.env.CI) fail('real-day desktop replay is local-only and refuses CI')
  const date = argument('date')
  const userData = argument('user-data')
  const output = argument('output', userData ? path.join(path.dirname(userData), 'desktop-observation.json') : null)
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('pass --date YYYY-MM-DD')
  if (!userData || !path.isAbsolute(userData)) fail('pass an absolute --user-data path containing an isolated database copy')
  if (!fs.existsSync(path.join(userData, 'daylens.sqlite'))) fail(`${userData} has no daylens.sqlite`)
  if (!output || !path.isAbsolute(output)) fail('pass an absolute --output path')
  if (hasFlag('screenshots')) fail('screenshots are not part of this command; use a separately approved capture command')

  const port = await availablePort()
  const defaultElectron = process.platform === 'darwin'
    ? path.join(process.cwd(), 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    : path.join(process.cwd(), 'node_modules/.bin/electron')
  const executable = argument('app', defaultElectron)
  if (!fs.existsSync(executable)) fail(`Desktop executable not found at ${executable}`)
  const appArguments = executable === defaultElectron
    ? [`--remote-debugging-port=${port}`, process.cwd()]
    : [`--remote-debugging-port=${port}`]

  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 })
  const replayUserData = path.join(
    path.dirname(userData),
    'desktop-runs',
    `run-${Date.now()}-${process.pid}`,
  )
  fs.mkdirSync(replayUserData, { recursive: true, mode: 0o700 })
  fs.copyFileSync(path.join(userData, 'daylens.sqlite'), path.join(replayUserData, 'daylens.sqlite'))
  const sourceConfig = path.join(userData, 'config.json')
  if (fs.existsSync(sourceConfig)) {
    fs.copyFileSync(sourceConfig, path.join(replayUserData, 'config.json'))
  }
  const child = spawn(executable, appArguments, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DAYLENS_DEV_USERDATA: replayUserData,
      DAYLENS_REAL_DAY_HARNESS: '1',
      DAYLENS_REAL_DAY_DATE: date,
      DAYLENS_REAL_DAY_ALLOW_MODEL_NETWORK: hasFlag('with-ai') ? '1' : '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); process.stderr.write(chunk) })
  child.stdout.on('data', (chunk) => process.stdout.write(chunk))

  let cdp = null
  try {
    cdp = await connect(port)
    await waitFor(cdp, `Boolean(window.daylens && document.body)`, 'Daylens preload and renderer')
    const timeline = await timelineObservation(cdp, date)
    const apps = await appsObservation(cdp, date)
    const searchQuery = String(timeline.labels[0] ?? apps.apps[0]?.name ?? '').split(/\s+/).find((part) => part.length >= 4) ?? apps.apps[0]?.name
    const search = await searchObservation(cdp, searchQuery)
    const mutations = hasFlag('mutations') ? await correctionAndDeletion(cdp, date) : null
    const ai = hasFlag('with-ai') ? await aiObservation(cdp, date) : null
    const report = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      date,
      productionBoundaries: ['electron-main', 'migrations', 'repositories', 'ipc', 'preload', 'react-renderer'],
      timeline,
      apps,
      search,
      mutations,
      ai,
    }
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
    console.log(`[real-day desktop] PASS ${date}: ${timeline.domBlockCount} Timeline blocks, ${apps.ipcCount} Apps rows, search UI exercised${mutations ? ', correction/deletion exercised' : ''}${ai ? ', AI UI exercised' : ''}`)
    console.log(`[real-day desktop] private result: ${output}`)
  } catch (error) {
    const suffix = stderr.trim() ? `\nElectron stderr:\n${stderr.slice(-8000)}` : ''
    throw new Error(`${error instanceof Error ? error.stack ?? error.message : String(error)}${suffix}`)
  } finally {
    cdp?.close()
    child.kill('SIGTERM')
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), wait(5_000)])
    if (!child.killed) child.kill('SIGKILL')
    fs.rmSync(replayUserData, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
