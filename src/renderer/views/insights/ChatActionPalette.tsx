import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// D3: an in-chat ⌘K action palette scoped to the focused (latest) message.
// Mirrors the global CommandPalette's interaction model (fuzzy filter, arrow /
// enter / esc, same modal chrome) but operates on chat actions passed in by
// AIWorkspace, so the chat state stays where it lives. The accelerators shown
// here are also wired as direct shortcuts in AIWorkspace.

export interface ChatPaletteAction {
  id: string
  label: string
  hint?: string
  accelerator?: string
  perform: () => void | Promise<void>
}

function fuzzyScore(haystack: string, needle: string): number {
  if (!needle) return 1
  const h = haystack.toLowerCase()
  const n = needle.toLowerCase()
  if (h.startsWith(n)) return 4
  if (h.includes(` ${n}`)) return 3
  if (h.includes(n)) return 2
  let i = 0
  for (const ch of h) {
    if (ch === n[i]) i += 1
    if (i === n.length) return 1
  }
  return 0
}

export function ChatActionPalette({
  isOpen,
  actions,
  onClose,
}: {
  isOpen: boolean
  actions: ChatPaletteAction[]
  onClose: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [highlightIdx, setHighlightIdx] = useState(0)

  useEffect(() => {
    if (!isOpen) return
    setQuery('')
    setHighlightIdx(0)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [isOpen])

  const close = useCallback(() => { onClose(); setQuery('') }, [onClose])

  const filtered = useMemo(() => {
    const q = query.trim()
    return actions
      .map((action) => ({
        action,
        score: Math.max(fuzzyScore(action.label, q), action.hint ? fuzzyScore(action.hint, q) : 0),
      }))
      .filter((entry) => q.length === 0 || entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.action)
  }, [actions, query])

  useEffect(() => {
    if (highlightIdx >= filtered.length) setHighlightIdx(0)
  }, [filtered.length, highlightIdx])

  const handleKey = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlightIdx((idx) => Math.min(filtered.length - 1, idx + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightIdx((idx) => Math.max(0, idx - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const target = filtered[highlightIdx]
      if (target) void Promise.resolve(target.perform()).finally(close)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }, [filtered, highlightIdx, close])

  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-label="Chat actions"
      onClick={close}
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(7, 10, 16, 0.55)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '14vh' }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{ width: 'min(520px, 92vw)', maxHeight: '64vh', display: 'flex', flexDirection: 'column', background: 'var(--color-surface, #0f141c)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, boxShadow: '0 24px 80px rgba(0,0,0,0.5)', overflow: 'hidden' }}
      >
        <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setHighlightIdx(0) }}
            onKeyDown={handleKey}
            placeholder="Chat actions…"
            style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', color: 'var(--color-text-primary)', fontSize: 15, letterSpacing: '-0.01em' }}
          />
        </div>
        <div style={{ overflowY: 'auto', padding: '6px 0' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '18px 16px', fontSize: 13, color: 'var(--color-text-tertiary)' }}>No matching actions.</div>
          ) : (
            filtered.map((action, idx) => {
              const isActive = idx === highlightIdx
              return (
                <button
                  key={action.id}
                  type="button"
                  onMouseEnter={() => setHighlightIdx(idx)}
                  onClick={() => { void Promise.resolve(action.perform()).finally(close) }}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '9px 16px', background: isActive ? 'rgba(173,198,255,0.08)' : 'transparent', color: 'var(--color-text-primary)', border: 'none', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}
                >
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }}>{action.label}</span>
                    {action.hint && <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{action.hint}</span>}
                  </span>
                  {action.accelerator && (
                    <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginLeft: 12, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                      {action.accelerator}
                    </span>
                  )}
                </button>
              )
            })
          )}
        </div>
        <div style={{ padding: '8px 16px', borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: 11, color: 'var(--color-text-tertiary)' }}>
          ↑ ↓ to move · ↵ to run · esc to close
        </div>
      </div>
    </div>
  )
}
