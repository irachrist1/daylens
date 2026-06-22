import type { ProcessSnapshot } from '@shared/types'

const MIN_BACKGROUND_DURATION_MS = 5 * 60_000
const MIN_BACKGROUND_MEMORY_MB = 200
const MAX_BACKGROUND_PROCESSES = 8

const BACKGROUND_NOISE_EXACT = new Set([
  'system',
  'registry',
  'smss',
  'csrss',
  'wininit',
  'services',
  'lsass',
  'svchost',
  'dwm',
  'explorer',
  'runtimebroker',
  'searchindexer',
  'searchhost',
  'shellexperiencehost',
  'startmenuexperiencehost',
  'applicationframehost',
  'textinputhost',
  'securityhealthservice',
  'sihost',
  'taskhostw',
  'conhost',
  'dllhost',
  'audiodg',
  'spoolsv',
  'wmiprvse',
  'fontdrvhost',
  'ctfmon',
  'idle',
])

export interface BackgroundProcessEvidence {
  name: string
  totalSeconds: number
  memoryMbPeak: number
}

interface TrackedBackgroundProcess {
  name: string
  startedAt: number
  lastSeenAt: number
  memoryMbPeak: number
}

const activeBackground = new Map<string, TrackedBackgroundProcess>()

function normalizedProcessName(name: string): string {
  return name.replace(/\.exe$/i, '').toLowerCase()
}

const LINUX_BACKGROUND_NOISE_EXACT = new Set([
  'systemd',
  'init',
  'kthreadd',
  'ksoftirqd',
  'migration',
  'rcu_sched',
  'rcu_bh',
  'watchdog',
  'cpuhp',
  'kworker',
  'kdevtmpfs',
  'kauditd',
  'khungtaskd',
  'oom_reaper',
  'writeback',
  'kcompactd',
  'ksmd',
  'khugepaged',
  'kintegrityd',
  'kblockd',
  'ata_sff',
  'md',
  'edac-poller',
  'devfreq_wq',
  'watchdogd',
  'kswapd',
  'ecryptfs-kthrea',
  'kthrotld',
  'acpi_thermal_pm',
  'scsi_eh',
  'scsi_tmf',
  'ipv6_addrconf',
  'kstrp',
  'zswap-shrink',
  'krfcommd',
  'irq',
  'dbus-daemon',
  'pipewire',
  'wireplumber',
  'pulseaudio',
  'xdg-desktop-por',
  'xdg-document-po',
  'xdg-permission-',
  'gjs',
  'gnome-shell',
  'mutter',
  'kwin_wayland',
  'kwin_x11',
  'plasmashell',
  'ksmserver',
  'systemd-user',
  'systemd-logind',
  'systemd-journal',
  'systemd-udevd',
  'systemd-resolved',
  'systemd-network',
  'sshd',
  'cron',
  'at-spi-bus-launcher',
  'at-spi2-registryd',
])

function isLinuxBackgroundNoise(name: string): boolean {
  const normalized = normalizedProcessName(name)
  if (!normalized) return true
  if (LINUX_BACKGROUND_NOISE_EXACT.has(normalized)) return true
  if (normalized.startsWith('kworker')) return true
  if (normalized.startsWith('irq/')) return true
  if (normalized.startsWith('xdg-')) return true
  if (normalized.startsWith('systemd-')) return true
  return false
}

export function isBackgroundProcessNoise(name: string): boolean {
  const normalized = normalizedProcessName(name)
  if (!normalized) return true
  if (process.platform === 'linux') return isLinuxBackgroundNoise(name)
  if (BACKGROUND_NOISE_EXACT.has(normalized)) return true
  if (normalized.startsWith('svchost')) return true
  return false
}

export function observeProcessSnapshots(snapshots: ProcessSnapshot[], capturedAt = Date.now()): void {
  if (process.platform !== 'win32' && process.platform !== 'linux') return

  const seen = new Set<string>()
  for (const snapshot of snapshots) {
    if (isBackgroundProcessNoise(snapshot.name)) continue
    if (snapshot.memoryMb < MIN_BACKGROUND_MEMORY_MB) continue

    const key = normalizedProcessName(snapshot.name)
    seen.add(key)
    const existing = activeBackground.get(key)
    if (!existing) {
      activeBackground.set(key, {
        name: snapshot.name,
        startedAt: capturedAt,
        lastSeenAt: capturedAt,
        memoryMbPeak: snapshot.memoryMb,
      })
      continue
    }

    existing.lastSeenAt = capturedAt
    existing.memoryMbPeak = Math.max(existing.memoryMbPeak, snapshot.memoryMb)
  }

  for (const [key, tracked] of activeBackground.entries()) {
    if (seen.has(key)) continue
    if (capturedAt - tracked.lastSeenAt > 60_000) {
      activeBackground.delete(key)
    }
  }
}

export function getBackgroundProcessEvidence(
  startTime: number,
  endTime: number,
): BackgroundProcessEvidence[] {
  if (process.platform !== 'win32' && process.platform !== 'linux') return []

  const results: BackgroundProcessEvidence[] = []
  for (const tracked of activeBackground.values()) {
    const overlapStart = Math.max(startTime, tracked.startedAt)
    const overlapEnd = Math.min(endTime, tracked.lastSeenAt)
    if (overlapEnd <= overlapStart) continue
    const durationMs = overlapEnd - overlapStart
    if (durationMs < MIN_BACKGROUND_DURATION_MS) continue
    results.push({
      name: tracked.name,
      totalSeconds: Math.round(durationMs / 1_000),
      memoryMbPeak: tracked.memoryMbPeak,
    })
  }

  return results
    .sort((left, right) => right.totalSeconds - left.totalSeconds)
    .slice(0, MAX_BACKGROUND_PROCESSES)
}

export function __resetBackgroundProcessEvidenceForTests(): void {
  activeBackground.clear()
}
