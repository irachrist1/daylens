import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { ANALYTICS_EVENT } from '@shared/analytics'
import type {
  AppCategory,
  AppSettings,
  AppTheme,
  AppUsageSummary,
  ClientRecord,
  TrackingDiagnosticsPayload,
  WorkMemorySettingsSummary,
} from '@shared/types'
import { ipc } from '../lib/ipc'
import { track } from '../lib/analytics'
import type { UpdaterStatusInfo } from '../../preload/index'
import ConnectAI from '../components/ConnectAI'

const CATEGORY_OPTIONS: Array<{ value: AppCategory; label: string }> = [
  { value: 'development', label: 'Development' },
  { value: 'communication', label: 'Communication' },
  { value: 'research', label: 'Research' },
  { value: 'writing', label: 'Writing' },
  { value: 'aiTools', label: 'AI Tools' },
  { value: 'design', label: 'Design' },
  { value: 'browsing', label: 'Browsing' },
  { value: 'meetings', label: 'Meetings' },
  { value: 'entertainment', label: 'Entertainment' },
  { value: 'email', label: 'Email' },
  { value: 'productivity', label: 'Productivity' },
  { value: 'social', label: 'Social' },
  { value: 'system', label: 'System' },
  { value: 'uncategorized', label: 'Uncategorized' },
]

function sectionTitle(label: string) {
  return (
    <div style={{
      fontSize: 11,
      fontWeight: 800,
      letterSpacing: '0.10em',
      textTransform: 'uppercase',
      color: 'var(--color-text-tertiary)',
      marginBottom: 8,
    }}>
      {label}
    </div>
  )
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      style={{
        width: 42,
        height: 24,
        borderRadius: 999,
        border: 'none',
        background: checked ? 'var(--gradient-primary)' : 'var(--color-surface-high)',
        position: 'relative',
        cursor: 'pointer',
        padding: 0,
      }}
    >
      <span style={{
        position: 'absolute',
        top: 3,
        left: checked ? 22 : 3,
        width: 18,
        height: 18,
        borderRadius: '50%',
        background: '#fff',
        transition: 'left 120ms',
      }} />
    </button>
  )
}

function SettingsRow({
  title,
  description,
  control,
  first = false,
  align = 'center',
}: {
  title: string
  description?: string
  control?: ReactNode
  first?: boolean
  align?: 'center' | 'start'
}) {
  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: align === 'start' ? 'flex-start' : 'center',
      justifyContent: 'space-between',
      gap: 14,
      padding: first ? '0 0 14px' : '14px 0',
      borderTop: first ? 'none' : '1px solid var(--color-border-ghost)',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 620, color: 'var(--color-text-primary)' }}>{title}</div>
        {description && (
          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 3, lineHeight: 1.55 }}>
            {description}
          </div>
        )}
      </div>
      {control && <div style={{ flexShrink: 0, maxWidth: '100%' }}>{control}</div>}
    </div>
  )
}

