// Settings → Connections (DEV-186 listing, DEV-188 lifecycle). Each source
// shows its what-it-brings copy, exact read-only scopes in plain language,
// and — once a connection exists — its account label, last sync, item count,
// and sanitized error state. Connectable providers (Google Calendar first)
// add the lifecycle: connect (which launches the provider's authorization in
// the system browser), sync now, and disconnect with an explicit
// keep-or-delete choice for already-imported data.
//
// The renderer sees only the ConnectorListing projection and sanitized action
// summaries: no tokens, no cursors, no file paths, no raw provider errors.
import { useCallback, useEffect, useState } from 'react'
import type { ConnectorListing, ConnectorSyncSummary } from '@shared/types'
import { ipc } from '../../lib/ipc'

function formatWhen(ms: number | null): string {
  if (ms == null) return 'never'
  return new Date(ms).toLocaleString()
}

function integrationLabel(listing: ConnectorListing): string {
  if (listing.integration === 'local') return 'local — nothing leaves this machine'
  if (listing.integration === 'brokered') return 'via an identified intermediary'
  return 'direct'
}

function summarizeAction(summary: ConnectorSyncSummary): string | null {
  if (summary.status === 'ok') {
    const parts = [`${summary.ingested} item${summary.ingested === 1 ? '' : 's'} synced`]
    if (summary.tombstoned > 0) parts.push(`${summary.tombstoned} removed at the source`)
    if (summary.quarantined > 0) parts.push(`${summary.quarantined} quarantined`)
    return parts.join(', ')
  }
  if (summary.status === 'blocked_consent') return 'Blocked: capture consent is not current.'
  if (summary.status === 'blocked_disabled') return 'Blocked: connected sources are turned off.'
  if (summary.status === 'failed') return summary.error ?? 'Sync failed.'
  return null
}

const buttonStyle: React.CSSProperties = {
  fontSize: 11.5,
  padding: '4px 12px',
  borderRadius: 999,
  border: '1px solid var(--color-border)',
  background: 'transparent',
  color: 'var(--color-text-secondary)',
  cursor: 'pointer',
}

const inputStyle: React.CSSProperties = {
  fontSize: 11.5,
  padding: '5px 10px',
  borderRadius: 8,
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg, transparent)',
  color: 'var(--color-text-primary)',
  minWidth: 260,
}

