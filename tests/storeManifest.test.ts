// The Microsoft Store package is built from build/win/store/AppxManifest.xml.
// These checks catch a manifest that would fail packaging or certification
// before the Windows-only CI job ever runs makeappx.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { HIDDEN_LAUNCH_ARG } from '../src/main/lib/windowsStore'

const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, '..')
const config = require('../electron-builder.config.js')
const manifestPath = path.join(root, 'build', config.appx.customManifestPath)
const manifest = fs.readFileSync(manifestPath, 'utf8')

// Every macro AppxTarget.writeManifest substitutes; any other ${...} throws at build time.
const SUPPORTED_MACROS = new Set([
  'publisher', 'publisherDisplayName', 'version', 'applicationId', 'identityName', 'executable',
  'displayName', 'description', 'backgroundColor', 'logo', 'square150x150Logo', 'square44x44Logo',
  'lockScreen', 'defaultTile', 'splashScreen', 'arch', 'resourceLanguages', 'capabilities',
  'extensions', 'minVersion', 'maxVersionTested',
])

test('appx config requests runFullTrust only and uses the custom manifest', () => {
  assert.deepEqual(config.appx.capabilities, ['runFullTrust'])
  assert.equal(config.appx.addAutoLaunchExtension, false)
  assert.ok(fs.existsSync(manifestPath), `missing ${manifestPath}`)
  // Files in build/appx are mapped into the package as tile assets.
  assert.ok(!config.appx.customManifestPath.startsWith('appx/'))
})

test('manifest uses only macros electron-builder knows', () => {
  const macros = [...manifest.matchAll(/\$\{([a-zA-Z0-9]+)\}/g)].map((m) => m[1])
  const unknown = macros.filter((name) => !SUPPORTED_MACROS.has(name))
  assert.deepEqual(unknown, [])
  assert.ok(macros.includes('capabilities'))
  // ${extensions} would add a second <Extensions> element next to ours.
  assert.ok(!macros.includes('extensions'))
})

test('manifest declares one Daylens StartupTask and no restricted capability of its own', () => {
  const tasks = [...manifest.matchAll(/<(?:desktop|uap5):StartupTask\b[^>]*TaskId="([^"]+)"/g)].map((m) => m[1])
  assert.deepEqual(tasks, ['DaylensStartup'])
  assert.ok(!manifest.includes('SlackStartup'))
  assert.equal((manifest.match(/<Extensions>/g) ?? []).length, 1)
  assert.ok(!/<rescap:Capability/.test(manifest), 'capabilities come from appx.capabilities only')
  assert.ok(!/unvirtualizedResources|FileSystemWriteVirtualization|RegistryWriteVirtualization/.test(manifest))
})

test('the StartupTask marks login launches with the flag main reads', () => {
  const extension = manifest.match(/<uap5:Extension Category="windows.startupTask"[^>]*>/)?.[0] ?? ''
  assert.match(extension, new RegExp(`uap10:Parameters="${HIDDEN_LAUNCH_ARG}"`))
  // uap10 attributes are ignored below Windows 10 2004.
  assert.equal(config.appx.minVersion, '10.0.19041.0')
})

test('tile assets exist at the sizes the manifest references', () => {
  const expected: Record<string, [number, number]> = {
    'StoreLogo.png': [50, 50],
    'Square44x44Logo.png': [44, 44],
    'Square150x150Logo.png': [150, 150],
    'Wide310x150Logo.png': [310, 150],
    'LargeTile.png': [310, 310],
    'SmallTile.png': [71, 71],
  }
  for (const [name, [width, height]] of Object.entries(expected)) {
    const png = fs.readFileSync(path.join(root, 'build', 'appx', name))
    assert.equal(png.readUInt32BE(16), width, `${name} width`)
    assert.equal(png.readUInt32BE(20), height, `${name} height`)
  }
})
