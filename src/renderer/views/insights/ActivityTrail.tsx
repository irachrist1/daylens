// The live activity trail on AI answers: while a turn runs, a calm stack of
// human one-liners under the question — one in-progress row, finished rows
// check-marked, failures stated plainly. When the turn settles, completed
// answers show a quiet summary ("Used 4 sources · 1 file") next to the
// existing "What the AI saw" pill; both open the context-packet inspector.
// Persisted answers reconstruct the same trail from their tool trace.
//
// Labels arrive pre-built from the whitelist in shared/agentTrail — this file
// renders them and must never reach into tool inputs or outputs itself.
import { useState, useSyncExternalStore } from 'react'
import type { AIAgentStep } from '@shared/types'
import {
  collapseTrail,
  liveTrailRows,
  stepsFromToolTrace,
  summarizeAgentTurn,
} from '@shared/agentTrail'
import { getStreamingStatus, getStreamingSteps, subscribeStreaming } from './streamingStore'
import type { ThreadMessage } from './types'

function StepGlyph({ state, reducedMotion }: { state: AIAgentStep['state']; reducedMotion: boolean }) {
  if (state === 'done') {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style={{ flexShrink: 0, color: 'var(--color-text-tertiary)' }}>
        <path d="M2.5 6.5 L5 9 L9.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (state === 'failed') {
    return (
      <span aria-hidden="true" style={{ width: 12, textAlign: 'center', flexShrink: 0, color: '#f59e0b', fontSize: 11, fontWeight: 700, lineHeight: 1 }}>
        !
      </span>
    )
  }
  return (
    <span style={{ width: 12, display: 'inline-flex', justifyContent: 'center', flexShrink: 0 }}>
      <span
        className={reducedMotion ? undefined : 'ai-trail-dot'}
        style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--color-primary)' }}
      />
    </span>
  )
}

function StepRow({ step, reducedMotion }: { step: AIAgentStep; reducedMotion: boolean }) {
  const failed = step.state === 'failed'
  const active = step.state === 'active'
  return (
    <div className="ai-message-in" style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 20 }}>
      <StepGlyph state={step.state} reducedMotion={reducedMotion} />
      <span style={{
        fontSize: 12.5,
        lineHeight: 1.5,
        color: active ? 'var(--color-text-secondary)' : 'var(--color-text-tertiary)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {step.label}
        {active && '…'}
        {failed && <span style={{ color: '#f59e0b' }}> — couldn’t finish, kept going</span>}
      </span>
    </div>
  )
}

function TrailStack({ steps, reducedMotion }: { steps: AIAgentStep[]; reducedMotion: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const { visible, hiddenCount } = collapseTrail(steps, expanded ? Number.POSITIVE_INFINITY : undefined)
  return (
    <div style={{ display: 'grid', gap: 2 }}>
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 20, border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', color: 'var(--color-text-tertiary)', fontSize: 12, fontWeight: 600, textAlign: 'left' }}
        >
          <span style={{ width: 12 }} />
          {hiddenCount} earlier step{hiddenCount === 1 ? '' : 's'}
        </button>
      )}
      {visible.map((step) => (
        <StepRow key={step.id} step={step} reducedMotion={reducedMotion} />
      ))}
    </div>
  )
}

/**
 * The trail under an in-flight answer. Subscribes to the streaming store per
 * message (same pattern as <StreamingMessage>), so step arrivals re-render
 * only this component — never the list or the composer.
 */
export function LiveActivityTrail({ messageId, reducedMotion }: { messageId: string; reducedMotion: boolean }) {
  const steps = useSyncExternalStore(
    (listener) => subscribeStreaming(messageId, listener),
    () => getStreamingSteps(messageId),
    () => [] as AIAgentStep[],
  )
  const status = useSyncExternalStore(
    (listener) => subscribeStreaming(messageId, listener),
    () => getStreamingStatus(messageId),
    () => '',
  )
  const rows = liveTrailRows(steps, status)
  if (rows.length === 0) return null
  return (
    <div style={{ marginBottom: 10 }}>
      <TrailStack steps={rows} reducedMotion={reducedMotion} />
    </div>
  )
}

/** "Thinking" placeholder that steps aside once the trail has rows to show. */
export function PendingFallback({ messageId }: { messageId: string }) {
  const steps = useSyncExternalStore(
    (listener) => subscribeStreaming(messageId, listener),
    () => getStreamingSteps(messageId),
    () => [] as AIAgentStep[],
  )
  const status = useSyncExternalStore(
    (listener) => subscribeStreaming(messageId, listener),
    () => getStreamingStatus(messageId),
    () => '',
  )
  if (steps.length > 0 || status) return null
  return (
    <div style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>
      Thinking<span className="ai-caret" />
    </div>
  )
}

const pillStyle: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 600,
  padding: '3px 10px',
  borderRadius: 999,
  border: '1px solid var(--color-border-ghost)',
  background: 'transparent',
  color: 'var(--color-text-tertiary)',
}

/**
 * The settled trail on a completed answer: a summary pill whose counts come
 * from the same aggregation the inspector uses, an expandable static trail
 * reconstructed from the persisted tool trace, and the existing
 * "What the AI saw" pill. Renders nothing for non-agent answers.
 */
export function SettledActivityTrail({
  message,
  canInspect,
  onInspect,
  reducedMotion,
}: {
  message: ThreadMessage
  canInspect: boolean
  onInspect: () => void
  reducedMotion: boolean
}) {
  const [showSteps, setShowSteps] = useState(false)
  const agent = message.agent
  if (!agent) return null
  const steps = stepsFromToolTrace(agent.toolTrace)
  const summary = summarizeAgentTurn(agent)
  if (steps.length === 0 && !summary?.label && !canInspect) return null
  return (
    <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        {steps.length > 0 && (
          <button
            type="button"
            onClick={() => setShowSteps((value) => !value)}
            aria-expanded={showSteps}
            title={showSteps ? 'Hide the steps this answer took' : 'Show the steps this answer took'}
            style={{ ...pillStyle, cursor: 'pointer' }}
          >
            {showSteps ? '▾' : '▸'} {steps.length} step{steps.length === 1 ? '' : 's'}
          </button>
        )}
        {summary?.label && (
          <button
            type="button"
            onClick={canInspect ? onInspect : () => setShowSteps((value) => !value)}
            title={canInspect ? 'Open everything the AI was shown for this answer' : 'Show the steps this answer took'}
            style={{ ...pillStyle, color: 'var(--color-text-secondary)', cursor: 'pointer' }}
          >
            {summary.label}
          </button>
        )}
        {canInspect && (
          <button
            type="button"
            onClick={onInspect}
            title="Open the recorded context packet for this answer"
            style={{ ...pillStyle, cursor: 'pointer' }}
          >
            What the AI saw
          </button>
        )}
      </div>
      {showSteps && steps.length > 0 && (
        <TrailStack steps={steps} reducedMotion={reducedMotion} />
      )}
    </div>
  )
}