function StatusPill({
  label,
  tone = 'neutral',
}: {
  label: string
  tone?: 'neutral' | 'success' | 'warning' | 'error'
}) {
  const success = tone === 'success'
  const warning = tone === 'warning'
  const error = tone === 'error'
  const border = success
    ? '1px solid rgba(79, 219, 200, 0.24)'
    : warning
      ? '1px solid rgba(251, 191, 36, 0.24)'
      : error
        ? '1px solid rgba(248, 113, 113, 0.24)'
        : '1px solid var(--color-border-ghost)'
  const background = success
    ? 'rgba(79, 219, 200, 0.10)'
    : warning
      ? 'rgba(251, 191, 36, 0.10)'
      : error
        ? 'rgba(248, 113, 113, 0.10)'
        : 'var(--color-surface-low)'
  const color = success
    ? 'var(--color-focus-green)'
    : warning
      ? '#fbbf24'
      : error
        ? '#f87171'
        : 'var(--color-text-secondary)'

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '6px 10px',
        borderRadius: 999,
        border,
        background,
        color,
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}
    >
      {label}
    </span>
  )
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <div style={{
      display: 'inline-flex',
      gap: 3,
      padding: 3,
      borderRadius: 10,
      border: '1px solid var(--color-border-ghost)',
      background: 'var(--color-surface-high)',
    }}>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          onClick={() => onChange(option.value)}
          style={{
            padding: '5px 10px',
            borderRadius: 7,
            border: 'none',
            background: value === option.value ? 'var(--gradient-primary)' : 'transparent',
            color: value === option.value ? 'var(--color-primary-contrast)' : 'var(--color-text-secondary)',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function Select<T extends string>({
  value,
  options,
  onChange,
  width = 160,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
  width?: number
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      style={{
        width,
        height: 34,
        borderRadius: 9,
        border: '1px solid var(--color-border-ghost)',
        background: 'var(--color-surface-high)',
        color: 'var(--color-text-primary)',
        padding: '0 10px',
        outline: 'none',
        fontSize: 12.5,
      }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  )
}

const settingsSurfaceStyle: CSSProperties = {
  borderRadius: 28,
  border: '1px solid var(--color-border-ghost)',
  background: 'var(--color-surface)',
  overflow: 'hidden',
}

function SettingsSection({
  title,
  children,
  first = false,
}: {
  title: string
  children: ReactNode
  first?: boolean
}) {
  return (
    <section
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 28,
        padding: '26px 28px',
        borderTop: first ? 'none' : '1px solid var(--color-border-ghost)',
      }}
    >
      <div style={{ flex: '0 0 188px', maxWidth: 228 }}>
        {sectionTitle(title)}
      </div>
      <div style={{ flex: '1 1 560px', minWidth: 0, display: 'grid', gap: 18 }}>
        {children}
      </div>
    </section>
  )
}

function updateStatusLabel(status: UpdaterStatusInfo | null, version: string | null): string {
  if (!status) return 'Ready.'
  switch (status.status) {
    case 'checking':
      return 'Checking for updates…'
    case 'available':
      return `Daylens ${status.version ?? 'update'} is available — install when you want Daylens to download and replace the app.`
    case 'downloading':
      return typeof status.progressPct === 'number'
        ? `Downloading ${status.version ?? 'update'} — ${status.progressPct}%`
        : `Downloading ${status.version ?? 'update'}…`
    case 'downloaded':
      return `${status.version ?? 'Update'} ready to install. Restart to finish.`
    case 'installing':
      return `Installing ${status.version ?? 'update'} and relaunching…`
    case 'not-available':
      return version ? `You're on the latest version (${version}).` : 'No updates available.'
    case 'error':
      return status.errorMessage ?? 'Update check failed.'
    case 'idle':
    default:
      return version ? `Current version: ${version}.` : 'Ready.'
  }
}

function formatDurationShort(totalSeconds: number): string {
  if (totalSeconds >= 3600) return `${(totalSeconds / 3600).toFixed(totalSeconds >= 36_000 ? 0 : 1)}h`
  if (totalSeconds >= 60) return `${Math.round(totalSeconds / 60)}m`
  return `${Math.max(1, Math.round(totalSeconds))}s`
}

const inlineButtonStyle: CSSProperties = {
  height: 32,
  padding: '0 14px',
  borderRadius: 8,
  border: '1px solid var(--color-border-ghost)',
  background: 'var(--color-surface-high)',
  color: 'var(--color-text-primary)',
  fontSize: 12.5,
  fontWeight: 700,
  cursor: 'pointer',
}

const infoPanelStyle: CSSProperties = {
  marginTop: 14,
  padding: '14px 16px',
  borderRadius: 14,
  border: '1px solid var(--color-border-ghost)',
  background: 'var(--color-surface-low)',
  display: 'grid',
  gap: 8,
}

function UpdatesSection() {
  const [status, setStatus] = useState<UpdaterStatusInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const [currentVersion, setCurrentVersion] = useState<string | null>(null)

  useEffect(() => {
    void ipc.updater.getStatus().then((info) => {
      setStatus(info)
      if (info.version) setCurrentVersion((prev) => prev ?? info.version)
    })
    const cleanup = ipc.updater.onStatus((info) => setStatus(info))
    return cleanup
  }, [])

  async function handleCheck() {
    track(ANALYTICS_EVENT.UPDATE_CHECK_REQUESTED, {
      surface: 'settings',
      trigger: 'settings',
    })
    setChecking(true)
    try {
      const info = await ipc.updater.check()
      setStatus(info)
    } finally {
      setChecking(false)
    }
  }

  const isDownloaded = status?.status === 'downloaded'
  const isAvailableManual = status?.status === 'available' && !!status.downloadUrl
  const isBusy = checking || status?.status === 'checking' || status?.status === 'downloading' || status?.status === 'installing'

  return (
    <SettingsSection
      title="Updates"
    >
      <div>
        <SettingsRow
          first
          title="App updates"
          description={updateStatusLabel(status, currentVersion)}
          control={
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              {isDownloaded && (
                <button
                  type="button"
                  onClick={() => {
                    track(ANALYTICS_EVENT.UPDATE_INSTALL_REQUESTED, {
                      surface: 'settings',
                      trigger: 'settings',
                      version: status?.version ?? undefined,
                    })
                    void ipc.updater.install()
                  }}
                  style={{
                    height: 32,
                    padding: '0 14px',
                    borderRadius: 8,
                    border: 'none',
                    background: 'var(--gradient-primary)',
                    color: 'var(--color-primary-contrast)',
                    fontSize: 12.5,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Restart to install
                </button>
              )}
              {isAvailableManual && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      track(ANALYTICS_EVENT.UPDATE_INSTALL_REQUESTED, {
                        surface: 'settings',
                        trigger: 'settings',
                        version: status?.version ?? undefined,
                      })
                      void ipc.updater.install()
                    }}
                    style={{
                      height: 32,
                      padding: '0 14px',
                      borderRadius: 8,
                      border: 'none',
                      background: 'var(--gradient-primary)',
                      color: 'var(--color-primary-contrast)',
                      fontSize: 12.5,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Install update
                  </button>
                  {status?.downloadUrl && (
                    <button
                      type="button"
                      onClick={() => { ipc.shell.openExternal(status.downloadUrl as string) }}
                      style={{
                        height: 32,
                        padding: '0 14px',
                        borderRadius: 8,
                        border: '1px solid var(--color-border-ghost)',
                        background: 'var(--color-surface-high)',
                        color: 'var(--color-text-primary)',
                        fontSize: 12.5,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      Download manually
                    </button>
                  )}
                </>
              )}
              <button
                type="button"
                onClick={() => void handleCheck()}
                disabled={isBusy}
                style={{
                  height: 32,
                  padding: '0 14px',
                  borderRadius: 8,
                  border: '1px solid var(--color-border-ghost)',
                  background: 'var(--color-surface-high)',
                  color: 'var(--color-text-primary)',
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: isBusy ? 'default' : 'pointer',
                  opacity: isBusy ? 0.6 : 1,
                }}
              >
                {checking ? 'Checking…' : 'Check for updates'}
              </button>
            </div>
          }
        />
        {status?.supportMessage && (
          <div style={infoPanelStyle}>
            <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.65 }}>
              {status.supportMessage}
            </div>
          </div>
        )}
      </div>
    </SettingsSection>
  )
}

export default function Settings({ initialSettings = null }: { initialSettings?: AppSettings | null } = {}) {
  const [settings, setSettings] = useState<AppSettings | null>(initialSettings)
  const [hasApiKey, setHasApiKey] = useState(false)
  const [cliTools, setCliTools] = useState<{ claude: string | null; codex: string | null }>({ claude: null, codex: null })
  const [trackingDiagnostics, setTrackingDiagnostics] = useState<TrackingDiagnosticsPayload | null>(null)
  const [defaultUserName, setDefaultUserName] = useState('')
  const [recentApps, setRecentApps] = useState<AppUsageSummary[]>([])
  const [categoryOverrides, setCategoryOverrides] = useState<Record<string, AppCategory>>({})
  const [categoryBusyBundleId, setCategoryBusyBundleId] = useState<string | null>(null)
  const [workMemorySummary, setWorkMemorySummary] = useState<WorkMemorySettingsSummary | null>(null)
  const [workMemoryBusy, setWorkMemoryBusy] = useState<string | null>(null)
  const [workMemoryError, setWorkMemoryError] = useState<string | null>(null)
  const [mcpConfig, setMcpConfig] = useState<{ command: string; args: string[]; env: Record<string, string> } | null>(null)
  const [mcpSnippetCopied, setMcpSnippetCopied] = useState(false)
  const [clients, setClients] = useState<ClientRecord[]>([])
  const [clientsLoaded, setClientsLoaded] = useState(false)
  const [newClientName, setNewClientName] = useState('')
  const [newClientColor, setNewClientColor] = useState('#7c8cff')
  const [clientFormError, setClientFormError] = useState<string | null>(null)
  const [clientBusyId, setClientBusyId] = useState<string | null>(null)
  const [editingClientId, setEditingClientId] = useState<string | null>(null)
  const [editingClientName, setEditingClientName] = useState('')
  const [editingClientColor, setEditingClientColor] = useState('')

  useEffect(() => {
    let cancelled = false

    // Render the Settings shell as soon as `ipc.settings.get()` resolves.
    // Everything else (CLI detection, diagnostics, sync, summaries, overrides,
    // suggested name) is loaded in parallel afterwards so each section can
    // appear as soon as its own data is ready, without blocking first paint.
    void (async () => {
      // Reuse the settings App already loaded when available, so navigating to
      // Settings does not issue a second ipc.settings.get() round-trip (F56).
      const current = initialSettings ?? await ipc.settings.get()
      if (cancelled) return
      setSettings(current)

      // Optimistic AI-access guess based on persisted provider, refined below
      // when CLI detection or hasApiKey resolves.
      if (current.aiProvider !== 'claude-cli' && current.aiProvider !== 'codex-cli') {
        void ipc.settings.hasApiKey(current.aiProvider).then((access) => {
          if (!cancelled) setHasApiKey(access)
        })
      }

      void ipc.ai.detectCliTools().catch(() => ({ claude: null, codex: null })).then((tools) => {
        if (cancelled) return
        setCliTools(tools as { claude: string | null; codex: string | null })
      })
      void ipc.tracking.getDiagnostics().catch(() => null).then((tracking) => {
        if (!cancelled) setTrackingDiagnostics(tracking as TrackingDiagnosticsPayload | null)
      })
      void ipc.db.getAppSummaries(30).catch(() => []).then((summaries) => {
        if (cancelled) return
        setRecentApps((summaries as AppUsageSummary[])
          .filter((summary) => summary.totalSeconds > 0 && summary.bundleId)
          .sort((left, right) => right.totalSeconds - left.totalSeconds)
          .slice(0, 8))
      })
      void ipc.db.getCategoryOverrides().catch(() => ({})).then((overrides) => {
        if (!cancelled) setCategoryOverrides(overrides as Record<string, AppCategory>)
      })
      void ipc.db.getWorkMemorySummary().catch(() => null).then((summary) => {
        if (!cancelled) setWorkMemorySummary(summary as WorkMemorySettingsSummary | null)
      })
      void ipc.app.getDefaultUserName().catch(() => '').then((suggestedName) => {
        if (!cancelled) setDefaultUserName(String(suggestedName ?? ''))
      })
    })()

    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      if (document.hidden) return
      const next = await ipc.tracking.getDiagnostics().catch(() => null)
      if (!cancelled) setTrackingDiagnostics(next as TrackingDiagnosticsPayload | null)
    }
    const refreshWhenVisible = () => {
      if (!document.hidden) void refresh()
    }

    document.addEventListener('visibilitychange', refreshWhenVisible)
    const timer = window.setInterval(() => { void refresh() }, 5_000)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (!settings) return
    if (settings.aiProvider === 'claude-cli') {
      setHasApiKey(!!cliTools.claude)
      return
    }
    if (settings.aiProvider === 'codex-cli') {
      setHasApiKey(!!cliTools.codex)
      return
    }
    void ipc.settings.hasApiKey(settings.aiProvider).then((access) => setHasApiKey(access))
  }, [cliTools, settings?.aiProvider])

  useEffect(() => {
    if (!settings?.mcpServerEnabled) return
    void ipc.mcp.getConfig().then((cfg) => setMcpConfig(cfg))
  }, [settings?.mcpServerEnabled])

  async function persist(partial: Partial<AppSettings>) {
    if (!settings) return
    const next = { ...settings, ...partial }
    setSettings(next)
    await ipc.settings.set(partial)
    if ('mcpServerEnabled' in partial && partial.mcpServerEnabled) {
      const cfg = await ipc.mcp.getConfig()
      setMcpConfig(cfg)
    }
  }

  async function refreshWorkMemorySummary() {
    const summary = await ipc.db.getWorkMemorySummary()
    setWorkMemorySummary(summary)
    return summary
  }

  async function forgetWorkMemoryPattern(patternId: string, label: string) {
    if (!window.confirm(`Forget "${label}"?`)) return
    setWorkMemoryBusy(patternId)
    setWorkMemoryError(null)
    try {
      const summary = await ipc.db.forgetWorkMemoryPattern(patternId)
      setWorkMemorySummary(summary)
    } catch (error) {
      setWorkMemoryError(error instanceof Error ? error.message : String(error))
    } finally {
      setWorkMemoryBusy(null)
    }
  }

  async function forgetAllWorkMemory() {
    if (!window.confirm('Forget all work memory?')) return
    setWorkMemoryBusy('all')
    setWorkMemoryError(null)
    try {
      const summary = await ipc.db.forgetAllWorkMemory()
      setWorkMemorySummary(summary)
    } catch (error) {
      setWorkMemoryError(error instanceof Error ? error.message : String(error))
    } finally {
      setWorkMemoryBusy(null)
    }
  }

  // Triggers the one-time backfill from history. The IPC binding is owned by
  // the memory-backfill change (R4); the button calls it via optional-chained
  // access on the preload bridge so it degrades to a clear error if the
  // preload side hasn't shipped yet.
  async function rebuildWorkMemoryFromHistory() {
    if (!window.confirm('Rebuild work memory from your full history? This walks every tracked day and may take a moment.')) return
    setWorkMemoryBusy('backfill')
    setWorkMemoryError(null)
    try {
      const bridge = (window as unknown as { daylens?: { memory?: { backfill?: () => Promise<unknown> } } }).daylens
      const backfill = bridge?.memory?.backfill
      if (typeof backfill !== 'function') {
        throw new Error('Memory backfill is not available yet — restart Daylens after updating to enable it.')
      }
      await backfill()
      await refreshWorkMemorySummary()
    } catch (error) {
      setWorkMemoryError(error instanceof Error ? error.message : String(error))
    } finally {
      setWorkMemoryBusy(null)
    }
  }

  async function refreshAIAccess() {
    const current = await ipc.settings.get()
    const access = current.aiProvider === 'claude-cli'
      ? !!cliTools.claude
      : current.aiProvider === 'codex-cli'
        ? !!cliTools.codex
        : await ipc.settings.hasApiKey(current.aiProvider)
    setSettings(current)
    setHasApiKey(access)
  }

  async function handleCategoryOverrideChange(bundleId: string, category: AppCategory) {
    setCategoryBusyBundleId(bundleId)
    try {
      await ipc.db.setCategoryOverride(bundleId, category)
      setCategoryOverrides((current) => ({ ...current, [bundleId]: category }))
    } finally {
      setCategoryBusyBundleId(null)
    }
  }

  async function handleCategoryOverrideClear(bundleId: string) {
    setCategoryBusyBundleId(bundleId)
    try {
      await ipc.db.clearCategoryOverride(bundleId)
      setCategoryOverrides((current) => {
        const next = { ...current }
        delete next[bundleId]
        return next
      })
    } finally {
      setCategoryBusyBundleId(null)
    }
  }

  async function reloadClients() {
    const rows = await ipc.attribution.listClientsDetailed().catch(() => [] as ClientRecord[])
    setClients(rows)
    setClientsLoaded(true)
  }

  useEffect(() => {
    void reloadClients()
  }, [])

  async function handleCreateClient() {
    const name = newClientName.trim()
    if (!name) {
      setClientFormError('Name is required.')
      return
    }
    setClientFormError(null)
    setClientBusyId('__new__')
    try {
      await ipc.attribution.createClient({ name, color: newClientColor || null })
      setNewClientName('')
      setNewClientColor('#7c8cff')
      await reloadClients()
    } catch (error) {
      setClientFormError(error instanceof Error ? error.message : String(error))
    } finally {
      setClientBusyId(null)
    }
  }

  function startEditingClient(client: ClientRecord) {
    setEditingClientId(client.id)
    setEditingClientName(client.name)
    setEditingClientColor(client.color ?? '#7c8cff')
    setClientFormError(null)
  }

  function cancelEditingClient() {
    setEditingClientId(null)
    setEditingClientName('')
    setEditingClientColor('')
    setClientFormError(null)
  }

  async function handleSaveClient(id: string) {
    const name = editingClientName.trim()
    if (!name) {
      setClientFormError('Name is required.')
      return
    }
    setClientBusyId(id)
    try {
      await ipc.attribution.updateClient({ id, name, color: editingClientColor || null })
      setEditingClientId(null)
      await reloadClients()
    } catch (error) {
      setClientFormError(error instanceof Error ? error.message : String(error))
    } finally {
      setClientBusyId(null)
    }
  }

  async function handleArchiveClient(id: string) {
    setClientBusyId(id)
    try {
      await ipc.attribution.archiveClient(id)
      await reloadClients()
    } finally {
      setClientBusyId(null)
    }
  }

  async function handleRestoreClient(id: string) {
    setClientBusyId(id)
    try {
      await ipc.attribution.restoreClient(id)
      await reloadClients()
    } finally {
      setClientBusyId(null)
    }
  }

  if (!settings) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>Loading settings…</p>
      </div>
    )
  }

  const linuxDesktop = trackingDiagnostics?.linuxDesktop ?? null
  return (
    <div style={{ padding: '30px 32px 48px', maxWidth: 1080 }}>
      <div style={{ marginBottom: 24, maxWidth: 680 }}>
        <h1 style={{ fontSize: 32, lineHeight: 1.05, letterSpacing: '-0.03em', margin: 0, color: 'var(--color-text-primary)' }}>
          Settings
        </h1>
      </div>

      <div style={settingsSurfaceStyle}>
        <SettingsSection
          first
          title="Profile"
        >
          <SettingsRow
            first
            title="Display name"
            description="Used in the AI persona line. Leave blank if you prefer the generic Daylens voice."
            control={
              <input
                type="text"
                value={settings.userName}
                placeholder={defaultUserName || 'Your name'}
                maxLength={80}
                onChange={(event) => void persist({ userName: event.target.value })}
                style={inputStyle(240)}
              />
            }
          />
        </SettingsSection>

        <SettingsSection
          title="AI"
        >
          <ConnectAI
            variant="embedded"
            initialProvider={settings.aiProvider}
            hasSavedAccess={hasApiKey}
            onConnected={() => { void refreshAIAccess() }}
            onModelChange={() => { void refreshAIAccess() }}
          />
        </SettingsSection>

        <SettingsSection
          title="Work memory"
        >
          <div>
            <SettingsRow
              first
              title="Consolidate at end of day"
              description="Archives finalized blocks, promotes repeated patterns, and decays stale learned patterns."
              control={<Toggle checked={settings.workMemoryConsolidationEnabled ?? true} onChange={(value) => void persist({ workMemoryConsolidationEnabled: value })} />}
            />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
              <div style={infoPanelStyle}>
                <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>
                  Promoted patterns
                </div>
                <div style={{ fontSize: 22, fontWeight: 780, color: 'var(--color-text-primary)' }}>
                  {workMemorySummary?.promotedCount ?? 0}
                </div>
              </div>
              <div style={infoPanelStyle}>
                <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>
                  Total occurrences
                </div>
                <div style={{ fontSize: 22, fontWeight: 780, color: 'var(--color-text-primary)' }}>
                  {workMemorySummary?.totalOccurrences ?? 0}
                </div>
              </div>
            </div>

            <div style={{ ...infoPanelStyle, marginTop: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>
                  Top learned patterns
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setWorkMemoryError(null)
                    void refreshWorkMemorySummary().catch((error) => {
                      setWorkMemoryError(error instanceof Error ? error.message : String(error))
                    })
                  }}
                  style={inlineButtonStyle}
                >
                  Refresh
                </button>
              </div>
              {workMemoryError && (
                <div style={{ fontSize: 12, color: '#f87171', lineHeight: 1.55 }}>
                  {workMemoryError}
                </div>
              )}
              {workMemorySummary === null ? (
                <div style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)' }}>
                  Loading…
                </div>
              ) : workMemorySummary.topPatterns.length === 0 ? (
                <div style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)' }}>
                  No promoted work memory yet.
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 0 }}>
                  {workMemorySummary.topPatterns.map((pattern, index) => {
                    const busy = workMemoryBusy === pattern.id
                    return (
                      <div
                        key={pattern.id}
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 12,
                          padding: index === 0 ? '2px 0 12px' : '12px 0',
                          borderTop: index === 0 ? 'none' : '1px solid var(--color-border-ghost)',
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 680, color: 'var(--color-text-primary)' }}>
                            {pattern.label}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 3 }}>
                            {Math.round(pattern.confidence * 100)}% confidence · {pattern.recallCount} recalls · {pattern.occurrenceCount} occurrences{pattern.category ? ` · ${pattern.category}` : ''}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={busy || workMemoryBusy === 'all'}
                          onClick={() => void forgetWorkMemoryPattern(pattern.id, pattern.label)}
                          style={{
                            ...inlineButtonStyle,
                            color: '#f87171',
                            opacity: busy || workMemoryBusy === 'all' ? 0.6 : 1,
                            cursor: busy || workMemoryBusy === 'all' ? 'default' : 'pointer',
                          }}
                        >
                          {busy ? 'Forgetting…' : 'Forget'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
              <div style={{ paddingTop: 12, borderTop: '1px solid var(--color-border-ghost)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  disabled={workMemoryBusy !== null}
                  onClick={() => void rebuildWorkMemoryFromHistory()}
                  style={{
                    ...inlineButtonStyle,
                    opacity: workMemoryBusy !== null ? 0.6 : 1,
                    cursor: workMemoryBusy !== null ? 'default' : 'pointer',
                  }}
                >
                  {workMemoryBusy === 'backfill' ? 'Rebuilding…' : 'Rebuild memory from history'}
                </button>
                <button
                  type="button"
                  disabled={workMemoryBusy !== null || (workMemorySummary?.promotedCount ?? 0) === 0}
                  onClick={() => void forgetAllWorkMemory()}
                  style={{
                    ...inlineButtonStyle,
                    borderColor: 'rgba(248, 113, 113, 0.28)',
                    color: '#f87171',
                    opacity: workMemoryBusy !== null || (workMemorySummary?.promotedCount ?? 0) === 0 ? 0.6 : 1,
                    cursor: workMemoryBusy !== null || (workMemorySummary?.promotedCount ?? 0) === 0 ? 'default' : 'pointer',
                  }}
                >
                  {workMemoryBusy === 'all' ? 'Forgetting…' : 'Forget everything'}
                </button>
              </div>
            </div>
          </div>
        </SettingsSection>

        <SettingsSection
          title="Labels"
        >
          <div>
            {recentApps.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)', lineHeight: 1.6 }}>
                Needs a little more tracked history first.
              </div>
            ) : (
              recentApps.map((summary, index) => {
                const override = categoryOverrides[summary.bundleId]
                const effectiveCategory = override ?? summary.category
                const busy = categoryBusyBundleId === summary.bundleId
                return (
                  <SettingsRow
                    key={summary.bundleId}
                    first={index === 0}
                    title={summary.appName}
                    description={`${formatDurationShort(summary.totalSeconds)} over 30 days${override ? ` · override: ${CATEGORY_OPTIONS.find((option) => option.value === override)?.label ?? override}` : ''}`}
                    control={
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                        <Select<AppCategory>
                          value={effectiveCategory}
                          width={150}
                          options={CATEGORY_OPTIONS}
                          onChange={(value) => void handleCategoryOverrideChange(summary.bundleId, value)}
                        />
                        {override && (
                          <button
                            type="button"
                            onClick={() => void handleCategoryOverrideClear(summary.bundleId)}
                            disabled={busy}
                            style={{ ...inlineButtonStyle, opacity: busy ? 0.6 : 1, cursor: busy ? 'default' : 'pointer' }}
                          >
                            Reset
                          </button>
                        )}
                      </div>
                    }
                  />
                )
              })
            )}
          </div>
        </SettingsSection>

        <SettingsSection
          title="Clients"
        >
          <div>
            <div style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)', lineHeight: 1.6, marginBottom: 14 }}>
              Track work for specific clients or projects. Once a client exists, Daylens can resolve names like it in AI questions ("how much did I work on X this week") and attribute work sessions to it.
            </div>

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 8,
                padding: '12px 14px',
                borderRadius: 12,
                border: '1px solid var(--color-border-ghost)',
                background: 'var(--color-surface-low)',
                marginBottom: 14,
              }}
            >
              <input
                type="text"
                placeholder="New client name"
                value={newClientName}
                onChange={(event) => setNewClientName(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void handleCreateClient() }}
                style={inputStyle(220)}
              />
              <input
                type="color"
                value={newClientColor}
                onChange={(event) => setNewClientColor(event.target.value)}
                style={{ width: 36, height: 34, padding: 0, border: '1px solid var(--color-border-ghost)', borderRadius: 8, background: 'transparent', cursor: 'pointer' }}
                aria-label="Client color"
              />
              <button
                type="button"
                onClick={() => void handleCreateClient()}
                disabled={clientBusyId === '__new__' || !newClientName.trim()}
                style={{
                  ...inlineButtonStyle,
                  opacity: clientBusyId === '__new__' || !newClientName.trim() ? 0.5 : 1,
                  cursor: clientBusyId === '__new__' || !newClientName.trim() ? 'default' : 'pointer',
                }}
              >
                {clientBusyId === '__new__' ? 'Adding…' : 'Add client'}
              </button>
              {clientFormError && (
                <div style={{ flexBasis: '100%', fontSize: 12, color: 'var(--color-focus-amber, #d97706)' }}>{clientFormError}</div>
              )}
            </div>

            {!clientsLoaded ? (
              <div style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)' }}>Loading clients…</div>
            ) : clients.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)', lineHeight: 1.6 }}>
                No clients yet. Add one above.
              </div>
            ) : (
              clients.map((client, index) => {
                const isEditing = editingClientId === client.id
                const busy = clientBusyId === client.id
                const archived = client.status === 'archived'
                return (
                  <SettingsRow
                    key={client.id}
                    first={index === 0}
                    title={isEditing ? '' : client.name}
                    description={isEditing
                      ? ''
                      : `${client.projectCount} project${client.projectCount === 1 ? '' : 's'}${archived ? ' · archived' : ''}`}
                    control={
                      isEditing ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                          <input
                            type="text"
                            value={editingClientName}
                            onChange={(event) => setEditingClientName(event.target.value)}
                            style={inputStyle(180)}
                          />
                          <input
                            type="color"
                            value={editingClientColor || '#7c8cff'}
                            onChange={(event) => setEditingClientColor(event.target.value)}
                            style={{ width: 36, height: 34, padding: 0, border: '1px solid var(--color-border-ghost)', borderRadius: 8, background: 'transparent', cursor: 'pointer' }}
                            aria-label="Client color"
                          />
                          <button
                            type="button"
                            onClick={() => void handleSaveClient(client.id)}
                            disabled={busy}
                            style={{ ...inlineButtonStyle, opacity: busy ? 0.6 : 1, cursor: busy ? 'default' : 'pointer' }}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={cancelEditingClient}
                            disabled={busy}
                            style={{ ...inlineButtonStyle, opacity: busy ? 0.6 : 1, cursor: busy ? 'default' : 'pointer' }}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {client.color && (
                            <span
                              style={{
                                width: 12,
                                height: 12,
                                borderRadius: 4,
                                background: client.color,
                                border: '1px solid var(--color-border-ghost)',
                              }}
                              aria-hidden
                            />
                          )}
                          {!archived && (
                            <button
                              type="button"
                              onClick={() => startEditingClient(client)}
                              disabled={busy}
                              style={{ ...inlineButtonStyle, opacity: busy ? 0.6 : 1, cursor: busy ? 'default' : 'pointer' }}
                            >
                              Edit
                            </button>
                          )}
                          {archived ? (
                            <button
                              type="button"
                              onClick={() => void handleRestoreClient(client.id)}
                              disabled={busy}
                              style={{ ...inlineButtonStyle, opacity: busy ? 0.6 : 1, cursor: busy ? 'default' : 'pointer' }}
                            >
                              Restore
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void handleArchiveClient(client.id)}
                              disabled={busy}
                              style={{ ...inlineButtonStyle, opacity: busy ? 0.6 : 1, cursor: busy ? 'default' : 'pointer' }}
                            >
                              Archive
                            </button>
                          )}
                        </div>
                      )
                    }
                  />
                )
              })
            )}
          </div>
        </SettingsSection>

        <SettingsSection
          title="Notifications"
        >
          <div>
            <SettingsRow
              first
              title="Evening wrap"
              description="End-of-day recap of what you worked on."
              control={<Toggle checked={settings.dailySummaryEnabled ?? true} onChange={(value) => void persist({ dailySummaryEnabled: value })} />}
            />
            <SettingsRow
              title="Morning brief"
              description="Short morning recap of yesterday and the day ahead."
              control={<Toggle checked={settings.morningNudgeEnabled ?? true} onChange={(value) => void persist({ morningNudgeEnabled: value })} />}
            />
            <SettingsRow
              title="Distraction alerts"
              description="Warn when a focus session drifts."
              control={<Toggle checked={settings.distractionAlertsEnabled ?? false} onChange={(value) => void persist({ distractionAlertsEnabled: value })} />}
            />
            <SettingsRow
              title="Distraction threshold (minutes)"
              control={
                <input
                  type="number"
                  min={1}
                  max={60}
                  step={1}
                  value={settings.distractionAlertThresholdMinutes ?? 10}
                  onChange={(event) => {
                    const minutes = Math.max(1, Number(event.target.value) || 10)
                    void persist({ distractionAlertThresholdMinutes: minutes })
                    void ipc.distractionAlerter.setThreshold({ minutes })
                  }}
                  style={inputStyle(72)}
                />
              }
            />
            {trackingDiagnostics?.platform === 'linux' && linuxDesktop && !linuxDesktop.notificationSupported && (
              <div style={infoPanelStyle}>
                <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.65 }}>
                  Desktop notifications are unavailable in this Linux session right now, so Daylens can keep tracking but distraction alerts and recaps may not surface as native notifications until the session notification service is available.
                </div>
              </div>
            )}
          </div>
        </SettingsSection>

        <SettingsSection
          title="Appearance"
        >
          <div>
            <SettingsRow
              first
              align="start"
              title="Theme"
              description="Follow the system, or pin to light or dark."
              control={
                <Segmented<AppTheme>
                  value={settings.theme}
                  options={[
                    { value: 'system', label: 'System' },
                    { value: 'light', label: 'Light' },
                    { value: 'dark', label: 'Dark' },
                  ]}
                  onChange={(value) => {
                    void persist({ theme: value })
                    window.dispatchEvent(new CustomEvent('daylens:theme-changed', { detail: value }))
                  }}
                />
              }
            />
          </div>
        </SettingsSection>

        <UpdatesSection />

        <SettingsSection
          title="MCP Server"
        >
          <div>
            <SettingsRow
              first
              title="Enable MCP server"
              description="Lets Claude Desktop, Cursor, or Claude Code query your local activity data. Off by default."
              control={
                <Toggle
                  checked={settings.mcpServerEnabled ?? false}
                  onChange={(value) => void persist({ mcpServerEnabled: value })}
                />
              }
            />
            {(settings.mcpServerEnabled ?? false) && mcpConfig && (
              <div style={{ paddingTop: 14, borderTop: '1px solid var(--color-border-ghost)' }}>
                <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', marginBottom: 8, lineHeight: 1.55 }}>
                  Add the following to your MCP client config (Claude Desktop: <code style={{ fontSize: 11.5 }}>~/Library/Application Support/Claude/claude_desktop_config.json</code>):
                </div>
                <div style={{ position: 'relative' }}>
                  <pre style={{
                    fontSize: 11.5,
                    lineHeight: 1.6,
                    background: 'var(--color-surface-low)',
                    border: '1px solid var(--color-border-ghost)',
                    borderRadius: 8,
                    padding: '10px 12px',
                    overflowX: 'auto',
                    margin: 0,
                    color: 'var(--color-text-primary)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                  }}>
                    {JSON.stringify({
                      mcpServers: {
                        daylens: {
                          command: mcpConfig.command,
                          args: mcpConfig.args,
                          env: mcpConfig.env,
                        },
                      },
                    }, null, 2)}
                  </pre>
                  <button
                    type="button"
                    onClick={() => {
                      const snippet = JSON.stringify({
                        mcpServers: {
                          daylens: {
                            command: mcpConfig.command,
                            args: mcpConfig.args,
                            env: mcpConfig.env,
                          },
                        },
                      }, null, 2)
                      void navigator.clipboard.writeText(snippet).then(() => {
                        setMcpSnippetCopied(true)
                        setTimeout(() => setMcpSnippetCopied(false), 2000)
                      })
                    }}
                    style={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      height: 26,
                      padding: '0 10px',
                      borderRadius: 6,
                      border: '1px solid var(--color-border-ghost)',
                      background: 'var(--color-surface-high)',
                      color: 'var(--color-text-secondary)',
                      fontSize: 11.5,
                      cursor: 'pointer',
                    }}
                  >
                    {mcpSnippetCopied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', marginTop: 8, lineHeight: 1.55 }}>
                  After updating the config, restart your MCP client for the changes to take effect.
                </div>
              </div>
            )}
          </div>
        </SettingsSection>

        <SettingsSection
          title="Privacy"
        >
          <div>
            <SettingsRow
              first
              title="Analytics"
              description="Anonymous product telemetry."
              control={<Toggle checked={settings.analyticsOptIn} onChange={(value) => void persist({ analyticsOptIn: value })} />}
            />
            <SettingsRow
              title="Local data"
              description="Tracked history lives in the local Daylens database."
              control={<StatusPill label="Local only" />}
            />
          </div>
        </SettingsSection>
      </div>
    </div>
  )
}

function inputStyle(width = 220): CSSProperties {
  return {
    width,
    height: 34,
    borderRadius: 9,
    border: '1px solid var(--color-border-ghost)',
    background: 'var(--color-surface-high)',
    color: 'var(--color-text-primary)',
    padding: '0 12px',
    outline: 'none',
    fontSize: 12.5,
  }
}
