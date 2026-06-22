import { execFile } from 'node:child_process'
import fs from 'node:fs'
import type { ProcessSnapshot } from '@shared/types'
import { observeProcessSnapshots } from './backgroundProcessEvidence'

export type { ProcessSnapshot } from '@shared/types'

const PROCESS_POLL_MS = 30_000

let monitorInterval: ReturnType<typeof setInterval> | null = null
let latestSnapshot: ProcessSnapshot[] = []
let refreshInFlight = false
const previousCpuByPid = new Map<number, { cpuTicks: number; capturedAt: number }>()

export function parseProcStatLine(statContent: string, statusContent: string): ProcessSnapshot | null {
  const close = statContent.lastIndexOf(')')
  const open = statContent.indexOf('(')
  if (close <= open) return null

  const pid = parseInt(statContent.slice(0, open).trim(), 10)
  if (!Number.isFinite(pid) || pid <= 0) return null

  const name = statContent.slice(open + 1, close).trim() || 'unknown'
  const rest = statContent.slice(close + 2).trim().split(/\s+/)
  const utime = parseInt(rest[11] ?? '0', 10)
  const stime = parseInt(rest[12] ?? '0', 10)
  const rssMatch = statusContent.match(/^VmRSS:\s+(\d+)\s+kB/m)
  const memoryMb = rssMatch ? Math.round(parseInt(rssMatch[1], 10) / 1024) : 0
  if (memoryMb <= 0) return null

  return {
    pid,
    name,
    cpuPercent: Math.max(0, utime + stime),
    memoryMb,
    capturedAt: Date.now(),
  }
}

export function parseCimProcessOutput(output: string): ProcessSnapshot[] {
  const now = Date.now()
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const snapshots: ProcessSnapshot[] = []

  for (const line of lines) {
    const parts = line.split('|')
    if (parts.length < 3) continue
    const name = parts[0]?.trim()
    const pid = parseInt(parts[1]?.trim() ?? '0', 10)
    const workingSetSize = parseInt(parts[2]?.trim() ?? '0', 10)
    if (!name || pid <= 0 || workingSetSize <= 0) continue
    snapshots.push({
      pid,
      name: name.replace(/\.exe$/i, ''),
      cpuPercent: 0,
      memoryMb: Math.round(workingSetSize / 1024 / 1024),
      capturedAt: now,
    })
  }

  return snapshots
}

export function parseWmicOutput(output: string): ProcessSnapshot[] {
  const now = Date.now()
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '')

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

function enrichCpuPercent(snapshots: ProcessSnapshot[]): ProcessSnapshot[] {
  const now = Date.now()
  return snapshots.map((snapshot) => {
    const cpuTicks = snapshot.cpuPercent
    const previous = previousCpuByPid.get(snapshot.pid)
    previousCpuByPid.set(snapshot.pid, { cpuTicks, capturedAt: now })
    if (!previous) return { ...snapshot, cpuPercent: 0 }

    const elapsedSec = Math.max(0.001, (now - previous.capturedAt) / 1_000)
    const deltaTicks = Math.max(0, cpuTicks - previous.cpuTicks)
    const cpuPercent = Math.max(0, Math.min(100, (deltaTicks / elapsedSec) * 100 / 100))
    return { ...snapshot, cpuPercent }
  })
}

function refreshSnapshotProc(): void {
  if (process.platform !== 'linux' || refreshInFlight) return
  refreshInFlight = true
  try {
    const snapshots: ProcessSnapshot[] = []
    for (const entry of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) continue
      try {
        const stat = fs.readFileSync(`/proc/${entry}/stat`, 'utf8')
        const status = fs.readFileSync(`/proc/${entry}/status`, 'utf8')
        const snapshot = parseProcStatLine(stat, status)
        if (snapshot) snapshots.push(snapshot)
      } catch {
        // ignore unreadable processes
      }
    }
    latestSnapshot = snapshots
    observeProcessSnapshots(latestSnapshot)
  } catch {
    // keep previous snapshot
  } finally {
    refreshInFlight = false
  }
}

function refreshSnapshotCim(): void {
  execFile(
    'powershell',
    ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.Name)|$($_.ProcessId)|$($_.WorkingSetSize)" }'],
    { timeout: 8_000, windowsHide: true },
    (error, stdout) => {
      refreshInFlight = false
      if (error) return
      try {
        latestSnapshot = enrichCpuPercent(parseCimProcessOutput(stdout))
        observeProcessSnapshots(latestSnapshot)
      } catch {
        // keep previous snapshot
      }
    },
  )
}

function refreshSnapshotWmic(): void {
  execFile('wmic', ['process', 'get', 'ProcessId,Name,WorkingSetSize', '/format:csv'], { timeout: 5_000, windowsHide: true }, (error, stdout) => {
    refreshInFlight = false
    if (error) return
    try {
      latestSnapshot = parseWmicOutput(stdout)
      observeProcessSnapshots(latestSnapshot)
    } catch {
      // keep previous snapshot
    }
  })
}

function refreshSnapshot(): void {
  if (refreshInFlight) return
  if (process.platform === 'linux') {
    refreshSnapshotProc()
    return
  }
  if (process.platform !== 'win32') return
  refreshInFlight = true
  refreshSnapshotCim()
}

export function ensureProcessMonitor(): void {
  if (process.platform !== 'win32' && process.platform !== 'linux') {
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

export function getProcessMetrics(): ProcessSnapshot[] {
  ensureProcessMonitor()
  return latestSnapshot
}

export function getLatestSnapshot(): ProcessSnapshot[] {
  return latestSnapshot
}

// Test-only export for WMIC fallback verification.
export { refreshSnapshotWmic }