function ConnectorCard({ listing, onChanged }: { listing: ConnectorListing; onChanged: () => Promise<void> }) {
  const connected = listing.authState !== 'disconnected'
  const needsReauth = listing.authState === 'needs_attention'
  const [busy, setBusy] = useState<'connect' | 'sync' | 'disconnect' | null>(null)
  const [actionNote, setActionNote] = useState<string | null>(null)
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [repositories, setRepositories] = useState('')

  // GitHub authorizes with the device flow: only a client ID (no secret),
  // and the person picks exactly which repositories are read.
  const usesDeviceFlow = listing.id === 'github'
  const choosesRepositories = listing.id === 'github'

  // Honest progress for the bounded initial import: "waiting for your
  // browser" and "importing your last N days" are different states. A notice
  // (a device flow's "enter this code" prompt) takes precedence — it is the
  // only way the person learns their code.
  useEffect(() => ipc.connectors.onConnectProgress((event) => {
    if (event.connectorId !== listing.id) return
    setActionNote(event.notice
      ?? (event.phase === 'authorizing'
        ? 'Waiting for authorization in your browser…'
        : `Authorized. Importing the last ${listing.lookbackDays} days…`))
  }), [listing.id, listing.lookbackDays])

  const run = useCallback(async (
    kind: 'connect' | 'sync' | 'disconnect',
    action: () => Promise<string | null>,
  ) => {
    setBusy(kind)
    setActionNote(kind === 'connect' ? 'Waiting for authorization in your browser…' : null)
    try {
      setActionNote(await action())
    } catch (error) {
      setActionNote(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
      await onChanged()
    }
  }, [onChanged])

  const connect = () => run('connect', async () => {
    const config: Record<string, unknown> = {}
    if (clientId.trim()) config.clientId = clientId.trim()
    if (clientSecret.trim()) config.clientSecret = clientSecret.trim()
    if (choosesRepositories && repositories.trim()) config.repositories = repositories.trim()
    const summary = await ipc.connectors.connect(listing.id, config)
    setClientSecret('')
    return summarizeAction(summary)
  })

  const syncNow = () => run('sync', async () => summarizeAction(await ipc.connectors.sync(listing.id)))

  const disconnect = (deleteData: boolean) => run('disconnect', async () => {
    await ipc.connectors.disconnect(listing.id, { deleteData })
    setConfirmingDisconnect(false)
    return deleteData ? 'Disconnected. Imported data was deleted.' : 'Disconnected. Imported data was kept.'
  })

  return (
    <div style={{ display: 'grid', gap: 6, padding: '12px 14px', borderRadius: 12, border: '1px solid var(--color-border)', opacity: listing.available ? 1 : 0.8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13.5, fontWeight: 650 }}>{listing.displayName}</span>
        <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{integrationLabel(listing)}</span>
        {listing.authState === 'needs_attention' && (
          <span style={{ fontSize: 11, color: 'var(--color-danger, #d33)', fontWeight: 600 }}>needs attention</span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--color-text-tertiary)', border: '1px solid var(--color-border)', borderRadius: 999, padding: '3px 10px' }}>
          {connected ? 'Connected' : listing.available ? 'Not connected' : 'Coming soon'}
        </span>
      </div>

      <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
        {listing.whatItBrings}
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', lineHeight: 1.5 }}>
        {listing.scopes.map((scope) => (
          <div key={scope.scope}>
            <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>{scope.scope}</span>
            {' — '}{scope.grants}
          </div>
        ))}
      </div>

      {connected && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 11.5, color: 'var(--color-text-tertiary)' }}>
          {listing.accountLabel && <span>source: {listing.accountLabel}</span>}
          <span>last sync: {formatWhen(listing.lastSyncAt)}</span>
          <span>{listing.itemsIngested} item{listing.itemsIngested === 1 ? '' : 's'} imported</span>
          {listing.lastSyncError && (
            <span style={{ color: 'var(--color-danger, #d33)' }}>
              {listing.lastSyncError}
              {listing.nextRetryAt != null && ` · retrying after ${formatWhen(listing.nextRetryAt)}`}
            </span>
          )}
        </div>
      )}

      {listing.available && (!connected || needsReauth) && (
        <div style={{ display: 'grid', gap: 6 }}>
          {needsReauth && (
            <div style={{ fontSize: 11.5, color: 'var(--color-danger, #d33)' }}>
              The authorization no longer works. Reconnect to resume syncing — your imported data is untouched.
            </div>
          )}
          {listing.authKind === 'oauth' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <input
                style={inputStyle}
                placeholder={usesDeviceFlow ? 'GitHub App client ID (device flow)' : 'OAuth client ID (Desktop app)'}
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                spellCheck={false}
              />
              {!usesDeviceFlow && (
                <input
                  style={inputStyle}
                  type="password"
                  placeholder="Client secret (optional)"
                  value={clientSecret}
                  onChange={(event) => setClientSecret(event.target.value)}
                  spellCheck={false}
                />
              )}
              {choosesRepositories && (
                <input
                  style={inputStyle}
                  placeholder="Repositories to sync (owner/repo, comma-separated)"
                  value={repositories}
                  onChange={(event) => setRepositories(event.target.value)}
                  spellCheck={false}
                />
              )}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button style={buttonStyle} disabled={busy != null} onClick={connect}>
              {busy === 'connect' ? 'Connecting…' : needsReauth ? 'Reconnect' : 'Connect'}
            </button>
            {listing.authKind === 'oauth' && (
              <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                {usesDeviceFlow
                  ? 'Shows a one-time code to enter on github.com — only the repositories you list are read.'
                  : 'Opens your browser to grant exactly the read-only scopes listed above — nothing more.'}
              </span>
            )}
          </div>
        </div>
      )}

      {connected && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <button style={buttonStyle} disabled={busy != null} onClick={syncNow}>
            {busy === 'sync' ? 'Syncing…' : 'Sync now'}
          </button>
          {!confirmingDisconnect ? (
            <button style={buttonStyle} disabled={busy != null} onClick={() => setConfirmingDisconnect(true)}>
              Disconnect…
            </button>
          ) : (
            <>
              <span style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)' }}>Imported data:</span>
              <button style={buttonStyle} disabled={busy != null} onClick={() => disconnect(false)}>
                Disconnect, keep data
              </button>
              <button style={{ ...buttonStyle, color: 'var(--color-danger, #d33)' }} disabled={busy != null} onClick={() => disconnect(true)}>
                Disconnect and delete
              </button>
              <button style={buttonStyle} disabled={busy != null} onClick={() => setConfirmingDisconnect(false)}>
                Cancel
              </button>
            </>
          )}
        </div>
      )}

      {actionNote && (
        <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)' }}>{actionNote}</div>
      )}
    </div>
  )
}

export function ConnectionsSection() {
  const [connectors, setConnectors] = useState<ConnectorListing[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setConnectors(await ipc.connectors.list())
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  if (!loaded) {
    return <div style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)' }}>Loading connections…</div>
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {error && <div style={{ fontSize: 12.5, color: 'var(--color-danger, #d33)' }}>{error}</div>}

      <div style={{ display: 'grid', gap: 10 }}>
        {connectors.map((listing) => (
          <ConnectorCard key={listing.id} listing={listing} onChanged={refresh} />
        ))}
      </div>

      <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', lineHeight: 1.6 }}>
        Every connection is read-only. Credentials live in your operating system&apos;s secure store —
        never in the database, logs, exports, or sync. Imported records stay on this machine under
        the same privacy rules as everything Daylens observes, and disconnecting a source can remove
        every meeting, person, and signal that only it supported.
      </div>
    </div>
  )
}
