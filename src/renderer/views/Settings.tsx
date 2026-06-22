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
  WorkMemoryFact,
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

// T3 — Tracking Controls. Opt-in, off by default. Pause works regardless of the
// master switch. Adding an exclusion also deletes that app/site's existing
// history so it disappears from the timeline/Apps/AI/search.
function ExclusionEditor({
  label,
  placeholder,
  values,
  onAdd,
  onRemove,
  busy,
}: {
  label: string
  placeholder: string
  values: string[]
  onAdd: (value: string) => void
  onRemove: (value: string) => void
  busy: boolean
}) {
  const [draft, setDraft] = useState('')
  const submit = () => {
    const value = draft.trim()
    if (!value) return
    onAdd(value)
    setDraft('')
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 13.5, fontWeight: 620, color: 'var(--color-text-primary)' }}>{label}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
          placeholder={placeholder}
          disabled={busy}
          style={{ flex: 1, minWidth: 0, height: 34, padding: '0 12px', borderRadius: 9, border: '1px solid var(--color-border-ghost)', background: 'var(--color-surface)', color: 'var(--color-text-primary)', fontSize: 12.5, outline: 'none' }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy || !draft.trim()}
          style={{ height: 34, padding: '0 14px', borderRadius: 9, border: '1px solid var(--color-border-ghost)', background: 'var(--color-surface)', color: 'var(--color-text-primary)', fontSize: 12.5, fontWeight: 700, cursor: busy || !draft.trim() ? 'default' : 'pointer', opacity: busy || !draft.trim() ? 0.6 : 1 }}
        >
          Add
        </button>
      </div>
      {values.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {values.map((value) => (
            <span key={value} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 6px 4px 10px', borderRadius: 999, background: 'var(--color-surface-muted)', border: '1px solid var(--color-border-ghost)', fontSize: 12, color: 'var(--color-text-secondary)' }}>
              {value}
              <button
                type="button"
                onClick={() => onRemove(value)}
                aria-label={`Remove ${value}`}
                style={{ width: 18, height: 18, borderRadius: '50%', border: 'none', background: 'transparent', color: 'var(--color-text-tertiary)', cursor: 'pointer', display: 'grid', placeItems: 'center', fontSize: 14, lineHeight: 1 }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function TrackingControlsSection({
  settings,
  persist,
}: {
  settings: AppSettings
  persist: (partial: Partial<AppSettings>) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const enabled = settings.trackingControlsEnabled ?? false
  const excludedApps = settings.trackingExcludedApps ?? []
  const excludedSites = settings.trackingExcludedSites ?? []

  const normalizeSite = (raw: string) => raw.trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')

  const addApp = async (value: string) => {
    if (excludedApps.some((a) => a.toLowerCase() === value.toLowerCase())) return
    setBusy(true)
    try {
      await persist({ trackingExcludedApps: [...excludedApps, value] })
      // Remove what was already captured so it disappears from history, not just future capture.
      await ipc.tracking.deleteAppHistory({ bundleId: value, appName: value }).catch(() => {})
    } finally {
      setBusy(false)
    }
  }
  const removeApp = (value: string) => void persist({ trackingExcludedApps: excludedApps.filter((a) => a !== value) })

  const addSite = async (raw: string) => {
    const value = normalizeSite(raw)
    if (!value || excludedSites.some((s) => s.toLowerCase() === value)) return
    setBusy(true)
    try {
      await persist({ trackingExcludedSites: [...excludedSites, value] })
      await ipc.tracking.deleteSiteHistory({ domain: value }).catch(() => {})
    } finally {
      setBusy(false)
    }
  }
  const removeSite = (value: string) => void persist({ trackingExcludedSites: excludedSites.filter((s) => s !== value) })

  return (
    <SettingsSection title="Tracking controls">
      <SettingsRow
        first
        title="Pause tracking"
        description="Temporarily stop recording all activity. Stays paused until you turn it back on, even after a restart."
        control={<Toggle checked={settings.trackingPaused ?? false} onChange={(value) => void persist({ trackingPaused: value })} />}
      />
      <SettingsRow
        title="Limit what's tracked"
        description="Off by default — Daylens records everything. Turn this on to keep specific apps, sites, and private windows out of your history and AI answers."
        control={<Toggle checked={enabled} onChange={(value) => void persist({ trackingControlsEnabled: value })} />}
      />
      {enabled && (
        <>
          <SettingsRow
            title="Skip private / incognito windows"
            description="When on, Daylens records nothing from a browser's incognito or private window — no URL, page title, or session."
            control={<Toggle checked={settings.trackingSkipIncognito ?? true} onChange={(value) => void persist({ trackingSkipIncognito: value })} />}
          />
          <ExclusionEditor
            label="Excluded apps"
            placeholder="App name (e.g. Messages) or bundle id"
            values={excludedApps}
            onAdd={(value) => void addApp(value)}
            onRemove={removeApp}
            busy={busy}
          />
          <ExclusionEditor
            label="Excluded sites"
            placeholder="Domain (e.g. youtube.com)"
            values={excludedSites}
            onAdd={(value) => void addSite(value)}
            onRemove={removeSite}
            busy={busy}
          />
        </>
      )}
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
  // The full app list can be long, so keep Labels tidy: show a handful by default,
  // expand to reveal the rest, and let a search jump straight to any app (DEV-102).
  const [labelsExpanded, setLabelsExpanded] = useState(false)
  const [labelSearch, setLabelSearch] = useState('')
  // What the last relabel touched, shown inline so a change is never silent.
  const [relabelEffect, setRelabelEffect] = useState<{ bundleId: string; message: string } | null>(null)
  const [workMemoryProfile, setWorkMemoryProfile] = useState<WorkMemoryFact[] | null>(null)
  const [workMemoryBusy, setWorkMemoryBusy] = useState<string | null>(null)
  const [workMemoryError, setWorkMemoryError] = useState<string | null>(null)
  const [workMemoryChange, setWorkMemoryChange] = useState<string | null>(null)
  // Inline edit buffers, keyed by fact id; plus the "add a fact" draft.
  const [factDrafts, setFactDrafts] = useState<Record<string, string>>({})
  const [newFactText, setNewFactText] = useState('')
  const [mcpConfig, setMcpConfig] = useState<{ command: string; args: string[]; env: Record<string, string>; isPackaged: boolean; dbPath: string } | null>(null)
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
      // Every app the user has used — including uncategorized ones — so any app
      // (e.g. Zen) is reachable and categorizable (settings spec §4, invariant #3).
      // Not capped or windowed like the Apps view.
      void ipc.db.getAllAppsForLabeling().catch(() => []).then((summaries) => {
        if (cancelled) return
        setRecentApps((summaries as AppUsageSummary[]).filter((summary) => summary.bundleId))
      })
      void ipc.db.getCategoryOverrides().catch(() => ({})).then((overrides) => {
        if (!cancelled) setCategoryOverrides(overrides as Record<string, AppCategory>)
      })
      void ipc.db.getWorkMemoryProfile().catch(() => ({ facts: [] })).then((profile) => {
        if (!cancelled) setWorkMemoryProfile(profile.facts)
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

  // Save an inline edit to a fact. A hand edit becomes a correction (the backend
  // flips its origin to 'user') that a rebuild never overwrites.
  async function saveWorkMemoryFact(id: string) {
    const text = (factDrafts[id] ?? '').trim()
    if (!text) return
    setWorkMemoryBusy(id)
    setWorkMemoryError(null)
    try {
      const profile = await ipc.db.updateWorkMemoryFact(id, text)
      setWorkMemoryProfile(profile.facts)
      setFactDrafts((current) => {
        const next = { ...current }
        delete next[id]
        return next
      })
      setWorkMemoryChange('Saved — the AI will use this the next time it talks about you.')
    } catch (error) {
      setWorkMemoryError(error instanceof Error ? error.message : String(error))
    } finally {
      setWorkMemoryBusy(null)
    }
  }

  async function addWorkMemoryFact() {
    const text = newFactText.trim()
    if (!text) return
    setWorkMemoryBusy('add')
    setWorkMemoryError(null)
    try {
      const profile = await ipc.db.addWorkMemoryFact(text)
      setWorkMemoryProfile(profile.facts)
      setNewFactText('')
      setWorkMemoryChange('Added — the AI will use this the next time it talks about you.')
    } catch (error) {
      setWorkMemoryError(error instanceof Error ? error.message : String(error))
    } finally {
      setWorkMemoryBusy(null)
    }
  }

  async function forgetWorkMemoryFact(id: string) {
    setWorkMemoryBusy(id)
    setWorkMemoryError(null)
    try {
      const result = await ipc.db.forgetWorkMemoryFact(id)
      setWorkMemoryProfile(result.facts)
      setWorkMemoryChange(result.changeSummary)
    } catch (error) {
      setWorkMemoryError(error instanceof Error ? error.message : String(error))
    } finally {
      setWorkMemoryBusy(null)
    }
  }

  // Re-draft the profile from current evidence, keeping hand edits, and report
  // what changed in one line.
  async function rebuildWorkMemory() {
    setWorkMemoryBusy('rebuild')
    setWorkMemoryError(null)
    try {
      const result = await ipc.db.rebuildWorkMemory()
      setWorkMemoryProfile(result.facts)
      setWorkMemoryChange(result.changeSummary)
    } catch (error) {
      setWorkMemoryError(error instanceof Error ? error.message : String(error))
    } finally {
      setWorkMemoryBusy(null)
    }
  }

  async function forgetAllWorkMemory() {
    if (!window.confirm('Forget everything Daylens has learned about you?')) return
    setWorkMemoryBusy('all')
    setWorkMemoryError(null)
    try {
      await ipc.db.forgetAllWorkMemory()
      const profile = await ipc.db.getWorkMemoryProfile()
      setWorkMemoryProfile(profile.facts)
      setWorkMemoryChange('Forgot everything Daylens had learned about you.')
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
      const effect = await ipc.db.setCategoryOverride(bundleId, category)
      setCategoryOverrides((current) => ({ ...current, [bundleId]: category }))
      // Report what it touched — never change silently (settings spec §4).
      const days = effect?.daysAffected ?? 0
      setRelabelEffect({
        bundleId,
        message: days > 0
          ? `Updated ${days} ${days === 1 ? 'day' : 'days'} of activity — Apps, Timeline and the AI now read this label.`
          : 'Saved — new activity for this app will use this label.',
      })
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
      setRelabelEffect((current) => (current?.bundleId === bundleId ? null : current))
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
            <div style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)', lineHeight: 1.6, marginBottom: 14 }}>
              What Daylens knows about you, in plain language. Edit any line, add a fact it couldn't infer, or
              delete one that's wrong — your edits win and the AI uses them everywhere it talks about you.
            </div>

            {workMemoryError && (
              <div style={{ fontSize: 12, color: '#f87171', lineHeight: 1.55, marginBottom: 10 }}>
                {workMemoryError}
              </div>
            )}
            {workMemoryChange && (
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.55, marginBottom: 10 }}>
                {workMemoryChange}
              </div>
            )}

            {workMemoryProfile === null ? (
              <div style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)' }}>Loading…</div>
            ) : workMemoryProfile.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)', lineHeight: 1.6 }}>
                Nothing learned yet. Use Rebuild below once Daylens has some tracked history, or add a fact by hand.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {workMemoryProfile.map((fact) => {
                  const draft = factDrafts[fact.id]
                  const isEditing = draft !== undefined
                  const busy = workMemoryBusy === fact.id
                  // Any in-flight work-memory mutation disables every control, so
                  // two writes can't race and clobber each other's returned state.
                  const anyBusy = workMemoryBusy !== null
                  return (
                    <div key={fact.id} style={{ ...infoPanelStyle, display: 'grid', gap: 8 }}>
                      <textarea
                        value={isEditing ? draft : fact.text}
                        onChange={(event) => setFactDrafts((current) => ({ ...current, [fact.id]: event.target.value }))}
                        rows={2}
                        style={{
                          width: '100%',
                          resize: 'vertical',
                          fontSize: 13.5,
                          lineHeight: 1.5,
                          color: 'var(--color-text-primary)',
                          background: 'transparent',
                          border: '1px solid var(--color-border-ghost)',
                          borderRadius: 8,
                          padding: '8px 10px',
                          fontFamily: 'inherit',
                          boxSizing: 'border-box',
                        }}
                      />
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        {fact.origin === 'user' && (
                          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>Edited by you</span>
                        )}
                        <div style={{ flex: 1 }} />
                        {isEditing && (
                          <button
                            type="button"
                            disabled={anyBusy}
                            onClick={() => void saveWorkMemoryFact(fact.id)}
                            style={{ ...inlineButtonStyle, opacity: anyBusy ? 0.6 : 1, cursor: anyBusy ? 'default' : 'pointer' }}
                          >
                            {busy ? 'Saving…' : 'Save'}
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={anyBusy}
                          onClick={() => void forgetWorkMemoryFact(fact.id)}
                          style={{ ...inlineButtonStyle, color: '#f87171', opacity: anyBusy ? 0.6 : 1, cursor: anyBusy ? 'default' : 'pointer' }}
                        >
                          {busy ? 'Forgetting…' : 'Forget'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <div style={{ ...infoPanelStyle, marginTop: 10, display: 'grid', gap: 8 }}>
              <textarea
                value={newFactText}
                onChange={(event) => setNewFactText(event.target.value)}
                rows={2}
                placeholder="Add a fact Daylens couldn't infer — e.g. “Acme is my biggest client.”"
                style={{
                  width: '100%',
                  resize: 'vertical',
                  fontSize: 13.5,
                  lineHeight: 1.5,
                  color: 'var(--color-text-primary)',
                  background: 'transparent',
                  border: '1px solid var(--color-border-ghost)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  disabled={workMemoryBusy !== null || newFactText.trim() === ''}
                  onClick={() => void addWorkMemoryFact()}
                  style={{
                    ...inlineButtonStyle,
                    opacity: workMemoryBusy !== null || newFactText.trim() === '' ? 0.6 : 1,
                    cursor: workMemoryBusy !== null || newFactText.trim() === '' ? 'default' : 'pointer',
                  }}
                >
                  {workMemoryBusy === 'add' ? 'Adding…' : 'Add fact'}
                </button>
              </div>
            </div>

            <div style={{ paddingTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={workMemoryBusy !== null}
                onClick={() => void rebuildWorkMemory()}
                style={{
                  ...inlineButtonStyle,
                  opacity: workMemoryBusy !== null ? 0.6 : 1,
                  cursor: workMemoryBusy !== null ? 'default' : 'pointer',
                }}
              >
                {workMemoryBusy === 'rebuild' ? 'Rebuilding…' : 'Rebuild from recent activity'}
              </button>
              <button
                type="button"
                disabled={workMemoryBusy !== null || (workMemoryProfile?.length ?? 0) === 0}
                onClick={() => void forgetAllWorkMemory()}
                style={{
                  ...inlineButtonStyle,
                  borderColor: 'rgba(248, 113, 113, 0.28)',
                  color: '#f87171',
                  opacity: workMemoryBusy !== null || (workMemoryProfile?.length ?? 0) === 0 ? 0.6 : 1,
                  cursor: workMemoryBusy !== null || (workMemoryProfile?.length ?? 0) === 0 ? 'default' : 'pointer',
                }}
              >
                {workMemoryBusy === 'all' ? 'Forgetting…' : 'Forget everything'}
              </button>
            </div>
          </div>
        </SettingsSection>

        <SettingsSection
          title="Labels"
        >
          {(() => {
            const COLLAPSED_COUNT = 5
            const query = labelSearch.trim().toLowerCase()
            const searching = query.length > 0
            const matchedApps = searching
              ? recentApps.filter((summary) => summary.appName.toLowerCase().includes(query))
              : recentApps
            // When searching, show every match. Otherwise show the most-used handful
            // until the list is expanded, so Settings opens scannable.
            const visibleApps = searching || labelsExpanded
              ? matchedApps
              : matchedApps.slice(0, COLLAPSED_COUNT)
            return (
          <div>
            {recentApps.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)', lineHeight: 1.6 }}>
                Needs a little more tracked history first.
              </div>
            ) : (
              <>
                {recentApps.length > COLLAPSED_COUNT && (
                  <input
                    type="text"
                    value={labelSearch}
                    onChange={(event) => setLabelSearch(event.target.value)}
                    placeholder="Search apps to label…"
                    aria-label="Search apps"
                    style={{
                      width: '100%',
                      height: 34,
                      marginBottom: 14,
                      padding: '0 12px',
                      borderRadius: 8,
                      border: '1px solid var(--color-border-ghost)',
                      background: 'var(--color-surface-high)',
                      color: 'var(--color-text-primary)',
                      fontSize: 12.5,
                      boxSizing: 'border-box',
                    }}
                  />
                )}
                {visibleApps.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)', lineHeight: 1.6 }}>
                    No apps match “{labelSearch.trim()}”.
                  </div>
                ) : (
                  visibleApps.map((summary, index) => {
                const appIdentity = summary.canonicalAppId ?? summary.bundleId
                const override = categoryOverrides[appIdentity] ?? categoryOverrides[summary.bundleId]
                const effectiveCategory = override ?? summary.category
                const busy = categoryBusyBundleId === appIdentity
                const effectMessage = relabelEffect?.bundleId === appIdentity ? relabelEffect.message : null
                return (
                  <div key={appIdentity}>
                    <SettingsRow
                      first={index === 0}
                      title={summary.appName}
                      description={`${formatDurationShort(summary.totalSeconds)} over 30 days${override ? ` · override: ${CATEGORY_OPTIONS.find((option) => option.value === override)?.label ?? override}` : ''}`}
                      control={
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                          <Select<AppCategory>
                            value={effectiveCategory}
                            width={150}
                            options={CATEGORY_OPTIONS}
                            onChange={(value) => void handleCategoryOverrideChange(appIdentity, value)}
                          />
                          {override && (
                            <button
                              type="button"
                              onClick={() => void handleCategoryOverrideClear(appIdentity)}
                              disabled={busy}
                              style={{ ...inlineButtonStyle, opacity: busy ? 0.6 : 1, cursor: busy ? 'default' : 'pointer' }}
                            >
                              Reset
                            </button>
                          )}
                        </div>
                      }
                    />
                    {effectMessage && (
                      <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', padding: '0 0 10px 2px', lineHeight: 1.5 }}>
                        {effectMessage}
                      </div>
                    )}
                  </div>
                )
                  })
                )}
                {!searching && recentApps.length > COLLAPSED_COUNT && (
                  <button
                    type="button"
                    onClick={() => setLabelsExpanded((value) => !value)}
                    style={{ ...inlineButtonStyle, marginTop: 12, alignSelf: 'flex-start' }}
                  >
                    {labelsExpanded ? 'Show less' : `Show all ${recentApps.length} apps`}
                  </button>
                )}
              </>
            )}
          </div>
            )
          })()}
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
                  Reads <code style={{ fontSize: 11 }}>{mcpConfig.dbPath}</code> — your real local database.
                </div>
                {!mcpConfig.isPackaged && (
                  <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', marginTop: 6, lineHeight: 1.55 }}>
                    Dev build — the paths above point at your source checkout. A packaged install runs the bundled
                    server from inside the app and ships with this server off by default.
                  </div>
                )}
                <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', marginTop: 6, lineHeight: 1.55 }}>
                  After updating the config, restart your MCP client for the changes to take effect.
                </div>
              </div>
            )}
          </div>
        </SettingsSection>

        <TrackingControlsSection settings={settings} persist={persist} />

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
