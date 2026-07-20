// Settings → Agent file access (DEV-184): the three-state model made visible.
// Granted paths per state with revoke (revocation deletes derived text),
// an explicit statement of what is always denied, and the recent-disclosures
// log — every file the AI actually opened, with version fingerprint and
// excerpt range.
import { useCallback, useEffect, useState } from 'react'
import { ipc } from '../../lib/ipc'

interface Grant {
  id: string
  scope_kind: 'file' | 'folder'
  path: string
  state: 'indexed' | 'model_readable'
  allow_high_sensitivity: number
  source: 'settings' | 'chat'
  created_at: number
  revoked_at: number | null
}

interface Disclosure {
  id: string
  thread_id: number | null
  file_path: string
  display_name: string
  version_fingerprint: string
  excerpt_start: number
  excerpt_end: number
  reason: string
  destination: string
  disclosed_at: number
}

const buttonStyle: React.CSSProperties = {
  fontSize: 12,
  padding: '5px 11px',
  borderRadius: 8,
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg-secondary)',
  color: 'var(--color-text-primary)',
  cursor: 'pointer',
}

const tierStyle: React.CSSProperties = {
  display: 'grid',
  gap: 3,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid var(--color-border)',
  fontSize: 12.5,
}

function stateLabel(state: Grant['state']): string {
  return state === 'model_readable' ? 'Model-readable' : 'Indexed (local only)'
}

