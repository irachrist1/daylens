import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  claudeDesktopConfigPath,
  discoverMcpServers,
  detectFocusApps,
  collectFocusAppSignals,
} from '../src/main/services/enrichmentDiscovery.ts'
import { claudeDesktopConfigDisplayPath } from '../src/shared/platformPaths.ts'

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(value))
}

test('Claude Desktop config paths are correct on macOS, Windows, and Linux', () => {
  assert.equal(
    claudeDesktopConfigPath('/Users/alex', 'darwin'),
    path.join('/Users/alex', 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
  )
  assert.equal(
    claudeDesktopConfigPath('C:\\Users\\alex', 'win32', 'C:\\Users\\alex\\AppData\\Roaming'),
    path.join('C:\\Users\\alex\\AppData\\Roaming', 'Claude', 'claude_desktop_config.json'),
  )
  assert.equal(
    claudeDesktopConfigPath('/home/alex', 'linux'),
    path.join('/home/alex', '.config', 'Claude', 'claude_desktop_config.json'),
  )
  assert.equal(claudeDesktopConfigDisplayPath('darwin'), '~/Library/Application Support/Claude/claude_desktop_config.json')
  assert.equal(claudeDesktopConfigDisplayPath('win32'), '%APPDATA%\\Claude\\claude_desktop_config.json')
  assert.equal(claudeDesktopConfigDisplayPath('linux'), '~/.config/Claude/claude_desktop_config.json')
})

test('discoverMcpServers reads stdio, http, and malformed entries from a fixture config', () => {
  const dir = tempDir('daylens-mcp-config-')
  const configPath = path.join(dir, 'claude_desktop_config.json')
  writeJson(configPath, {
    mcpServers: {
      notion: { command: 'npx', args: ['-y', '@notion/mcp-server', '--token', 'secret-token'] },
      linear: { url: 'https://mcp.linear.app/sse' },
      jira: { env: { API_KEY: 'not-a-command-or-url' } },
    },
  })

  const servers = discoverMcpServers(configPath)
  assert.equal(servers.length, 3)

  const notion = servers.find((s) => s.name === 'notion')
  assert.equal(notion?.transport, 'stdio')

  const linear = servers.find((s) => s.name === 'linear')
  assert.equal(linear?.transport, 'http')

  const jira = servers.find((s) => s.name === 'jira')
  assert.equal(jira?.transport, 'unknown')

  // Command args and env values must never leak into the discovery result.
  const serialized = JSON.stringify(servers)
  assert.ok(!serialized.includes('secret-token'))
  assert.ok(!serialized.includes('not-a-command-or-url'))
})

test('discoverMcpServers returns [] for a missing config file', () => {
  const dir = tempDir('daylens-mcp-missing-')
  const configPath = path.join(dir, 'claude_desktop_config.json')
  assert.deepEqual(discoverMcpServers(configPath), [])
})

test('discoverMcpServers returns [] for a malformed (non-JSON) config file', () => {
  const dir = tempDir('daylens-mcp-malformed-')
  const configPath = path.join(dir, 'claude_desktop_config.json')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(configPath, '{ this is not valid json')
  assert.deepEqual(discoverMcpServers(configPath), [])
})

test('discoverMcpServers returns [] when the config has no mcpServers object', () => {
  const dir = tempDir('daylens-mcp-empty-')
  const configPath = path.join(dir, 'claude_desktop_config.json')
  writeJson(configPath, { somethingElse: true })
  assert.deepEqual(discoverMcpServers(configPath), [])
})

test('detectFocusApps finds Raycast (app bundle) and Be Focused (App Store container)', () => {
  const homeDir = tempDir('daylens-focus-home-')
  const applicationsDir = path.join(homeDir, 'Applications')
  fs.mkdirSync(path.join(applicationsDir, 'Raycast.app'), { recursive: true })

  const containersDir = path.join(homeDir, 'Library', 'Containers')
  fs.mkdirSync(path.join(containersDir, 'com.xwavesoft.befocused2'), { recursive: true })

  const apps = detectFocusApps({ homeDir, applicationsDirs: [applicationsDir], containersDir })

  const raycast = apps.find((a) => a.app === 'Raycast Focus')
  assert.equal(raycast?.installed, true)

  const beFocused = apps.find((a) => a.app === 'Be Focused')
  assert.equal(beFocused?.installed, true)

  const session = apps.find((a) => a.app === 'Session')
  assert.equal(session?.installed, false)
})

test('detectFocusApps reports nothing installed against an empty directory structure', () => {
  const homeDir = tempDir('daylens-focus-empty-home-')
  const applicationsDir = path.join(homeDir, 'Applications')
  fs.mkdirSync(applicationsDir, { recursive: true })
  const containersDir = path.join(homeDir, 'Library', 'Containers')
  fs.mkdirSync(containersDir, { recursive: true })

  const apps = detectFocusApps({ homeDir, applicationsDirs: [applicationsDir], containersDir })
  assert.ok(apps.every((a) => a.installed === false))
})

test('collectFocusAppSignals returns null when no focus app is installed', async () => {
  const homeDir = tempDir('daylens-focus-none-home-')
  const applicationsDir = path.join(homeDir, 'Applications')
  fs.mkdirSync(applicationsDir, { recursive: true })
  const containersDir = path.join(homeDir, 'Library', 'Containers')
  fs.mkdirSync(containersDir, { recursive: true })

  const signals = await collectFocusAppSignals('2026-07-08', {
    homeDir,
    applicationsDirs: [applicationsDir],
    containersDir,
  })
  assert.equal(signals, null)
})

test('collectFocusAppSignals returns an empty-sessions signal when the app is installed but its store is unreadable', async () => {
  const homeDir = tempDir('daylens-focus-unreadable-home-')
  const applicationsDir = path.join(homeDir, 'Applications')
  fs.mkdirSync(path.join(applicationsDir, 'Session.app'), { recursive: true })
  const containersDir = path.join(homeDir, 'Library', 'Containers')
  fs.mkdirSync(containersDir, { recursive: true })

  const signals = await collectFocusAppSignals('2026-07-08', {
    homeDir,
    applicationsDirs: [applicationsDir],
    containersDir,
  })

  assert.ok(signals)
  assert.equal(signals!.length, 1)
  assert.equal(signals![0].app, 'Session')
  assert.deepEqual(signals![0].sessions, [])
})

test('collectFocusAppSignals parses sessions overlapping the requested date from a readable store', async () => {
  const homeDir = tempDir('daylens-focus-parsed-home-')
  const applicationsDir = path.join(homeDir, 'Applications')
  fs.mkdirSync(path.join(applicationsDir, 'Session.app'), { recursive: true })
  const containersDir = path.join(homeDir, 'Library', 'Containers')
  fs.mkdirSync(containersDir, { recursive: true })

  const storePath = path.join(homeDir, 'Library', 'Application Support', 'Session', 'sessions.json')
  writeJson(storePath, {
    sessions: [
      { startTime: '2026-07-08T14:30:00', durationMinutes: 25, label: 'Deep work' },
      { startTime: '2026-07-06T09:00:00', durationMinutes: 50, label: 'Wrong day' },
    ],
  })

  const signals = await collectFocusAppSignals('2026-07-08', {
    homeDir,
    applicationsDirs: [applicationsDir],
    containersDir,
  })

  assert.ok(signals)
  const session = signals!.find((s) => s.app === 'Session')
  assert.ok(session)
  assert.equal(session!.sessions.length, 1)
  assert.equal(session!.sessions[0].durationMinutes, 25)
  assert.equal(session!.sessions[0].label, 'Deep work')
  assert.equal(session!.sessions[0].startClock, '2:30pm')
})
