// The agent's one clarifying question: tappable options plus a free-text
// escape. Answering resumes the paused turn; dismissing tells the agent to
// proceed with its most defensible reading.
import { useState } from 'react'
import type { AIAgentQuestionEvent } from '@shared/types'

interface AgentQuestionCardProps {
  question: AIAgentQuestionEvent
  onAnswer: (answer: string) => void
  onDismiss: () => void
}

export function AgentQuestionCard({ question, onAnswer, onDismiss }: AgentQuestionCardProps) {
  const [freeText, setFreeText] = useState('')

  return (
    <div
      role="group"
      aria-label="Daylens needs one detail"
      style={{
        margin: '4px 0 8px',
        padding: '12px 14px',
        borderRadius: 12,
        border: '1px solid var(--color-border-ghost)',
        background: 'var(--color-surface-high)',
        maxWidth: 560,
      }}
    >
      {/* pre-line: correction previews (DEV-199) arrive as multi-line cards —
          each delta on its own line — and must not collapse into one blob. */}
      <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', whiteSpace: 'pre-line', lineHeight: 1.5 }}>
        {question.question}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        {question.options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onAnswer(option)}
            style={{
              padding: '6px 12px',
              borderRadius: 8,
              border: '1px solid var(--color-border-ghost)',
              background: 'var(--color-surface)',
              color: 'var(--color-text-primary)',
              fontSize: 12.5,
              cursor: 'pointer',
            }}
          >
            {option}
          </button>
        ))}
      </div>
      {question.allowFreeText && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (freeText.trim()) onAnswer(freeText.trim())
          }}
          style={{ display: 'flex', gap: 8, marginTop: 10 }}
        >
          <input
            value={freeText}
            onChange={(event) => setFreeText(event.target.value)}
            placeholder="Or type your own…"
            style={{
              flex: 1,
              padding: '6px 10px',
              borderRadius: 8,
              border: '1px solid var(--color-border-ghost)',
              background: 'var(--color-surface)',
              color: 'var(--color-text-primary)',
              fontSize: 12.5,
            }}
          />
          <button
            type="submit"
            disabled={!freeText.trim()}
            style={{
              padding: '6px 12px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--gradient-primary)',
              color: 'var(--color-primary-contrast)',
              fontSize: 12.5,
              cursor: freeText.trim() ? 'pointer' : 'default',
              opacity: freeText.trim() ? 1 : 0.5,
            }}
          >
            Answer
          </button>
        </form>
      )}
      <button
        type="button"
        onClick={onDismiss}
        style={{
          marginTop: 8,
          padding: 0,
          border: 'none',
          background: 'transparent',
          color: 'var(--color-text-tertiary)',
          fontSize: 11.5,
          cursor: 'pointer',
        }}
      >
        Skip — let Daylens decide
      </button>
    </div>
  )
}
