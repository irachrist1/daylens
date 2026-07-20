import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// State-machine tests for the macOS updater (DEV-212). The hermetic ts-loader
// stubs 'electron' and 'electron-updater', so these tests drive the two Mac
// update paths end to end at the state level:
//
//   ad-hoc build  → remote update feed + verified download + swap helper
//   signed build  → electron-updater (Squirrel.Mac verifies the bundle)
//
// The signing probe is short-circuited through the persisted updater-signing
// manifest (keyed by app version), so no codesign subprocess runs.

Object.defineProperty(process, 'platform', { value: 'darwin' })

const { app, net, ipcRecord } = await import('./support/electron-stub.mjs')
const { updaterRecord } = await import('./support/electron-updater-stub.mjs')
const updater = await import('../src/main/services/updater.ts')

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-updater-test-'))
app.setPath('userData', userDataDir)
app.isPackaged = true

interface FakeFeedResponse {
  ok: boolean
  status: number
  json: () => Promise<unknown>
  text: () => Promise<string>
}

function feedResponse(payload: unknown): FakeFeedResponse {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  }
}

function descriptor(overrides: Record<string, unknown> = {}) {
  return {
    version: '1.0.99',
    releaseName: 'Daylens 1.0.99',
    releaseNotesText: 'Fixes capture bugs.',
    releaseDate: '2026-07-19T00:00:00.000Z',
    installUrl: 'https://example.com/Daylens-1.0.99-arm64.zip',
    installFileName: 'Daylens-1.0.99-arm64.zip',
    installSizeBytes: 1024,
    installSha256: 'a'.repeat(64),
    manualUrl: 'https://example.com/download',
    releasePageUrl: 'https://example.com/releases/1.0.99',
    ...overrides,
  }
}

function writeSigningManifest(adhoc: boolean): void {
  fs.writeFileSync(
    path.join(userDataDir, 'updater-signing.json'),
    `${JSON.stringify({ version: app.getVersion(), adhoc })}\n`,
    'utf8',
  )
}

type NetWithFetch = typeof net & { fetch?: (url: string, init?: unknown) => Promise<FakeFeedResponse> }
const netStub = net as NetWithFetch

let feedCalls = 0
let nextFeed: (() => Promise<FakeFeedResponse>) | null = null
netStub.fetch = async () => {
  feedCalls += 1
  if (!nextFeed) throw new Error('test did not queue a feed response')
  return nextFeed()
}

const statusEvents: Array<Record<string, unknown>> = []
const fakeWindow = {
  webContents: {
    send: (_channel: string, state: Record<string, unknown>) => {
      statusEvents.push(state)
    },
  },
} as unknown as Parameters<typeof updater.initUpdater>[0]

function initFor(adhoc: boolean): void {
  updater.__resetUpdaterForTests()
  updaterRecord.reset()
  ipcRecord.reset()
  statusEvents.length = 0
  feedCalls = 0
  writeSigningManifest(adhoc)
  updater.initUpdater(fakeWindow)
}

async function invoke(channel: string): Promise<unknown> {
  const handler = ipcRecord.handlers.get(channel)
  assert.ok(handler, `handler registered for ${channel}`)
  return handler()
}

// --- Ad-hoc build: remote feed path -----------------------------------------

test('ad-hoc mac: manual check against the remote feed surfaces an available, verifiable update', async () => {
  initFor(true)
  nextFeed = async () => feedResponse(descriptor())

  const state = (await invoke('update:check')) as ReturnType<typeof updater.getUpdaterState>
  assert.equal(state.status, 'available')
  assert.equal(state.version, '1.0.99')
  assert.equal(state.canAutoInstall, true)
  assert.equal(state.releaseName, 'Daylens 1.0.99')
  assert.equal(state.downloadUrl, 'https://example.com/download')
  assert.equal(feedCalls, 1, 'ad-hoc check hits the remote feed')
  assert.equal(updaterRecord.checkForUpdatesCalls, 0, 'ad-hoc check never touches electron-updater')
  assert.equal(updater.getUpdateAvailable(), '1.0.99')
})

test('ad-hoc mac: an update without a SHA-256 digest is offered as manual download only', async () => {
  initFor(true)
  nextFeed = async () => feedResponse(descriptor({ installSha256: null }))

  const state = (await invoke('update:check')) as ReturnType<typeof updater.getUpdaterState>
  assert.equal(state.status, 'available')
  assert.equal(state.canAutoInstall, false)
  assert.match(String(state.supportMessage), /manual download/i)

  // The install backstop refuses too: state stays 'available', nothing quits.
  const installed = await invoke('update:install')
  assert.equal(installed, false)
  assert.equal(updater.getUpdaterState().status, 'available')
  assert.equal(updater.getUpdaterState().canAutoInstall, false)
  assert.equal(updater.isInstallingUpdate(), false)
})

test('ad-hoc mac: a non-HTTPS artifact URL is not auto-installable', async () => {
  initFor(true)
  nextFeed = async () => feedResponse(descriptor({ installUrl: 'http://example.com/Daylens.zip' }))

  const state = (await invoke('update:check')) as ReturnType<typeof updater.getUpdaterState>
  assert.equal(state.status, 'available')
  assert.equal(state.canAutoInstall, false)
})

