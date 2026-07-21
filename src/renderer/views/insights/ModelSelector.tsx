import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Brain, Check, Eye, Search, Wrench } from 'lucide-react'
import type { AIModelCostCatalog, AIModelCostEntry, AIProviderMode } from '@shared/types'
import type { AIModelSource } from '@shared/aiModelSources'
import {
  AI_PROVIDER_META,
  contextWindowLabel,
  modelCapabilities,
  type AIModelCapabilities,
  type AIModelOption,
} from '../../lib/aiProvider'

// FB8: clicking the model line opens this Raycast-style picker — a search field
// on top, models grouped on the left, and a detail card on the right (speed /
// intelligence bars, context window, capability badges, and — DEV-201 — what a
// typical question costs). Selecting a model applies it as the per-chat
// override (D4); the header subline updates.
//
// DEV-201: the picker renders provider SOURCES (shared/aiModelSources.ts), not
// a hardcoded provider list — managed allowance, your API keys, and your CLI
// subscriptions each carry honest availability and cost semantics. That source
// abstraction is the seam a bring-your-own-subscription provider (issue #5)
// slots into without touching this component. Costs come from the main
// process's billing pricing table, shown in money and estimated questions —
// never raw tokens first.

type Entry =
  | { kind: 'default' }
  | { kind: 'managed'; source: AIModelSource }
  | { kind: 'model'; source: AIModelSource; provider: AIProviderMode; model: AIModelOption }

function SegmentBar({ value }: { value: number }) {
  return (
    <span style={{ display: 'inline-flex', gap: 3 }}>
      {[1, 2, 3, 4, 5].map((slot) => (
        <span
          key={slot}
          style={{
            width: 16, height: 5, borderRadius: 2,
            background: slot <= value ? 'var(--color-accent)' : 'var(--color-surface-high)',
          }}
        />
      ))}
    </span>
  )
}

function CapabilityBadge({ icon, label, on }: { icon: ReactNode; label: string; on: boolean }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '4px 9px', borderRadius: 7,
      fontSize: 11.5, fontWeight: 600,
      background: on ? 'var(--color-accent-dim)' : 'var(--color-surface-high)',
      color: on ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
      opacity: on ? 1 : 0.7,
    }}>
      {icon}
      {label}
    </span>
  )
}

// "$0.09" for ordinary costs, "< $0.01" for sub-cent ones — a person-scale
// money figure, never scientific notation or token math.
export function formatQuestionCostUsd(costUsd: number): string {
  if (!(costUsd > 0)) return '$0.00'
  if (costUsd < 0.005) return '< $0.01'
  return `$${costUsd.toFixed(2)}`
}

/** One-line cost summary for a model row, from its source's cost basis. */
function costLine(source: AIModelSource, cost: AIModelCostEntry | undefined): string | null {
  if (source.costBasis === 'subscription_included') {
    return 'Included in your subscription — Daylens meters nothing'
  }
  if (!cost) return null
  const perQuestion = formatQuestionCostUsd(cost.typicalQuestionCostUsd)
  return cost.questionsPerUsd > 0
    ? `≈ ${perQuestion} per question · about ${cost.questionsPerUsd} questions per $1`
    : `≈ ${perQuestion} per question`
}

