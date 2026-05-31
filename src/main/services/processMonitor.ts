import { execFile } from 'node:child_process'
import type { ProcessSnapshot } from '@shared/types'

export type { ProcessSnapshot } from '@shared/types'

const PROCESS_POLL_MS = 30_000
const WMIC_ARGS = ['process', 'get', 'ProcessId,Name,WorkingSetSize,PageFileUsage', '/format:csv']

let monitorInterval: ReturnType<typeof setInterval> | null = null
let latestSnapshot: ProcessSnapshot[] = []
let refreshInFlight = false

export function parseWmicOutput(output: string): ProcessSnapshot[] {
  const now = Date.now()
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '')

  // WMIC /format:csv emits a header row and orders columns alphabetically (not in
  // the requested order), always prefixed with "Node". Resolve column positions
  // from the header instead of hardcoding indices, so parsing is correct
  // regardless of WMIC's ordering.
  const headerIdx = lines.findIndex((line) => line.startsWith('Node,') && /ProcessId/i.test(line))
  if (headerIdx === -1) return []
  const columns = lines[headerIdx].split(',').map((col) => col.trim().toLowerCase())
  const nameIdx = columns.indexOf('name')
  const pidIdx = columns.indexOf('processid')
  const wssIdx = columns.indexOf('workingsetsize')
  if (nameIdx === -1 || pidIdx === -1 || wssIdx === -1) return []

  return lines
    .slice(headerIdx + 1)
    .map((line) => {
      const parts = line.split(',')
      const name = parts[nameIdx]?.trim() ?? 'Unknown'
      const pid = parseInt(parts[pidIdx]?.trim() ?? '0', 10)
      const workingSetSize = parseInt(parts[wssIdx]?.trim() ?? '0', 10)

      return {
        pid,
        name: name.replace(/\.exe$/i, ''),
        cpuPercent: 0,
        memoryMb: Math.round(workingSetSize / 1024 / 1024),
        capturedAt: now,
      }
    })
    .filter((process) => process.pid > 0 && process.memoryMb > 0)
}

// Async refresh so the wmic subprocess never blocks the main thread (the old
// execSync stalled startup and every poll tick). Result is cached in
// latestSnapshot for the diagnostics IPC to read.
function refreshSnapshot(): void {
  if (process.platform !== 'win32' || refreshInFlight) return
  refreshInFlight = true
  execFile('wmic', WMIC_ARGS, { timeout: 5_000, windowsHide: true }, (error, stdout) => {
    refreshInFlight = false
    if (error) return
    try {
      latestSnapshot = parseWmicOutput(stdout)
    } catch {
      // leave the previous snapshot in place
    }
  })
}

// Lazy-start: only spin up the poller when diagnostics actually ask for process
// metrics (via getProcessMetrics), not on every app launch.
export function ensureProcessMonitor(): void {
  if (process.platform !== 'win32') {
    latestSnapshot = []
    return
  }
  if (monitorInterval) return
  refreshSnapshot()
  monitorInterval = setInterval(refreshSnapshot, PROCESS_POLL_MS)
}

export function stopProcessMonitor(): void {
  if (!monitorInterval) return
  clearInterval(monitorInterval)
  monitorInterval = null
}

// Called by the diagnostics IPC handler. Starts the monitor on first use and
// returns whatever the last async poll captured (empty on the very first call,
// populated on subsequent polls).
export function getProcessMetrics(): ProcessSnapshot[] {
  ensureProcessMonitor()
  return latestSnapshot
}

export function getLatestSnapshot(): ProcessSnapshot[] {
  return latestSnapshot
}
