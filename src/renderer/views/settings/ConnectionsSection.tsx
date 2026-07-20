// Settings → Connections (DEV-186): the listed connections. Each source the
// Connections wave brings shows its what-it-brings copy, exact read-only
// scopes in plain language, and — once a connection exists — its account
// label, last sync, item count, and sanitized error state. This slice is a
// LISTING: connect/disconnect/sync affordances arrive with the first
// connectable provider, on top of the lifecycle the connector service and
// contract suite already prove.
//
// The renderer sees only the ConnectorListing projection: no tokens, no
// cursors, no file paths, no raw provider errors.
import { useEffect, useState } from 'react'
import type { ConnectorListing } from '@shared/types'
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

function ConnectorCard({ listing }: { listing: ConnectorListing }) {
  const connected = listing.authState !== 'disconnected'
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
    </div>
  )
}

export function ConnectionsSection() {
  const [connectors, setConnectors] = useState<ConnectorListing[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        setConnectors(await ipc.connectors.list())
        setError(null)
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : String(loadError))
      } finally {
        setLoaded(true)
      }
    })()
  }, [])

  if (!loaded) {
    return <div style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)' }}>Loading connections…</div>
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {error && <div style={{ fontSize: 12.5, color: 'var(--color-danger, #d33)' }}>{error}</div>}

      <div style={{ display: 'grid', gap: 10 }}>
        {connectors.map((listing) => (
          <ConnectorCard key={listing.id} listing={listing} />
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
