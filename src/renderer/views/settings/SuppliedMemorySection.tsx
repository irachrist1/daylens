// "Things you've told me" (DEV-185): the confirmed supplied-memory tier.
// Every fact here was explicitly saved by the user — proposed in chat and
// confirmed, typed by hand, or migrated from the old profile — and shows when
// and how it was confirmed. Edit and delete act on the canonical store, so a
// deletion leaves search results and future context packets immediately.
// Declined chat suggestions are listed too, deletable like any memory, which
// lets a fact be proposed again.
import { useEffect, useState, type CSSProperties } from 'react'
import type { SuppliedMemoryFactView, MemoryProposalRejectionView } from '@shared/types'
import { ipc } from '../../lib/ipc'

const panelStyle: CSSProperties = {
  marginTop: 14,
  padding: '14px 18px',
  borderRadius: 14,
  border: '1px solid var(--color-border-ghost)',
  background: 'var(--color-surface-low)',
}

const actionStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  fontSize: 12,
  color: 'var(--color-text-tertiary)',
  cursor: 'pointer',
  fontFamily: 'inherit',
}

function confirmedLine(fact: SuppliedMemoryFactView): string {
  const when = new Date(fact.confirmedAt).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  })
  const how = fact.source === 'chat'
    ? (fact.threadId == null && fact.context?.startsWith('Confirmed in chat')
      ? 'confirmed in a chat (since deleted — kept because you confirmed it separately)'
      : 'confirmed in chat')
    : fact.source === 'hand'
      ? (fact.context ?? 'added by hand')
      : 'moved from your memory profile'
  const scope = fact.scope.startsWith('client:') ? ' · client memory' : ''
  return `${when} · ${how}${scope}`
}

export function SuppliedMemorySection({ reloadToken }: { reloadToken?: number }) {
  const [facts, setFacts] = useState<SuppliedMemoryFactView[] | null>(null)
  const [rejections, setRejections] = useState<MemoryProposalRejectionView[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [factRows, rejectionRows] = await Promise.all([
          ipc.db.listSuppliedMemoryFacts(),
          ipc.db.listMemoryProposalRejections(),
        ])
        if (cancelled) return
        setFacts(factRows)
        setRejections(rejectionRows)
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError))
      }
    })()
    return () => { cancelled = true }
  }, [reloadToken])

  async function saveEdit(id: string) {
    const statement = drafts[id]?.trim()
    if (!statement) return
    setBusyId(id)
    setError(null)
    try {
      setFacts(await ipc.db.updateSuppliedMemoryFact(id, statement))
      setDrafts((current) => {
        const next = { ...current }
        delete next[id]
        return next
      })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setBusyId(null)
    }
  }

  async function deleteFact(id: string) {
    setBusyId(id)
    setError(null)
    try {
      setFacts(await ipc.db.deleteSuppliedMemoryFact(id))
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError))
    } finally {
      setBusyId(null)
    }
  }

  async function deleteRejection(id: string) {
    setBusyId(id)
    setError(null)
    try {
      setRejections(await ipc.db.deleteMemoryProposalRejection(id))
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div style={panelStyle}>
      <div style={{ fontSize: 13.5, fontWeight: 620, color: 'var(--color-text-primary)' }}>
        Things you&apos;ve told me
      </div>
      <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', lineHeight: 1.55, marginTop: 3 }}>
        Facts you explicitly saved. They feed answers and search until you edit or delete them —
        deleting one removes it from search and future AI context immediately.
      </div>
      {error && (
        <div style={{ fontSize: 12, color: '#f87171', lineHeight: 1.55, marginTop: 8 }}>{error}</div>
      )}
      <div style={{ display: 'grid', marginTop: 8 }}>
        {facts === null ? (
          <div style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)', padding: '4px 0' }}>Loading…</div>
        ) : facts.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)', lineHeight: 1.6, padding: '4px 0' }}>
            Nothing yet. When you tell the AI something worth keeping, it asks before saving —
            confirmed facts land here.
          </div>
        ) : (
          facts.map((fact) => {
            const draft = drafts[fact.id]
            const busy = busyId === fact.id
            if (draft !== undefined) {
              return (
                <div key={fact.id} style={{ display: 'grid', gap: 8, padding: '8px 0' }}>
                  <textarea
                    value={draft}
                    autoFocus
                    rows={2}
                    onChange={(event) => setDrafts((current) => ({ ...current, [fact.id]: event.target.value }))}
                    style={{
                      width: '100%',
                      resize: 'vertical',
                      fontSize: 13.5,
                      lineHeight: 1.55,
                      color: 'var(--color-text-primary)',
                      background: 'var(--color-surface)',
                      border: '1px solid var(--color-border-ghost)',
                      borderRadius: 8,
                      padding: '8px 10px',
                      fontFamily: 'inherit',
                      boxSizing: 'border-box',
                    }}
                  />
                  <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      disabled={busyId !== null}
                      style={actionStyle}
                      onClick={() => setDrafts((current) => {
                        const next = { ...current }
                        delete next[fact.id]
                        return next
                      })}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={busyId !== null || !draft.trim()}
                      style={{ ...actionStyle, color: 'var(--color-text-primary)' }}
                      onClick={() => void saveEdit(fact.id)}
                    >
                      {busy ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              )
            }
            return (
              <div key={fact.id} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '7px 0' }}>
                <span style={{ flex: 1, display: 'grid', gap: 2 }}>
                  <span style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--color-text-primary)' }}>
                    {fact.statement}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                    {confirmedLine(fact)}
                  </span>
                </span>
                <span style={{ display: 'flex', gap: 12, flexShrink: 0 }}>
                  <button
                    type="button"
                    disabled={busyId !== null}
                    style={actionStyle}
                    onClick={() => setDrafts((current) => ({ ...current, [fact.id]: fact.statement }))}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={busyId !== null}
                    style={{ ...actionStyle, color: '#f87171' }}
                    onClick={() => void deleteFact(fact.id)}
                  >
                    {busy ? 'Deleting…' : 'Delete'}
                  </button>
                </span>
              </div>
            )
          })
        )}
      </div>
      {rejections.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--color-border-ghost)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', marginBottom: 4 }}>
            Declined suggestions
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', lineHeight: 1.5, marginBottom: 6 }}>
            The AI won&apos;t suggest saving these again. Remove one to allow it to be proposed.
          </div>
          {rejections.map((rejection) => (
            <div key={rejection.id} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '4px 0' }}>
              <span style={{ flex: 1, fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                {rejection.statement}
              </span>
              <button
                type="button"
                disabled={busyId !== null}
                style={{ ...actionStyle, flexShrink: 0 }}
                onClick={() => void deleteRejection(rejection.id)}
              >
                {busyId === rejection.id ? 'Removing…' : 'Remove'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
