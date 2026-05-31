import { useMemo, useState } from 'react'
import type { AIProviderMode, AIThreadSettings } from '@shared/types'
import { AI_PROVIDER_META } from '../../lib/aiProvider'
import { ipc } from '../../lib/ipc'

// D4: per-chat settings — a model/provider override + additional instructions
// for one thread, without touching the global settings. Lets a user drop a
// flaky thread onto a higher-limit model (ties to the R1 rate-limit story).

const DEFAULT_VALUE = ''

export function ThreadSettingsPanel({
  threadId,
  initial,
  providerAvailability,
  globalLabel,
  onClose,
  onSaved,
}: {
  threadId: number
  initial: AIThreadSettings
  providerAvailability: Partial<Record<AIProviderMode, boolean>>
  globalLabel: string
  onClose: () => void
  onSaved: (settings: AIThreadSettings) => void
}) {
  // Model options: every model of every configured provider, encoded as
  // "<provider>::<model>" so a single <select> covers the catalog.
  const options = useMemo(() => {
    const list: { value: string; label: string }[] = [{ value: DEFAULT_VALUE, label: `Default — ${globalLabel}` }]
    for (const meta of Object.values(AI_PROVIDER_META)) {
      if (!(providerAvailability[meta.id] ?? false)) continue
      for (const model of meta.models) {
        list.push({ value: `${meta.id}::${model.id}`, label: `${meta.shortLabel} · ${model.label}` })
      }
    }
    return list
  }, [providerAvailability, globalLabel])

  const [value, setValue] = useState(initial.provider && initial.model ? `${initial.provider}::${initial.model}` : DEFAULT_VALUE)
  const [instructions, setInstructions] = useState(initial.instructions ?? '')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    const [provider, model] = value === DEFAULT_VALUE ? [null, null] : value.split('::') as [AIProviderMode, string]
    try {
      const next = await ipc.ai.setThreadSettings(threadId, {
        provider: provider ?? null,
        model: model ?? null,
        instructions: instructions.trim() || null,
      })
      onSaved(next)
      onClose()
    } catch {
      setSaving(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Chat settings"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(7, 10, 16, 0.55)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '14vh' }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{ width: 'min(440px, 92vw)', background: 'var(--color-surface, #0f141c)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, boxShadow: '0 24px 80px rgba(0,0,0,0.5)', padding: 18, display: 'grid', gap: 16 }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)' }}>Chat settings</div>

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>Model</span>
          <select
            value={value}
            onChange={(event) => setValue(event.target.value)}
            style={{ height: 36, padding: '0 10px', borderRadius: 9, border: '1px solid var(--color-border-ghost)', background: 'var(--color-surface)', color: 'var(--color-text-primary)', fontSize: 13 }}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', lineHeight: 1.5 }}>
            Overrides the global model for this chat only. Useful to move a rate-limited thread onto a higher-limit model.
          </span>
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>Additional instructions</span>
          <textarea
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder="e.g. Always answer in a terse bullet list. Assume I mean work hours only."
            rows={4}
            style={{ width: '100%', resize: 'vertical', borderRadius: 9, border: '1px solid var(--color-border-ghost)', background: 'var(--color-surface)', color: 'var(--color-text-primary)', padding: '9px 11px', fontSize: 12.5, lineHeight: 1.6, outline: 'none' }}
          />
        </label>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            type="button"
            onClick={onClose}
            style={{ padding: '8px 14px', borderRadius: 9, border: '1px solid var(--color-border-ghost)', background: 'transparent', color: 'var(--color-text-secondary)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            style={{ padding: '8px 14px', borderRadius: 9, border: '1px solid var(--color-border-ghost)', background: 'var(--color-accent-dim)', color: 'var(--color-text-primary)', fontSize: 12.5, fontWeight: 700, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1 }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
