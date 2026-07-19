// Settings → Memory → Entities (DEV-177): browse the durable entity store by
// type, rename inline, merge two entities with a preview and undo, manage
// alias chips, review suggested merges (never auto-applied), and open an
// entity's linked evidence. Every mutation flows through the entity correction
// commands, so it lands in the same undo ledger the Timeline uses.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ipc } from '../../lib/ipc'

type EntityType =
  | 'application' | 'page' | 'file' | 'person' | 'meeting' | 'repository'
  | 'project' | 'client' | 'timeline_block' | 'ai_thread'

interface EntitySummary {
  id: string
  type: EntityType
  name: string
  nameSource: 'inferred' | 'user'
  origin: string
  sensitivity: string
  status: string
  firstObservedAt: number | null
  lastObservedAt: number | null
  aliases: string[]
  evidenceCount: number
}

interface EntityDetail extends EntitySummary {
  aliasRows: Array<{ id: string; entity_id: string; alias: string; raw_label: string | null; source: string }>
  evidenceRefs: Array<{ id: string; source_type: string; source_id: string; span_start_ms: number | null; span_end_ms: number | null }>
  related: Array<{ id: string; name: string; type: EntityType; kind: string }>
  mergedEntities: Array<{ id: string; name: string }>
  blockRefs: Array<{ blockId: string | null; degraded: boolean; spanStartMs: number | null; spanEndMs: number | null }>
}

interface SuggestedMerge {
  type: EntityType
  leftId: string
  leftName: string
  rightId: string
  rightName: string
  reason: string
}

interface MergePreview {
  description: string
  entity: { id: string; name: string; aliases: string[]; evidenceCount: number } | null
  surfaces: string[]
}

const TYPE_TABS: Array<{ id: EntityType | null; label: string }> = [
  { id: null, label: 'All' },
  { id: 'person', label: 'People' },
  { id: 'meeting', label: 'Meetings' },
  { id: 'repository', label: 'Repositories' },
  { id: 'client', label: 'Clients' },
  { id: 'project', label: 'Projects' },
  { id: 'file', label: 'Files' },
  { id: 'page', label: 'Pages' },
  { id: 'application', label: 'Apps' },
]

const chipStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '2px 8px',
  borderRadius: 999,
  border: '1px solid var(--color-border)',
  color: 'var(--color-text-tertiary)',
  background: 'var(--color-bg-secondary)',
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

const primaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: 'var(--gradient-primary)',
  color: 'var(--color-primary-contrast)',
  border: 'none',
}

