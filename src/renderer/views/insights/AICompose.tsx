import type { ForwardedRef } from 'react'
import { forwardRef, memo, useImperativeHandle, useRef, useState } from 'react'
import { IconSend } from './icons'

export interface AIComposeHandle {
  focus: () => void
}

interface AIComposeProps {
  onSubmit: (text: string) => void
  loading: boolean
  placeholder?: string
}

// Isolated, self-contained composer.
//
// Why this is fast:
//   1. Input text lives in this component's local state, so a keystroke
//      re-renders ONLY this component — never the message list, the search
//      bar, or the workspace shell (all siblings, all memoized).
//   2. The textarea auto-grows with CSS `field-sizing: content`
//      (`.ai-composer-input` in globals.css). The old composer read the
//      textarea's scroll-height on every keystroke inside a rAF, which forces a
//      synchronous layout of the whole conversation tree — that is what made
//      typing feel frozen. There is no layout measurement read here at all.
function AIComposeImpl(
  { onSubmit, loading, placeholder }: AIComposeProps,
  ref: ForwardedRef<AIComposeHandle>,
) {
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
  }), [])

  const send = () => {
    const text = input.trim()
    if (!text || loading) return
    onSubmit(text)
    setInput('')
    // Keep focus on the composer so the next message can be typed immediately.
    textareaRef.current?.focus()
  }

  const trimmed = input.trim()

  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-end',
      gap: 8,
      borderRadius: 16,
      border: '1px solid var(--color-border-ghost)',
      background: 'var(--color-surface)',
      padding: '8px 8px 8px 16px',
      boxShadow: 'var(--color-shadow-floating)',
    }}>
      <textarea
        ref={textareaRef}
        className="ai-composer-input"
        value={input}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            send()
          }
        }}
        disabled={loading}
        rows={1}
        autoFocus
        aria-label="Ask Daylens about your work history"
        placeholder={placeholder ?? 'Ask anything about your work…'}
        style={{
          flex: 1,
          minHeight: 24,
          maxHeight: 184,
          overflowY: 'auto',
          border: 'none',
          background: 'transparent',
          outline: 'none',
          color: 'var(--color-text-primary)',
          fontSize: 13.5,
          lineHeight: '22px',
          resize: 'none',
          padding: '6px 0',
          display: 'block',
        }}
      />
      <button
        onClick={send}
        disabled={loading || !trimmed}
        type="button"
        aria-label="Send message"
        style={{
          width: 34,
          height: 34,
          padding: 0,
          borderRadius: 999,
          border: 'none',
          cursor: loading || !trimmed ? 'default' : 'pointer',
          background: trimmed && !loading ? 'var(--gradient-primary)' : 'var(--color-surface-high)',
          color: trimmed && !loading ? 'var(--color-primary-contrast)' : 'var(--color-text-tertiary)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          transition: 'background 160ms ease, color 160ms ease',
        }}
      >
        <IconSend />
      </button>
    </div>
  )
}

// React.memo so chunk-driven parent re-renders skip the composer entirely.
// `onSubmit` is a useRef-stable callback from the parent, so the composer's
// only real re-render trigger is the `loading` prop.
export const AICompose = memo(forwardRef<AIComposeHandle, AIComposeProps>(AIComposeImpl))
