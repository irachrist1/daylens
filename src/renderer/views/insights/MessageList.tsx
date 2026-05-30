import { memo, useMemo } from 'react'
import type { AIMessageAction, FocusSession } from '@shared/types'
import { ANALYTICS_EVENT } from '@shared/analytics'
import { track } from '../../lib/analytics'
import { ipc } from '../../lib/ipc'
import { StreamingMessage } from './StreamingMessage'
import { MarkdownMessage } from './markdown'
import { FocusReviewActionCard } from './FocusReviewActionCard'
import {
  IconActionButton,
  IconArtifactFile,
  IconCopy,
  IconRetry,
  IconThumbsDown,
  IconThumbsUp,
} from './icons'
import { artifactFormatLabel, messageActionKey } from './messageUtils'
import { actionFeedbackKey } from './types'
import type { ActionFeedbackEntry, MessageAction, MessageActionStateEntry, ThreadMessage } from './types'

export interface MessageListProps {
  messages: ThreadMessage[]
  messageActionState: Record<string, MessageActionStateEntry>
  actionFeedback: Record<string, ActionFeedbackEntry>
  latestCompletedAssistantId: string | number | undefined
  reducedMotion: boolean
  activeFocusSession: FocusSession | null
  scrollToBottom: () => void
  analyticsContext: (extra?: Record<string, unknown>) => Record<string, unknown>
  onRetry: (index: number, message: ThreadMessage) => void
  onCopy: (messageId: string | number, content: string, answerKind: ThreadMessage['answerKind']) => void
  onRate: (message: ThreadMessage, rating: 'up' | 'down' | null) => void
  onMessageAction: (messageId: string | number, action: AIMessageAction, options?: { reviewNote?: string }) => void
  onSend: (text: string, options?: { trigger?: 'suggested' }) => void
  triggerActionFeedback: (messageId: string | number, action: MessageAction, options?: { successMs?: number }) => void
}

