import { memo, useEffect, useRef, useState } from 'react'

interface AIComposeProps {
  onSubmit: (text: string) => void
  loading: boolean
}

function IconSend() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 13 13 3" />
      <path d="M5.5 3H13v7.5" />
    </svg>
  )
}

function AIComposeImpl({ onSubmit, loading }: AIComposeProps) {
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Render counter is unconditional so React's hook order is stable across
  // dev/prod and HMR. The console.debug side-effect is gated on NODE_ENV.
  // (The previous conditional `useRef` inside `if (NODE_ENV === 'development')`
  // tripped "Rendered more hooks than during the previous render" and crashed
  // the AI tab — Rules of Hooks violation.)
  const renderCountRef = useRef(0)
  renderCountRef.current++

  // Auto-resize the textarea to fit content (1–7 visual lines).
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = '0px'
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 24), 140)
    textarea.style.height = `${nextHeight}px`
    textarea.style.overflowY = textarea.scrollHeight > 140 ? 'auto' : 'hidden'
  }, [input])

  if (process.env.NODE_ENV === 'development') {
    // eslint-disable-next-line no-console
    console.debug('[AICompose] render #', renderCountRef.current, { loading, inputLen: input.length })
  }

  const send = () => {
    const text = input.trim()
    if (!text || loading) return
    onSubmit(text)
    setInput('')
  }

  const trimmed = input.trim()

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      borderRadius: 18,
      border: '1px solid var(--color-border-ghost)',
      background: 'var(--color-surface)',
      padding: '10px 10px 10px 16px',
      boxShadow: 'var(--color-shadow-floating)',
    }}>
      <textarea
        ref={textareaRef}
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
        aria-label="Ask Daylens about your work history"
        placeholder="Ask about your day, or ask for a report, chart, table, or export..."
        style={{
          flex: 1,
          minHeight: 20,
          maxHeight: 140,
          border: 'none',
          background: 'transparent',
          outline: 'none',
          color: 'var(--color-text-primary)',
          fontSize: 13.5,
          lineHeight: '20px',
          resize: 'none',
          padding: '8px 0',
          display: 'block',
        }}
      />
      <button
        onClick={send}
        disabled={loading || !trimmed}
        type="button"
        aria-label="Send message"
        style={{
          width: 36,
          height: 36,
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
        }}
      >
        <IconSend />
      </button>
    </div>
  )
}

// React.memo so chunk-driven parent re-renders skip the composer entirely.
// Default shallow comparison is sufficient: onSubmit is wrapped in a
// useRef-stable callback by the parent, and `loading` is the only prop the
// composer actually wants to react to.
export const AICompose = memo(AIComposeImpl)
