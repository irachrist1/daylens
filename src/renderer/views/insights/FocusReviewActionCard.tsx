import { useState } from 'react'
import type { AIMessageAction } from '@shared/types'
import type { MessageActionStateEntry } from './types'

type ReviewFocusAction = Extract<AIMessageAction, { kind: 'review_focus_session' }>

export function FocusReviewActionCard({
  action,
  state,
  onSave,
}: {
  action: ReviewFocusAction
  state?: MessageActionStateEntry
  onSave: (note: string) => void
}) {
  const [draft, setDraft] = useState(action.suggestedNote ?? '')

  return (
    <div className="ai-focus-review">
      <div className="ai-focus-review__hint">Save a short reflection to this focus session.</div>
      <textarea
        aria-label="Focus session review"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={action.placeholder ?? 'Add a short focus review'}
        rows={4}
        className="ai-focus-review__input"
      />
      <div className="ai-focus-review__actions">
        <button
          type="button"
          onClick={() => onSave(draft)}
          disabled={state?.busy}
          className="ai-focus-review__save"
        >
          {state?.busy ? 'Saving…' : action.label}
        </button>
        {state?.successLabel && <span className="ai-focus-review__ok">{state.successLabel}</span>}
        {state?.error && <span className="ai-focus-review__err">{state.error}</span>}
      </div>
    </div>
  )
}
