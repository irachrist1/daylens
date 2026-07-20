// Settings → Connections (DEV-186): every source Daylens can connect to,
// working ones first. Each card shows what the connection brings, its exact
// read-only scopes, live status (last sync, items, errors), and the
// connect / sync / disconnect lifecycle. Disconnecting always asks the
// keep-or-delete question — deletion removes every derived record, entity,
// and day signal the source produced.
//
// The renderer sees only the ConnectorListing projection: no tokens, no
// cursors, no file paths, no raw provider errors.
import { useCallback, useEffect, useState } from 'react'
import type { ConnectorListing } from '@shared/types'
import { ipc } from '../../lib/ipc'

const buttonStyle: React.CSSProperties = {
  fontSize: 12,
  padding: '5px 11px',
  borderRadius: 8,
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg-secondary)',
  color: 'var(--color-text-primary)',
  cursor: 'pointer',
}

const primaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: 'var(--gradient-primary)',
  color: 'var(--color-primary-contrast)',
  border: 'none',
}

function formatWhen(ms: number | null): string {
  if (ms == null) return 'never'
  return new Date(ms).toLocaleString()
}

function integrationLabel(listing: ConnectorListing): string {
  if (listing.integration === 'local') return 'local — nothing leaves this machine'
  if (listing.integration === 'brokered') return 'via an identified intermediary'
  return 'direct'
}

function ConnectorCard({
  listing,
  disabled,
  busy,
  onConnect,
  onSyncNow,
  onDisconnect,
}: {
  listing: ConnectorListing
  /** Global switch off or consent missing: lifecycle actions are unavailable. */
  disabled: boolean
  busy: boolean
  onConnect: () => void
  onSyncNow: () => void
  onDisconnect: (deleteData: boolean) => void
}) {
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)
  const connected = listing.authState !== 'disconnected'

  return (
    <div style={{ display: 'grid', gap: 6, padding: '12px 14px', borderRadius: 12, border: '1px solid var(--color-border)', opacity: listing.available ? 1 : 0.75 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13.5, fontWeight: 650 }}>{listing.displayName}</span>
        <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{integrationLabel(listing)}</span>
        {listing.authState === 'needs_attention' && (
          <span style={{ fontSize: 11, color: 'var(--color-danger, #d33)', fontWeight: 600 }}>needs attention</span>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {!listing.available ? (
            <span style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', border: '1px solid var(--color-border)', borderRadius: 999, padding: '3px 10px' }}>
              Coming soon
            </span>
          ) : !connected ? (
            <button type="button" style={primaryButtonStyle} disabled={disabled || busy} onClick={onConnect}>
              {busy ? 'Connecting…' : 'Connect'}
            </button>
          ) : confirmingDisconnect ? (
            <>
              <button type="button" style={buttonStyle} disabled={busy} onClick={() => { setConfirmingDisconnect(false); onDisconnect(false) }}>
                Keep imported data
              </button>
              <button
                type="button"
                style={{ ...buttonStyle, color: 'var(--color-danger, #d33)' }}
                disabled={busy}
                onClick={() => { setConfirmingDisconnect(false); onDisconnect(true) }}
              >
                Delete imported data
              </button>
              <button type="button" style={buttonStyle} disabled={busy} onClick={() => setConfirmingDisconnect(false)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button type="button" style={buttonStyle} disabled={disabled || busy} onClick={onSyncNow}>
                {busy ? 'Syncing…' : 'Sync now'}
              </button>
              <button type="button" style={buttonStyle} disabled={busy} onClick={() => setConfirmingDisconnect(true)}>
                Disconnect
              </button>
            </>
          )}
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
    </div>
  )
}

export function ConnectionsSection() {
  const [connectors, setConnectors] = useState<ConnectorListing[]>([])
  const [enabled, setEnabled] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const [listings, settings] = await Promise.all([ipc.connectors.list(), ipc.settings.get()])
      setConnectors(listings)
      setEnabled(settings.connectedSourcesEnabled !== false)
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const withBusy = useCallback(async (id: string, action: () => Promise<unknown>) => {
    setBusyId(id)
    setError(null)
    try {
      await action()
      await reload()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError))
    } finally {
      setBusyId(null)
    }
  }, [reload])

  const connect = useCallback((listing: ConnectorListing) => {
    void withBusy(listing.id, async () => {
      if (listing.id === 'ics_calendar') {
        const filePath = await ipc.connectors.pickIcsFile()
        if (!filePath) return
        const { summary } = await ipc.connectors.connect({ connectorId: listing.id, config: { filePath } })
        if (summary.status === 'failed' && summary.error) throw new Error(summary.error)
        return
      }
      await ipc.connectors.connect({ connectorId: listing.id })
    })
  }, [withBusy])

  if (!loaded) {
    return <div style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)' }}>Loading connections…</div>
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--color-border)' }}>
        <div style={{ display: 'grid', gap: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 650 }}>Connected sources</span>
          <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)', lineHeight: 1.5 }}>
            The master switch. Off means no connector syncs or imports anything, no matter what is
            connected below — same rule as capture consent: nothing external enters your memory
            without both this and your consent being current.
          </span>
        </div>
        <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => {
              const next = event.target.checked
              setEnabled(next)
              void ipc.settings.set({ connectedSourcesEnabled: next }).then(reload)
            }}
          />
          {enabled ? 'On' : 'Off'}
        </label>
      </div>

      {error && <div style={{ fontSize: 12.5, color: 'var(--color-danger, #d33)' }}>{error}</div>}

      <div style={{ display: 'grid', gap: 10 }}>
        {connectors.map((listing) => (
          <ConnectorCard
            key={listing.id}
            listing={listing}
            disabled={!enabled}
            busy={busyId === listing.id}
            onConnect={() => connect(listing)}
            onSyncNow={() => void withBusy(listing.id, async () => {
              const { summary } = await ipc.connectors.syncNow({ connectorId: listing.id })
              if (summary.status === 'failed' && summary.error) throw new Error(summary.error)
            })}
            onDisconnect={(deleteData) => void withBusy(listing.id, () =>
              ipc.connectors.disconnect({ connectorId: listing.id, deleteData }))}
          />
        ))}
      </div>

      <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', lineHeight: 1.6 }}>
        Every connection is read-only. Credentials live in your operating system&apos;s secure store —
        never in the database, logs, exports, or sync. Imported records stay on this machine under
        the same privacy rules as everything Daylens observes, and deleting a connection&apos;s data
        removes every meeting, person, and signal that only it supported.
      </div>
    </div>
  )
}