function MessageListImpl({
  messages,
  messageActionState,
  actionFeedback,
  latestCompletedAssistantId,
  reducedMotion,
  activeFocusSession,
  scrollToBottom,
  analyticsContext,
  onRetry,
  onCopy,
  onRate,
  onMessageAction,
  onSend,
  triggerActionFeedback,
}: MessageListProps) {
  const items = useMemo(() => messages.map((message, index) => (
    message.role === 'user' ? (
      <div key={message.id} className="ai-msg ai-msg--user">
        <div className="ai-msg__bubble">{message.content}</div>
      </div>
    ) : (
      <div key={message.id} className="ai-msg ai-msg--assistant">
        <div className={`ai-msg__body${message.state === 'error' ? ' ai-msg__body--error' : ''}`}>
          {message.state === 'pending' ? (
            <StreamingMessage
              messageId={String(message.id)}
              fallback={<div className="ai-msg__thinking">Thinking…</div>}
              renderContent={(text) => <MarkdownMessage content={text} />}
              onSnapshotUpdate={scrollToBottom}
            />
          ) : (
            <>
              {message.state === 'error' && (
                <div className="ai-msg__error-label">Provider error</div>
              )}
              <MarkdownMessage content={message.content} />
              {(message.actions?.length ?? 0) > 0 && (
                <div className="ai-msg__actions-grid">
                  {message.actions?.map((action) => {
                    const key = messageActionKey(message.id, action)
                    const state = messageActionState[key]

                    if (action.kind === 'review_focus_session') {
                      return (
                        <FocusReviewActionCard
                          key={key}
                          action={action}
                          state={state}
                          onSave={(reviewNote) => void onMessageAction(message.id, action, { reviewNote })}
                        />
                      )
                    }

                    const disabled = state?.busy
                      || (action.kind === 'start_focus_session' && Boolean(activeFocusSession))
                      || (action.kind === 'stop_focus_session' && activeFocusSession?.id !== action.sessionId)
                    const contextHint = action.kind === 'start_focus_session' && activeFocusSession
                      ? 'A focus session is already active.'
                      : action.kind === 'stop_focus_session' && activeFocusSession?.id !== action.sessionId
                        ? 'That focus session is no longer active.'
                        : null

                    return (
                      <div key={key} className="ai-msg__action-row">
                        <div className="ai-msg__action-copy">
                          {contextHint ?? (action.kind === 'start_focus_session'
                            ? 'Start a focus session from this chat context.'
                            : 'Stop the active focus session from here.')}
                        </div>
                        <div className="ai-msg__action-buttons">
                          <button
                            type="button"
                            onClick={() => void onMessageAction(message.id, action)}
                            disabled={disabled}
                            className="ai-msg__action-btn"
                          >
                            {state?.busy
                              ? (action.kind === 'start_focus_session' ? 'Starting…' : 'Stopping…')
                              : action.label}
                          </button>
                          {state?.successLabel && <span className="ai-msg__action-ok">{state.successLabel}</span>}
                          {state?.error && <span className="ai-msg__action-err">{state.error}</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              {(message.artifacts?.length ?? 0) > 0 && (
                <div className="ai-msg__artifacts">
                  {message.artifacts?.map((artifact) => (
                    <button
                      key={`${message.id}:${artifact.id}`}
                      type="button"
                      onClick={() => void ipc.shell.openPath(artifact.path)}
                      className="ai-msg__artifact"
                    >
                      {(() => {
                        const color = artifact.format === 'csv' ? '#16a34a' : artifact.format === 'html' ? '#7c3aed' : artifact.format === 'json' ? '#f59e0b' : '#2563eb'
                        return (
                          <div className="ai-msg__artifact-icon" style={{ background: `${color}15`, borderColor: `${color}28`, color }}>
                            <IconArtifactFile kind={artifact.format === 'csv' ? 'csv' : artifact.format === 'html' ? 'html_chart' : 'markdown'} />
                          </div>
                        )
                      })()}
                      <div className="ai-msg__artifact-meta">
                        <div className="ai-msg__artifact-title">{artifact.title}</div>
                        <div className="ai-msg__artifact-sub">{artifactFormatLabel(artifact)} · click to open</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {message.id === latestCompletedAssistantId && message.state === 'complete' && (message.suggestedFollowUps?.length ?? 0) >= 2 && (
                <div className="ai-msg__followups">
                  {message.suggestedFollowUps?.map((suggestion) => (
                    <button
                      key={`${message.id}:${suggestion.text}`}
                      type="button"
                      onClick={() => {
                        track(ANALYTICS_EVENT.AI_SUGGESTED_QUESTION_CLICKED, analyticsContext({
                          answer_kind: message.answerKind ?? null,
                          source: suggestion.source,
                          trigger: 'suggested',
                        }))
                        onSend(suggestion.text, { trigger: 'suggested' })
                      }}
                      className="ai-msg__followup"
                    >
                      {suggestion.text}
                    </button>
                  ))}
                </div>
              )}
              <div className="ai-msg__toolbar">
                <IconActionButton
                  label="Copy response"
                  feedbackLabel={actionFeedback[actionFeedbackKey(message.id, 'copy')]?.success ? 'Copied' : undefined}
                  success={actionFeedback[actionFeedbackKey(message.id, 'copy')]?.success ?? false}
                  pulseNonce={actionFeedback[actionFeedbackKey(message.id, 'copy')]?.pulseNonce ?? 0}
                  reducedMotion={reducedMotion}
                  onClick={() => onCopy(message.id, message.content, message.answerKind)}
                >
                  <IconCopy />
                </IconActionButton>
                <IconActionButton
                  label="Thumbs up"
                  tone="positive"
                  selected={message.rating === 'up'}
                  pulseNonce={actionFeedback[actionFeedbackKey(message.id, 'up')]?.pulseNonce ?? 0}
                  reducedMotion={reducedMotion}
                  onClick={() => {
                    const nextRating = message.rating === 'up' ? null : 'up'
                    triggerActionFeedback(message.id, 'up')
                    void onRate(message, nextRating)
                    track(ANALYTICS_EVENT.AI_ANSWER_RATED, analyticsContext({
                      answer_kind: message.answerKind ?? null,
                      rating: nextRating ?? 'cleared',
                      trigger: 'manual',
                    }))
                  }}
                >
                  <IconThumbsUp />
                </IconActionButton>
                <IconActionButton
                  label="Thumbs down"
                  tone="negative"
                  selected={message.rating === 'down'}
                  pulseNonce={actionFeedback[actionFeedbackKey(message.id, 'down')]?.pulseNonce ?? 0}
                  reducedMotion={reducedMotion}
                  onClick={() => {
                    const nextRating = message.rating === 'down' ? null : 'down'
                    triggerActionFeedback(message.id, 'down')
                    void onRate(message, nextRating)
                    track(ANALYTICS_EVENT.AI_ANSWER_RATED, analyticsContext({
                      answer_kind: message.answerKind ?? null,
                      rating: nextRating ?? 'cleared',
                      trigger: 'manual',
                    }))
                  }}
                >
                  <IconThumbsDown />
                </IconActionButton>
                {message.id === latestCompletedAssistantId && (
                  <IconActionButton
                    label="Retry response"
                    pulseNonce={actionFeedback[actionFeedbackKey(message.id, 'retry')]?.pulseNonce ?? 0}
                    reducedMotion={reducedMotion}
                    onClick={() => onRetry(index, message)}
                  >
                    <IconRetry />
                  </IconActionButton>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    )
  )), [
    messages,
    messageActionState,
    actionFeedback,
    latestCompletedAssistantId,
    reducedMotion,
    activeFocusSession,
    scrollToBottom,
    analyticsContext,
    onRetry,
    onCopy,
    onRate,
    onMessageAction,
    onSend,
    triggerActionFeedback,
  ])

  return <div className="ai-message-list">{items}</div>
}

export const MessageList = memo(MessageListImpl)