test('ad-hoc mac: a feed version at or below the running build reports up to date', async () => {
  initFor(true)
  nextFeed = async () => feedResponse(descriptor({ version: '0.0.0-test' }))

  const state = (await invoke('update:check')) as ReturnType<typeof updater.getUpdaterState>
  assert.equal(state.status, 'not-available')
  assert.equal(updater.getUpdateAvailable(), null)
})

test('ad-hoc mac: a failing manual check reports a friendly error and keeps the manual download', async () => {
  initFor(true)
  nextFeed = async () => {
    throw new Error('net::ERR ENOTFOUND christian-tonny.dev')
  }

  const state = (await invoke('update:check')) as ReturnType<typeof updater.getUpdaterState>
  assert.equal(state.status, 'error')
  assert.match(String(state.errorMessage), /could not reach the update service/i)
  assert.ok(state.downloadUrl, 'error state still offers a manual download URL')
})

test('ad-hoc mac: install is refused when no update is pending', async () => {
  initFor(true)
  nextFeed = async () => feedResponse(descriptor({ version: '0.0.0-test' }))
  await invoke('update:check')

  const installed = await invoke('update:install')
  assert.equal(installed, false)
})

// --- Signed build: electron-updater (Squirrel.Mac) path ---------------------

test('signed mac: init subscribes to electron-updater and reports the signed support mode', () => {
  initFor(false)
  assert.ok(updaterRecord.listenerCount('update-available') >= 1, 'signed path subscribes to electron-updater events')
  const state = updater.getUpdaterState()
  assert.equal(state.supported, true)
  assert.match(String(state.supportMessage), /Developer ID/i)
})

test('signed mac: manual check goes through electron-updater, not the remote feed', async () => {
  initFor(false)
  await invoke('update:check')
  assert.equal(updaterRecord.checkForUpdatesCalls, 1)
  assert.equal(feedCalls, 0)
})

test('signed mac: available update downloads in the background and becomes ready to install', () => {
  initFor(false)

  updaterRecord.emit('update-available', { version: '1.0.99', releaseName: 'Daylens 1.0.99' })
  assert.equal(updater.getUpdaterState().status, 'downloading')
  assert.equal(updater.getUpdaterState().version, '1.0.99')

  updaterRecord.emit('download-progress', { percent: 42.4 })
  assert.equal(updater.getUpdaterState().status, 'downloading')
  assert.equal(updater.getUpdaterState().progressPct, 42)

  updaterRecord.emit('update-downloaded', { version: '1.0.99' })
  const state = updater.getUpdaterState()
  assert.equal(state.status, 'downloaded')
  assert.equal(state.progressPct, 100)
  assert.equal(state.errorMessage, null)
})

test('signed mac: install is refused while the download is still in flight', async () => {
  initFor(false)
  updaterRecord.emit('update-available', { version: '1.0.99' })
  assert.equal(updater.getUpdaterState().status, 'downloading')

  const installed = await invoke('update:install')
  assert.equal(installed, false)
  assert.equal(updaterRecord.quitAndInstallCalls, 0)
})

test('signed mac: restart-to-update hands off to Squirrel via quitAndInstall', async () => {
  initFor(false)
  updaterRecord.emit('update-available', { version: '1.0.99' })
  updaterRecord.emit('update-downloaded', { version: '1.0.99' })

  const installed = await invoke('update:install')
  assert.equal(installed, true)
  assert.equal(updater.getUpdaterState().status, 'installing')
  assert.equal(updater.isInstallingUpdate(), true)

  // quitAndInstall is deferred to the next tick so the IPC reply flushes first.
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(updaterRecord.quitAndInstallCalls, 1)
})

test('signed mac: a second install request while installing is a no-op', async () => {
  initFor(false)
  updaterRecord.emit('update-available', { version: '1.0.99' })
  updaterRecord.emit('update-downloaded', { version: '1.0.99' })

  assert.equal(await invoke('update:install'), true)
  assert.equal(await invoke('update:install'), false)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(updaterRecord.quitAndInstallCalls, 1)
})

test('signed mac: missing updater metadata surfaces a friendly error', () => {
  initFor(false)
  updaterRecord.emit('error', new Error('Cannot find latest-mac.yml in the latest release artifacts (HTTP 404)'))
  const state = updater.getUpdaterState()
  assert.equal(state.status, 'error')
  assert.match(String(state.errorMessage), /published without updater metadata/i)
})

test('signed mac: a failed signature validation is reported honestly', () => {
  initFor(false)
  updaterRecord.emit('error', new Error('Could not get code signature for running application'))
  const state = updater.getUpdaterState()
  assert.equal(state.status, 'error')
  assert.match(String(state.errorMessage), /signature verification/i)
})

test('updater status events reach the renderer window', () => {
  initFor(false)
  statusEvents.length = 0
  updaterRecord.emit('update-available', { version: '1.0.99' })
  updaterRecord.emit('update-downloaded', { version: '1.0.99' })
  const statuses = statusEvents.map((event) => event.status)
  assert.deepEqual(statuses, ['downloading', 'downloaded'])
})

after(() => {
  updater.__resetUpdaterForTests()
  fs.rmSync(userDataDir, { recursive: true, force: true })
})
