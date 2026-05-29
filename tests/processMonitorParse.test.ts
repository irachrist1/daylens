// Windows process-monitor CSV parsing simulation. WMIC /format:csv emits a
// header row and orders columns ALPHABETICALLY (not in the requested order),
// always prefixed with "Node". parseWmicOutput must resolve columns from the
// header so pid/name/memory map correctly regardless of ordering. This locks the
// parser without a Windows host (a CodeRabbit "critical" finding assumed
// request-order and would have broken it).
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseWmicOutput } from '../src/main/services/processMonitor.ts'

test('parses WMIC csv by header (alphabetical column order)', () => {
  // wmic process get ProcessId,Name,WorkingSetSize,PageFileUsage /format:csv
  // -> alphabetical: Node,Name,PageFileUsage,ProcessId,WorkingSetSize
  const csv = [
    'Node,Name,PageFileUsage,ProcessId,WorkingSetSize',
    'HOST,chrome.exe,50000,4321,209715200',
    'HOST,explorer.exe,1000,99,10485760',
    '',
  ].join('\r\n')

  const rows = parseWmicOutput(csv)
  const chrome = rows.find((r) => r.name === 'chrome')
  assert.ok(chrome, 'chrome row parsed (with .exe stripped)')
  assert.equal(chrome.pid, 4321, 'pid read from the ProcessId column')
  assert.equal(chrome.memoryMb, 200, '209715200 bytes -> 200 MB from WorkingSetSize')
  assert.ok(rows.some((r) => r.name === 'explorer' && r.pid === 99))
})

test('returns empty when no recognizable header is present', () => {
  assert.deepEqual(parseWmicOutput('garbage\nlines\nwith no header'), [])
  assert.deepEqual(parseWmicOutput(''), [])
})

test('drops rows with zero pid or zero memory', () => {
  const csv = [
    'Node,Name,PageFileUsage,ProcessId,WorkingSetSize',
    'HOST,zeropid.exe,0,0,1048576',
    'HOST,zeromem.exe,0,12,0',
    'HOST,ok.exe,0,7,2097152',
  ].join('\n')
  const rows = parseWmicOutput(csv)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, 'ok')
})
