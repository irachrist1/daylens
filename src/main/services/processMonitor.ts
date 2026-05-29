import { execFile } from 'node:child_process'
import type { ProcessSnapshot } from '@shared/types'

export type { ProcessSnapshot } from '@shared/types'

const PROCESS_POLL_MS = 30_000
const WMIC_ARGS = ['process', 'get', 'ProcessId,Name,WorkingSetSize,PageFileUsage', '/format:csv']

let monitorInterval: ReturnType<typeof setInterval> | null = null
let latestSnapshot: ProcessSnapshot[] = []
let refreshInFlight = false

function parseWmicOutput(output: string): ProcessSnapshot[] {
  const now = Date.now()
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('Node,'))
    .map((line) => {
      const parts = line.split(',')
      const name = parts[1]?.trim() ?? 'Unknown'
      const pid = parseInt(parts[3]?.trim() ?? '0', 10)
      const workingSetSize = parseInt(parts[4]?.trim() ?? '0', 10)

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