function formatDate(ms: number | null): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function EntityMemorySection() {
  const [typeFilter, setTypeFilter] = useState<EntityType | null>(null)
  const [search, setSearch] = useState('')
  const [entities, setEntities] = useState<EntitySummary[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [detail, setDetail] = useState<EntityDetail | null>(null)
  const [suggestions, setSuggestions] = useState<SuggestedMerge[]>([])
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(new Set())
  const [mergePreview, setMergePreview] = useState<{ preview: MergePreview; targetId: string; sourceId: string } | null>(null)
  const [undoToast, setUndoToast] = useState<{ correctionId: string; description: string } | null>(null)
  const [newProjectName, setNewProjectName] = useState('')
  const [addingProject, setAddingProject] = useState(false)
  const [aliasDraft, setAliasDraft] = useState('')

  const reload = useCallback(async () => {
    try {
      const rows = await ipc.entities.list({ type: typeFilter, search: search || null })
      setEntities(rows as EntitySummary[])
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoaded(true)
    }
  }, [typeFilter, search])

  useEffect(() => { void reload() }, [reload])
  useEffect(() => {
    void ipc.entities.suggestedMerges().then((rows: SuggestedMerge[]) => setSuggestions(rows)).catch(() => {})
  }, [])

  const openDetail = useCallback(async (entityId: string) => {
    try {
      const row = await ipc.entities.detail(entityId)
      setDetail(row as EntityDetail | null)
      setAliasDraft('')
    } catch { /* detail failures leave the browser usable */ }
  }, [])

  async function applyAndToast(command: unknown) {
    const result = await ipc.entities.applyCorrection(command) as { correctionId: string; description: string }
    setUndoToast(result)
    await reload()
    if (detail) await openDetail(detail.id)
    void ipc.entities.suggestedMerges().then((rows: SuggestedMerge[]) => setSuggestions(rows)).catch(() => {})
    return result
  }

  async function startMergePreview(targetId: string, sourceId: string) {
    try {
      const preview = await ipc.entities.previewCorrection({ kind: 'entity-merge', targetId, sourceId }) as MergePreview
      setMergePreview({ preview, targetId, sourceId })
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : String(previewError))
    }
  }

  const visibleSuggestions = useMemo(
    () => suggestions.filter((item) => !dismissedSuggestions.has(`${item.leftId}:${item.rightId}`)),
    [suggestions, dismissedSuggestions],
  )

  const selectedEntities = entities.filter((entity) => selected.includes(entity.id))
  const canMerge = selectedEntities.length === 2 && selectedEntities[0].type === selectedEntities[1].type

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {undoToast && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10,
          border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', fontSize: 12.5,
        }}>
          <span style={{ color: 'var(--color-text-secondary)' }}>{undoToast.description}</span>
          <button
            type="button"
            style={{ ...buttonStyle, marginLeft: 'auto' }}
            onClick={async () => {
              try {
                await ipc.entities.undoCorrection(undoToast.correctionId)
                setUndoToast(null)
                await reload()
                if (detail) await openDetail(detail.id)
              } catch (undoError) {
                setError(undoError instanceof Error ? undoError.message : String(undoError))
              }
            }}
          >
            Undo
          </button>
          <button type="button" style={buttonStyle} onClick={() => setUndoToast(null)}>Dismiss</button>
        </div>
      )}

      {visibleSuggestions.length > 0 && (
        <div style={{ display: 'grid', gap: 8, padding: 12, borderRadius: 10, border: '1px dashed var(--color-border)' }}>
          <div style={{ fontSize: 12, fontWeight: 640, color: 'var(--color-text-secondary)' }}>
            Suggested merges — never applied without you
          </div>
          {visibleSuggestions.slice(0, 4).map((item) => (
            <div key={`${item.leftId}:${item.rightId}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
              <span>“{item.leftName}” + “{item.rightName}”</span>
              <span style={{ color: 'var(--color-text-tertiary)' }}>{item.reason}</span>
              <button type="button" style={{ ...buttonStyle, marginLeft: 'auto' }} onClick={() => void startMergePreview(item.leftId, item.rightId)}>Review</button>
              <button
                type="button"
                style={buttonStyle}
                onClick={() => setDismissedSuggestions((current) => new Set([...current, `${item.leftId}:${item.rightId}`]))}
              >
                Dismiss
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {TYPE_TABS.map((tab) => (
          <button
            key={tab.label}
            type="button"
            onClick={() => { setTypeFilter(tab.id); setSelected([]) }}
            style={{
              ...chipStyle,
              cursor: 'pointer',
              ...(typeFilter === tab.id ? { background: 'var(--gradient-primary)', color: 'var(--color-primary-contrast)', border: '1px solid transparent' } : {}),
            }}
          >
            {tab.label}
          </button>
        ))}
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search names and aliases"
          style={{
            marginLeft: 'auto', fontSize: 12.5, padding: '5px 10px', borderRadius: 8,
            border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)',
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          type="button"
          style={canMerge ? primaryButtonStyle : { ...buttonStyle, opacity: 0.5, cursor: 'default' }}
          disabled={!canMerge}
          onClick={() => { if (canMerge) void startMergePreview(selected[0], selected[1]) }}
        >
          Merge selected
        </button>
        <span style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)' }}>
          Select two entities of the same type to merge them (with preview and undo).
        </span>
        {(typeFilter === 'project' || typeFilter === null) && (
          addingProject ? (
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <input
                value={newProjectName}
                onChange={(event) => setNewProjectName(event.target.value)}
                placeholder="Project name — no client needed"
                style={{ fontSize: 12.5, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)' }}
              />
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={async () => {
                  try {
                    await ipc.entities.createProject({ name: newProjectName })
                    setNewProjectName('')
                    setAddingProject(false)
                    await reload()
                  } catch (createError) {
                    setError(createError instanceof Error ? createError.message : String(createError))
                  }
                }}
              >
                Create
              </button>
              <button type="button" style={buttonStyle} onClick={() => setAddingProject(false)}>Cancel</button>
            </span>
          ) : (
            <button type="button" style={{ ...buttonStyle, marginLeft: 'auto' }} onClick={() => setAddingProject(true)}>
              New project (no client required)
            </button>
          )
        )}
      </div>

      {error && <div style={{ fontSize: 12.5, color: 'var(--color-danger, #d33)' }}>{error}</div>}

      {!loaded ? (
        <div style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)' }}>Loading entities…</div>
      ) : entities.length === 0 ? (
        <div style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)', lineHeight: 1.6 }}>
          Nothing here yet. Entities appear as Daylens observes apps, pages, repositories, meetings, and the clients and projects you set up.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {entities.map((entity) => (
            <div
              key={entity.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                borderRadius: 10, border: '1px solid var(--color-border)',
                background: detail?.id === entity.id ? 'var(--color-bg-secondary)' : 'transparent',
              }}
            >
              <input
                type="checkbox"
                checked={selected.includes(entity.id)}
                onChange={(event) => setSelected((current) => event.target.checked
                  ? [...current, entity.id].slice(-2)
                  : current.filter((id) => id !== entity.id))}
              />
              {renamingId === entity.id ? (
                <span style={{ display: 'flex', gap: 6 }}>
                  <input
                    value={renameValue}
                    autoFocus
                    onChange={(event) => setRenameValue(event.target.value)}
                    style={{ fontSize: 13, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)' }}
                  />
                  <button
                    type="button"
                    style={primaryButtonStyle}
                    onClick={async () => {
                      try {
                        await applyAndToast({ kind: 'entity-rename', entityId: entity.id, name: renameValue })
                        setRenamingId(null)
                      } catch (renameError) {
                        setError(renameError instanceof Error ? renameError.message : String(renameError))
                      }
                    }}
                  >
                    Save
                  </button>
                  <button type="button" style={buttonStyle} onClick={() => setRenamingId(null)}>Cancel</button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => void openDetail(entity.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13.5, fontWeight: 600, color: 'var(--color-text-primary)', padding: 0 }}
                >
                  {entity.name}
                </button>
              )}
              {entity.nameSource === 'user' && <span style={{ ...chipStyle, borderStyle: 'solid' }}>renamed by you</span>}
              <span style={chipStyle}>{entity.type}</span>
              <span style={chipStyle}>{entity.origin}</span>
              {entity.aliases.slice(0, 3).map((alias) => <span key={alias} style={chipStyle}>{alias}</span>)}
              {entity.aliases.length > 3 && <span style={chipStyle}>+{entity.aliases.length - 3}</span>}
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--color-text-tertiary)' }}>
                {formatDate(entity.firstObservedAt)} – {formatDate(entity.lastObservedAt)} · {entity.evidenceCount} evidence
              </span>
              <button
                type="button"
                style={buttonStyle}
                onClick={() => { setRenamingId(entity.id); setRenameValue(entity.name) }}
              >
                Rename
              </button>
            </div>
          ))}
        </div>
      )}

      {detail && (
        <div style={{ display: 'grid', gap: 10, padding: 14, borderRadius: 12, border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 660 }}>{detail.name}</span>
            <span style={chipStyle}>{detail.type}</span>
            <button type="button" style={{ ...buttonStyle, marginLeft: 'auto' }} onClick={() => setDetail(null)}>Close</button>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {detail.aliasRows.map((alias) => (
              <span key={alias.id} style={{ ...chipStyle, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                {alias.alias}
                <button
                  type="button"
                  aria-label={`Remove alias ${alias.alias}`}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, fontSize: 11 }}
                  onClick={() => void applyAndToast({ kind: 'entity-remove-alias', entityId: alias.entity_id, aliasId: alias.id }).catch((aliasError) => setError(String(aliasError)))}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              value={aliasDraft}
              onChange={(event) => setAliasDraft(event.target.value)}
              placeholder="Add alias"
              style={{ fontSize: 12, padding: '3px 8px', borderRadius: 999, border: '1px dashed var(--color-border)', background: 'transparent', color: 'var(--color-text-primary)', width: 110 }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && aliasDraft.trim()) {
                  void applyAndToast({ kind: 'entity-add-alias', entityId: detail.id, alias: aliasDraft.trim() })
                    .then(() => setAliasDraft(''))
                    .catch((aliasError) => setError(String(aliasError)))
                }
              }}
            />
          </div>
          {detail.mergedEntities.length > 0 && (
            <div style={{ fontSize: 12.5, display: 'grid', gap: 4 }}>
              <span style={{ color: 'var(--color-text-tertiary)' }}>Merged into this entity:</span>
              {detail.mergedEntities.map((merged) => (
                <span key={merged.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  “{merged.name}”
                  <button
                    type="button"
                    style={buttonStyle}
                    onClick={() => void applyAndToast({ kind: 'entity-split', entityId: merged.id }).catch((splitError) => setError(String(splitError)))}
                  >
                    Split back out
                  </button>
                </span>
              ))}
            </div>
          )}
          <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
            <div style={{ fontWeight: 640, marginBottom: 4 }}>Linked evidence ({detail.evidenceRefs.length})</div>
            {detail.evidenceRefs.slice(0, 8).map((ref) => (
              <div key={ref.id} style={{ color: 'var(--color-text-tertiary)' }}>
                {ref.source_type} · {ref.source_id}
                {ref.span_start_ms != null && ` · ${new Date(ref.span_start_ms).toLocaleString()}`}
              </div>
            ))}
            {detail.blockRefs.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontWeight: 640, marginBottom: 2 }}>Timeline blocks</div>
                {detail.blockRefs.map((ref, index) => (
                  <div key={index} style={{ color: 'var(--color-text-tertiary)' }}>
                    {ref.degraded
                      ? `Evidence span ${ref.spanStartMs ? new Date(ref.spanStartMs).toLocaleString() : ''} – ${ref.spanEndMs ? new Date(ref.spanEndMs).toLocaleTimeString() : ''}`
                      : `Block ${ref.blockId}`}
                  </div>
                ))}
              </div>
            )}
            {detail.related.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontWeight: 640, marginBottom: 2 }}>Related</div>
                {detail.related.map((relation) => (
                  <div key={`${relation.id}:${relation.kind}`} style={{ color: 'var(--color-text-tertiary)' }}>
                    {relation.kind} → {relation.name} ({relation.type})
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {mergePreview && (
        <div style={{ display: 'grid', gap: 10, padding: 14, borderRadius: 12, border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}>
          <div style={{ fontSize: 13.5, fontWeight: 660 }}>{mergePreview.preview.description}</div>
          {mergePreview.preview.entity && (
            <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
              Result: “{mergePreview.preview.entity.name}” with {mergePreview.preview.entity.aliases.length} alias{mergePreview.preview.entity.aliases.length === 1 ? '' : 'es'} and {mergePreview.preview.entity.evidenceCount} linked evidence item{mergePreview.preview.entity.evidenceCount === 1 ? '' : 's'}.
            </div>
          )}
          {mergePreview.preview.surfaces.map((line) => (
            <div key={line} style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>• {line}</div>
          ))}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              style={primaryButtonStyle}
              onClick={async () => {
                try {
                  await applyAndToast({ kind: 'entity-merge', targetId: mergePreview.targetId, sourceId: mergePreview.sourceId })
                  setMergePreview(null)
                  setSelected([])
                } catch (mergeError) {
                  setError(mergeError instanceof Error ? mergeError.message : String(mergeError))
                }
              }}
            >
              Merge
            </button>
            <button type="button" style={buttonStyle} onClick={() => setMergePreview(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
