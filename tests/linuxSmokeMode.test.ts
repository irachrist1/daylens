import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const MAIN_PROCESS_SOURCE = path.resolve(process.cwd(), 'src/main/index.ts')

test('linux smoke mode does not start remote sync or startup workload timers', () => {
  const source = fs.readFileSync(MAIN_PROCESS_SOURCE, 'utf8')

  assert.match(
    source,
    /if \(!SMOKE_TEST\) \{[\s\S]*?startSync\(\)[\s\S]*?startDailySummaryNotifier\(mainWindow\)[\s\S]*?startDistractionAlerter\(\)[\s\S]*?\}/,
    'smoke mode should not start remote sync, daily notification, or distraction timers',
  )
  assert.match(
    source,
    /if \(!SMOKE_TEST\) \{[\s\S]*?setTimeout\(\(\) => \{[\s\S]*?finalizePreviousDay\(\)[\s\S]*?\}, 10_000\)[\s\S]*?\}/,
    'smoke mode should not run startup finalization, which can invoke remote sync',
  )
})

test('linux smoke mode disables gpu-dependent renderer startup paths', () => {
  const source = fs.readFileSync(MAIN_PROCESS_SOURCE, 'utf8')

  assert.match(
    source,
    /if \(process\.platform === 'linux' && SMOKE_TEST\) \{[\s\S]*?app\.disableHardwareAcceleration\(\)[\s\S]*?appendSwitch\('disable-gpu'\)[\s\S]*?appendSwitch\('disable-dev-shm-usage'\)[\s\S]*?\}/,
    'linux smoke mode should disable hardware/gpu paths before app ready',
  )
})

test('linux smoke load fallback is registered before the renderer starts loading', () => {
  const source = fs.readFileSync(MAIN_PROCESS_SOURCE, 'utf8')
  const didFinishLoadListener = source.indexOf("win.webContents.once('did-finish-load', maybeRunLinuxSmokeValidation)")
  const watchdog = source.indexOf('setTimeout(maybeRunLinuxSmokeValidation, 20_000)')
  const loadFile = source.indexOf('void win.loadFile(rendererPath)')
  const loadUrl = source.indexOf('win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)')

  assert.notEqual(didFinishLoadListener, -1, 'missing linux smoke did-finish-load fallback')
  assert.notEqual(watchdog, -1, 'missing linux smoke watchdog fallback')
  assert.notEqual(loadFile, -1, 'missing packaged renderer load')
  assert.notEqual(loadUrl, -1, 'missing dev renderer load')
  assert.ok(didFinishLoadListener < loadFile, 'packaged smoke fallback must be registered before loadFile')
  assert.ok(didFinishLoadListener < loadUrl, 'dev smoke fallback must be registered before loadURL')
  assert.ok(watchdog < loadFile, 'packaged smoke watchdog must be armed before loadFile')
  assert.ok(watchdog < loadUrl, 'dev smoke watchdog must be armed before loadURL')
})
