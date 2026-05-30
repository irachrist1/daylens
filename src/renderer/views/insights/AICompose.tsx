import { memo, useCallback, useMemo, useState } from 'react'
import { AI_PROVIDER_META } from '../../lib/aiProvider'
import type { AIProviderMode } from '@shared/types'

interface AIComposeProps {
  onSubmit: (text: string) => void
  loading: boolean
  provider?: AIProviderMode | null
  onNewChat?: () => void
}

function IconSend() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 13 13 3" />
      <path d="M5.5 3H13v7.5" />
    </svg>
  )
}

function IconPlus() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M8 3v10M3 8h10" />
    </svg>
  )
}

function AIComposeImpl({ onSubmit, loading, provider, onNewChat }: AIComposeProps) {
  const [input, setInput] = useState('')
  const trimmed = input.trim()
  const providerLabel = provider ? AI_PROVIDER_META[provider].shortLabel : null

  const rows = useMemo(
    () => Math.min(7, Math.max(1, (input.match(/\n/g)?.length ?? 0) + 1)),
    [input],
  )

  const send = useCallback(() => {
    const text = input.trim()
    if (!text || loading) return
    onSubmit(text)
    setInput('')
  }, [input, loading, onSubmit])

  return (
    <div className="ai-compose">
      <textarea
        value={input}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            send()
          }
        }}
        disabled={loading}
        rows={rows}
        aria-label="Ask Daylens about your work history"
        placeholder="Ask anything about your tracked work…"
        className="ai-compose__input"
      />
      <div className="ai-compose__footer">
        <div className="ai-compose__left">
          {onNewChat && (
            <button
              type="button"
              className="ai-compose__icon-btn"
              onClick={onNewChat}
              title="New chat"
              aria-label="New chat"
            >
              <IconPlus />
            </button>
          )}
          {providerLabel && (
            <span className="ai-compose__provider">{providerLabel}</span>
          )}
        </div>
        <button
          type="button"
          onClick={send}
          disabled={loading || !trimmed}
          aria-label="Send message"
          className={`ai-compose__send${trimmed && !loading ? ' ai-compose__send--ready' : ''}`}
        >
          <IconSend />
        </button>
      </div>
    </div>
  )
}

export const AICompose = memo(AIComposeImpl)