function DetailCard({
  provider,
  model,
  source,
  cost,
}: {
  provider: AIProviderMode
  model: AIModelOption
  source: AIModelSource
  cost: AIModelCostEntry | undefined
}) {
  const caps: AIModelCapabilities | null = modelCapabilities(model.id)
  const costText = costLine(source, cost)
  return (
    <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 680, color: 'var(--color-text-primary)' }}>{model.label}</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 2 }}>{source.label}</div>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>{model.description}</div>
      {costText && (
        <div style={{ borderRadius: 9, border: '1px solid var(--color-border-ghost)', background: 'var(--color-surface-low)', padding: '9px 11px', display: 'grid', gap: 3 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>Cost</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>{costText}</div>
          {source.costBasis === 'metered_usd' && (
            <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', lineHeight: 1.5 }}>
              Estimate for a typical Daylens question, billed to your own {AI_PROVIDER_META[provider].label} account.
            </div>
          )}
        </div>
      )}
      {caps ? (
        <>
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>Speed</span>
              <SegmentBar value={caps.speed} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>Intelligence</span>
              <SegmentBar value={caps.intelligence} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>Context</span>
              <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{contextWindowLabel(caps.contextTokens)}</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <CapabilityBadge icon={<Eye size={13} strokeWidth={1.9} />} label="Vision" on={caps.vision} />
            <CapabilityBadge icon={<Wrench size={13} strokeWidth={1.9} />} label="Tool Use" on={caps.toolUse} />
            <CapabilityBadge icon={<Brain size={13} strokeWidth={1.9} />} label={caps.reasoning ? 'Reasoning' : 'No Reasoning'} on={caps.reasoning} />
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>No capability details for this model.</div>
      )}
    </div>
  )
}

function ManagedDetailCard({ source, costs }: { source: AIModelSource; costs: AIModelCostCatalog | null }) {
  const allowance = costs?.allowance ?? null
  return (
    <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 680, color: 'var(--color-text-primary)' }}>Daylens managed AI</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 2 }}>Included in your plan — Daylens routes the model</div>
      </div>
      {allowance ? (
        <div style={{ borderRadius: 9, border: '1px solid var(--color-border-ghost)', background: 'var(--color-surface-low)', padding: '9px 11px', display: 'grid', gap: 3 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>Allowance</div>
          <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
            ${allowance.remainingUsd.toFixed(2)} of ${allowance.grantedUsd.toFixed(2)} left
            {allowance.estimatedQuestionsRemaining != null && ` · about ${allowance.estimatedQuestionsRemaining} questions`}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', lineHeight: 1.55 }}>Allowance details are unavailable right now.</div>
      )}
      {source.unavailableReason && (
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>{source.unavailableReason}</div>
      )}
    </div>
  )
}

