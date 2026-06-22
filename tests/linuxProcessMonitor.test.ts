import test from 'node:test'
import assert from 'node:assert/strict'
import { parseProcStatLine } from '../src/main/services/processMonitor.ts'
import { isBackgroundProcessNoise } from '../src/main/services/backgroundProcessEvidence.ts'

test('parseProcStatLine extracts process name and memory', () => {
  const stat = '1234 (cargo build) R 1000 1234 1234 0 -1 4194304 500 0 0 0 120 40 0 0 20 0 8 0 1234 0 0 0 0 0 0 0 0 0 0 0 0 0 0'
  const status = 'Name:\tcargo\nVmRSS:\t 409600 kB\n'
  const snapshot = parseProcStatLine(stat, status)
  assert.ok(snapshot)
  assert.equal(snapshot.pid, 1234)
  assert.equal(snapshot.name, 'cargo build')
  assert.equal(snapshot.memoryMb, 400)
})

test('isBackgroundProcessNoise filters linux system processes', { skip: process.platform !== 'linux' }, () => {
  assert.equal(isBackgroundProcessNoise('systemd'), true)
  assert.equal(isBackgroundProcessNoise('kworker/0:1'), true)
  assert.equal(isBackgroundProcessNoise('cargo'), false)
})