export function FileAccessSection() {
  const [grants, setGrants] = useState<Grant[]>([])
  const [disclosures, setDisclosures] = useState<Disclosure[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [draftPath, setDraftPath] = useState('')
  const [draftState, setDraftState] = useState<'indexed' | 'model_readable'>('model_readable')
  const [draftHighSensitivity, setDraftHighSensitivity] = useState(false)

  const reload = useCallback(async () => {
    try {
      const [grantRows, disclosureRows] = await Promise.all([
        ipc.fileAccess.listGrants({}),
        ipc.fileAccess.listDisclosures({ limit: 30 }),
      ])
      setGrants(grantRows as Grant[])
      setDisclosures(disclosureRows as Disclosure[])
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={tierStyle}>
          <span style={{ fontWeight: 650 }}>1 · Observed — always on</span>
          <span style={{ color: 'var(--color-text-tertiary)', lineHeight: 1.55 }}>
            Daylens knows a file was active: name, folder, app, when. The AI can list folders,
            match filenames, and rank repositories without opening anything.
          </span>
        </div>
        <div style={tierStyle}>
          <span style={{ fontWeight: 650 }}>2 · Indexed — per file or folder you grant</span>
          <span style={{ color: 'var(--color-text-tertiary)', lineHeight: 1.55 }}>
            Daylens may extract text locally for search. Nothing goes to a model. Revoking deletes the extracted text.
          </span>
        </div>
        <div style={tierStyle}>
          <span style={{ fontWeight: 650 }}>3 · Model-readable — per file or folder you grant</span>
          <span style={{ color: 'var(--color-text-tertiary)', lineHeight: 1.55 }}>
            A relevant excerpt may be sent to your chosen AI model for a question. Every read is logged below
            before it happens. Granting Indexed never grants this — each state is a separate decision.
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', lineHeight: 1.6 }}>
          Always denied, grant or no grant: anything outside your home folder, hidden folders and dotfiles,
          system data, credentials and keychains, browser profiles, dependencies, and build output.
          Files that look high-sensitivity (keys, secrets, passwords) additionally need the explicit
          high-sensitivity permission on the grant.
        </div>
      </div>

      {error && <div style={{ fontSize: 12.5, color: 'var(--color-danger, #d33)' }}>{error}</div>}

      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 650 }}>Granted paths</span>
          <button type="button" style={{ ...buttonStyle, marginLeft: 'auto' }} onClick={() => setAdding((current) => !current)}>
            {adding ? 'Cancel' : 'Grant a file or folder'}
          </button>
        </div>
        {adding && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              value={draftPath}
              onChange={(event) => setDraftPath(event.target.value)}
              placeholder="/absolute/path/to/file-or-folder"
              style={{ flex: 1, minWidth: 240, fontSize: 12.5, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)' }}
            />
            <select
              value={draftState}
              onChange={(event) => setDraftState(event.target.value as 'indexed' | 'model_readable')}
              style={{ fontSize: 12.5, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)' }}
            >
              <option value="model_readable">Model-readable</option>
              <option value="indexed">Indexed (local only)</option>
            </select>
            <label style={{ fontSize: 12, display: 'flex', gap: 5, alignItems: 'center', color: 'var(--color-text-secondary)' }}>
              <input type="checkbox" checked={draftHighSensitivity} onChange={(event) => setDraftHighSensitivity(event.target.checked)} />
              Allow high-sensitivity files
            </label>
            <button
              type="button"
              style={{ ...buttonStyle, background: 'var(--gradient-primary)', color: 'var(--color-primary-contrast)', border: 'none' }}
              onClick={async () => {
                try {
                  await ipc.fileAccess.addGrant({
                    scopeKind: draftPath.includes('.') && !draftPath.endsWith('/') ? 'file' : 'folder',
                    path: draftPath.trim(),
                    state: draftState,
                    allowHighSensitivity: draftHighSensitivity,
                  })
                  setDraftPath('')
                  setAdding(false)
                  await reload()
                } catch (addError) {
                  setError(addError instanceof Error ? addError.message : String(addError))
                }
              }}
            >
              Grant
            </button>
          </div>
        )}
        {!loaded ? (
          <div style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)' }}>Loading…</div>
        ) : grants.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)', lineHeight: 1.6 }}>
            No grants yet. The AI will ask you in the chat the first time it needs a file&apos;s contents —
            Allow once, Allow this folder, or Deny.
          </div>
        ) : (
          grants.map((grant) => (
            <div key={grant.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--color-border)', fontSize: 12.5 }}>
              <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>{grant.path}</span>
              <span style={{ color: 'var(--color-text-tertiary)' }}>{grant.scope_kind}</span>
              <span style={{ color: 'var(--color-text-tertiary)' }}>{stateLabel(grant.state)}</span>
              {grant.allow_high_sensitivity === 1 && <span style={{ color: 'var(--color-text-tertiary)' }}>high-sensitivity allowed</span>}
              <span style={{ marginLeft: 'auto', color: 'var(--color-text-tertiary)', fontSize: 11.5 }}>
                granted {new Date(grant.created_at).toLocaleDateString()} · via {grant.source === 'chat' ? 'chat' : 'settings'}
              </span>
              <button
                type="button"
                style={buttonStyle}
                onClick={async () => {
                  try {
                    await ipc.fileAccess.revokeGrant(grant.id)
                    await reload()
                  } catch (revokeError) {
                    setError(revokeError instanceof Error ? revokeError.message : String(revokeError))
                  }
                }}
              >
                Revoke
              </button>
            </div>
          ))
        )}
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 650 }}>Recent file disclosures</span>
        {disclosures.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)' }}>
            Nothing has been opened yet. When the AI reads a file, the exact version and excerpt land here first.
          </div>
        ) : (
          disclosures.map((disclosure) => (
            <div key={disclosure.id} style={{ display: 'grid', gap: 2, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--color-border)', fontSize: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontWeight: 620 }}>{disclosure.display_name}</span>
                <span style={{ color: 'var(--color-text-tertiary)' }}>v {disclosure.version_fingerprint.split('-').pop()}</span>
                <span style={{ color: 'var(--color-text-tertiary)' }}>bytes {disclosure.excerpt_start}–{disclosure.excerpt_end}</span>
                <span style={{ marginLeft: 'auto', color: 'var(--color-text-tertiary)' }}>
                  {new Date(disclosure.disclosed_at).toLocaleString()}
                  {disclosure.thread_id != null && ` · thread ${disclosure.thread_id}`}
                </span>
              </div>
              <span style={{ color: 'var(--color-text-tertiary)' }}>{disclosure.file_path} → {disclosure.destination}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