export function ModelSelector({
  sources,
  costs,
  currentProvider,
  currentModel,
  isOverride,
  defaultLabel,
  managedActive,
  onApply,
  onClose,
}: {
  /** Provider sources in display order (shared/aiModelSources.ts). */
  sources: AIModelSource[]
  /** Per-model costs + managed allowance from the main process; null while loading. */
  costs: AIModelCostCatalog | null
  currentProvider: AIProviderMode
  currentModel: string | null
  isOverride: boolean
  defaultLabel: string
  /** True when the account default resolves to managed routing (no key set). */
  managedActive: boolean
  onApply: (provider: AIProviderMode | null, model: string | null) => void
  onClose: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [highlightIdx, setHighlightIdx] = useState(0)

  useEffect(() => { requestAnimationFrame(() => inputRef.current?.focus()) }, [])

  const costByModel = useMemo(() => {
    const map = new Map<string, AIModelCostEntry>()
    for (const entry of costs?.models ?? []) map.set(`${entry.provider}:${entry.modelId}`, entry)
    return map
  }, [costs])

  const managedSource = sources.find((source) => source.kind === 'managed') ?? null
  const availableModelSources = sources.filter((source) => source.kind !== 'managed' && source.available && source.provider)
  const unavailableSources = sources.filter((source) => !source.available)

  const entries = useMemo<Entry[]>(() => {
    const list: Entry[] = [{ kind: 'default' }]
    if (managedSource) list.push({ kind: 'managed', source: managedSource })
    for (const source of availableModelSources) {
      const provider = source.provider!
      for (const model of AI_PROVIDER_META[provider].models) {
        list.push({ kind: 'model', source, provider, model })
      }
    }
    return list
    // sources is a fresh array per render in the parent; key off its identity.
  }, [managedSource, availableModelSources])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entries
    return entries.filter((entry) => {
      if (entry.kind === 'default') return 'default'.includes(q)
      if (entry.kind === 'managed') return 'daylens managed ai'.includes(q)
      return entry.model.label.toLowerCase().includes(q)
        || entry.source.label.toLowerCase().includes(q)
        || AI_PROVIDER_META[entry.provider].label.toLowerCase().includes(q)
        || AI_PROVIDER_META[entry.provider].shortLabel.toLowerCase().includes(q)
    })
  }, [entries, query])

  useEffect(() => { if (highlightIdx >= filtered.length) setHighlightIdx(0) }, [filtered.length, highlightIdx])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${highlightIdx}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [highlightIdx])

  const apply = useCallback((entry: Entry) => {
    // Managed can only be "selected" by clearing the override back to the
    // account default while managed routing is what the default resolves to.
    if (entry.kind === 'default' || entry.kind === 'managed') onApply(null, null)
    else onApply(entry.provider, entry.model.id)
    onClose()
  }, [onApply, onClose])

  const managedSelectable = Boolean(managedSource?.available && managedActive)

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightIdx((i) => Math.min(filtered.length - 1, i + 1)); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHighlightIdx((i) => Math.max(0, i - 1)); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      const target = filtered[highlightIdx]
      if (!target) return
      if (target.kind === 'managed' && !managedSelectable) return
      apply(target)
      return
    }
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }, [filtered, highlightIdx, apply, onClose, managedSelectable])

  const focused = filtered[highlightIdx] ?? filtered[0] ?? null
  let lastSourceId: string | null = null

  return (
    <div
      role="dialog"
      aria-label="Select model"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 110, background: 'rgba(10,12,18,0.42)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '12vh' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(720px, 94vw)', maxHeight: '72vh', display: 'flex', flexDirection: 'column', background: 'var(--color-surface)', border: '1px solid var(--color-border-ghost)', borderRadius: 14, boxShadow: '0 24px 70px rgba(0,0,0,0.30)', overflow: 'hidden', fontFamily: 'var(--font-sans)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '13px 16px', borderBottom: '1px solid var(--color-border-ghost)' }}>
          <span style={{ color: 'var(--color-text-tertiary)', display: 'inline-flex', flexShrink: 0 }}><Search size={16} strokeWidth={1.9} aria-hidden="true" /></span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setHighlightIdx(0) }}
            onKeyDown={onKeyDown}
            placeholder="Search models…"
            aria-label="Search models"
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--color-text-primary)', fontSize: 14.5 }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 262px', minHeight: 0, flex: 1 }}>
          <div ref={listRef} style={{ overflowY: 'auto', padding: '6px 8px', borderRight: '1px solid var(--color-border-ghost)' }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '18px 12px', fontSize: 13, color: 'var(--color-text-tertiary)' }}>No models match.</div>
            ) : (
              filtered.map((entry, idx) => {
                const isActive = idx === highlightIdx
                if (entry.kind === 'default') {
                  const selected = !isOverride
                  return (
                    <button
                      key="default"
                      type="button"
                      data-idx={idx}
                      onMouseEnter={() => setHighlightIdx(idx)}
                      onClick={() => apply(entry)}
                      style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '8px 10px', borderRadius: 9, border: 'none', background: isActive ? 'var(--color-surface-high)' : 'transparent', color: 'var(--color-text-primary)', textAlign: 'left', cursor: 'pointer', fontSize: 13.5, marginBottom: 2 }}
                    >
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontWeight: 600 }}>Account default</span>
                        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--color-text-tertiary)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{defaultLabel}</span>
                      </span>
                      {selected && <Check size={15} strokeWidth={2.2} color="var(--color-accent)" />}
                    </button>
                  )
                }
                if (entry.kind === 'managed') {
                  const allowance = costs?.allowance ?? null
                  const subline = !entry.source.available
                    ? entry.source.unavailableReason ?? 'Unavailable right now.'
                    : allowance
                      ? `$${allowance.remainingUsd.toFixed(2)} left${allowance.estimatedQuestionsRemaining != null ? ` · about ${allowance.estimatedQuestionsRemaining} questions` : ''}`
                      : 'Included in your plan'
                  return (
                    <div key="managed">
                      <div style={{ padding: '11px 10px 4px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)' }}>
                        Managed
                      </div>
                      <button
                        type="button"
                        data-idx={idx}
                        onMouseEnter={() => setHighlightIdx(idx)}
                        onClick={() => { if (managedSelectable) apply(entry) }}
                        disabled={!managedSelectable}
                        title={managedSelectable ? undefined : (entry.source.available ? 'Your own key serves this chat while one is configured.' : entry.source.unavailableReason ?? undefined)}
                        style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '8px 10px', borderRadius: 9, border: 'none', background: isActive ? 'var(--color-surface-high)' : 'transparent', color: entry.source.available ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)', textAlign: 'left', cursor: managedSelectable ? 'pointer' : 'default', fontSize: 13.5, marginBottom: 1, opacity: entry.source.available ? 1 : 0.75 }}
                      >
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontWeight: 600 }}>Daylens managed AI</span>
                          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--color-text-tertiary)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subline}</span>
                        </span>
                        {managedActive && !isOverride && entry.source.available && <Check size={15} strokeWidth={2.2} color="var(--color-accent)" />}
                      </button>
                    </div>
                  )
                }
                const showSource = entry.source.id !== lastSourceId
                lastSourceId = entry.source.id
                const selected = isOverride && entry.provider === currentProvider && entry.model.id === currentModel
                const cost = costByModel.get(`${entry.provider}:${entry.model.id}`)
                const subline = costLine(entry.source, cost)
                return (
                  <div key={`${entry.source.id}:${entry.model.id}`}>
                    {showSource && (
                      <div style={{ padding: '11px 10px 4px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)' }}>
                        {entry.source.label}
                      </div>
                    )}
                    <button
                      type="button"
                      data-idx={idx}
                      onMouseEnter={() => setHighlightIdx(idx)}
                      onClick={() => apply(entry)}
                      style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '7px 10px', borderRadius: 9, border: 'none', background: isActive ? 'var(--color-surface-high)' : 'transparent', color: 'var(--color-text-primary)', textAlign: 'left', cursor: 'pointer', fontSize: 13.5, marginBottom: 1 }}
                    >
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontWeight: 550, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.model.label}</span>
                        {subline && (
                          <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subline}</span>
                        )}
                      </span>
                      {selected && <Check size={15} strokeWidth={2.2} color="var(--color-accent)" />}
                    </button>
                  </div>
                )
              })
            )}
            {/* Honest absences: a source you cannot use right now says why,
                instead of silently missing from the list (DEV-201). */}
            {!query && unavailableSources.length > 0 && (
              <div style={{ margin: '10px 4px 6px', padding: '9px 10px', borderRadius: 9, border: '1px dashed var(--color-border-ghost)', display: 'grid', gap: 5 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>Not available right now</div>
                {unavailableSources.map((source) => (
                  <div key={source.id} style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', lineHeight: 1.5 }}>
                    <span style={{ fontWeight: 600, color: 'var(--color-text-secondary)' }}>{source.label}</span>
                    {' — '}
                    {source.unavailableReason}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ padding: 16, overflowY: 'auto' }}>
            {focused && focused.kind === 'model'
              ? <DetailCard provider={focused.provider} model={focused.model} source={focused.source} cost={costByModel.get(`${focused.provider}:${focused.model.id}`)} />
              : focused && focused.kind === 'managed'
                ? <ManagedDetailCard source={focused.source} costs={costs} />
                : <div style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)', lineHeight: 1.55 }}>Use whichever model your account default resolves to for this chat.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
