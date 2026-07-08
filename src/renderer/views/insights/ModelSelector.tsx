import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Brain, Check, Eye, Search, Wrench } from 'lucide-react'
import type { AIProviderMode } from '@shared/types'
import {
  AI_PROVIDER_META,
  contextWindowLabel,
  modelCapabilities,
  type AIModelCapabilities,
  type AIModelOption,
} from '../../lib/aiProvider'

// FB8: clicking the model line opens this Raycast-style picker — a search field
// on top, models grouped by provider on the left, and a detail card on the right
// (speed / intelligence bars, context window, capability badges). Selecting a
// model applies it as the per-chat override (D4); the header subline updates.

// Only providers the user can actually run (API key present, or CLI detected)
// are offered — same gate as the per-chat settings panel.
const PROVIDER_ORDER: AIProviderMode[] = ['anthropic', 'openai', 'google', 'openrouter', 'claude-cli', 'chatgpt-cli', 'gemini-cli', 'codex-cli']

type Entry =
  | { kind: 'default' }
  | { kind: 'model'; provider: AIProviderMode; model: AIModelOption }

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

function DetailCard({ provider, model }: { provider: AIProviderMode; model: AIModelOption }) {
  const caps: AIModelCapabilities | null = modelCapabilities(model.id)
  return (
    <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 680, color: 'var(--color-text-primary)' }}>{model.label}</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 2 }}>{AI_PROVIDER_META[provider].label}</div>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>{model.description}</div>
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

export function ModelSelector({
  providerAvailability,
  currentProvider,
  currentModel,
  isOverride,
  defaultLabel,
  onApply,
  onClose,
}: {
  providerAvailability: Partial<Record<AIProviderMode, boolean>>
  currentProvider: AIProviderMode
  currentModel: string | null
  isOverride: boolean
  defaultLabel: string
  onApply: (provider: AIProviderMode | null, model: string | null) => void
  onClose: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [highlightIdx, setHighlightIdx] = useState(0)

  useEffect(() => { requestAnimationFrame(() => inputRef.current?.focus()) }, [])

  const entries = useMemo<Entry[]>(() => {
    const list: Entry[] = [{ kind: 'default' }]
    for (const provider of PROVIDER_ORDER) {
      if (!(providerAvailability[provider] ?? false)) continue
      for (const model of AI_PROVIDER_META[provider].models) {
        list.push({ kind: 'model', provider, model })
      }
    }
    return list
  }, [providerAvailability])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entries
    return entries.filter((entry) => {
      if (entry.kind === 'default') return 'default'.includes(q)
      return entry.model.label.toLowerCase().includes(q)
        || AI_PROVIDER_META[entry.provider].label.toLowerCase().includes(q)
        || AI_PROVIDER_META[entry.provider].shortLabel.toLowerCase().includes(q)
    })
  }, [entries, query])

  useEffect(() => { if (highlightIdx >= filtered.length) setHighlightIdx(0) }, [filtered.length, highlightIdx])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${highlightIdx}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [highlightIdx])

  const apply = useCallback((entry: Entry) => {
    if (entry.kind === 'default') onApply(null, null)
    else onApply(entry.provider, entry.model.id)
    onClose()
  }, [onApply, onClose])

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightIdx((i) => Math.min(filtered.length - 1, i + 1)); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHighlightIdx((i) => Math.max(0, i - 1)); return }
    if (e.key === 'Enter') { e.preventDefault(); const target = filtered[highlightIdx]; if (target) apply(target); return }
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }, [filtered, highlightIdx, apply, onClose])

  const focused = filtered[highlightIdx] ?? filtered[0] ?? null
  let lastProvider: AIProviderMode | null = null

  return (
    <div
      role="dialog"
      aria-label="Select model"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 110, background: 'rgba(10,12,18,0.42)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '12vh' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(680px, 94vw)', maxHeight: '70vh', display: 'flex', flexDirection: 'column', background: 'var(--color-surface)', border: '1px solid var(--color-border-ghost)', borderRadius: 14, boxShadow: '0 24px 70px rgba(0,0,0,0.30)', overflow: 'hidden', fontFamily: 'var(--font-sans)' }}
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

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 250px', minHeight: 0, flex: 1 }}>
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
                const showProvider = entry.provider !== lastProvider
                lastProvider = entry.provider
                const selected = isOverride && entry.provider === currentProvider && entry.model.id === currentModel
                return (
                  <div key={`${entry.provider}:${entry.model.id}`}>
                    {showProvider && (
                      <div style={{ padding: '11px 10px 4px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)' }}>
                        {AI_PROVIDER_META[entry.provider].label}
                      </div>
                    )}
                    <button
                      type="button"
                      data-idx={idx}
                      onMouseEnter={() => setHighlightIdx(idx)}
                      onClick={() => apply(entry)}
                      style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '8px 10px', borderRadius: 9, border: 'none', background: isActive ? 'var(--color-surface-high)' : 'transparent', color: 'var(--color-text-primary)', textAlign: 'left', cursor: 'pointer', fontSize: 13.5, marginBottom: 1 }}
                    >
                      <span style={{ flex: 1, minWidth: 0, fontWeight: 550, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.model.label}</span>
                      {selected && <Check size={15} strokeWidth={2.2} color="var(--color-accent)" />}
                    </button>
                  </div>
                )
              })
            )}
          </div>

          <div style={{ padding: 16, overflowY: 'auto' }}>
            {focused && focused.kind === 'model'
              ? <DetailCard provider={focused.provider} model={focused.model} />
              : <div style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)', lineHeight: 1.55 }}>Use whichever model your account default resolves to for this chat.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
