import { memo, type RefObject } from 'react'
import { Trash2 } from 'lucide-react'
import type { AIThreadSummary } from '@shared/types'
import { IconChevronDown, IconCompose } from './icons'
import { relativeTime } from './messageUtils'

export const AIThreadBar = memo(function AIThreadBar({
  threads,
  activeThreadId,
  threadPickerOpen,
  threadPickerFocusIdx,
  threadDeleteConfirm,
  hoveredThreadId,
  threadPickerRef,
  onTogglePicker,
  onNewChat,
  onFocusIdxChange,
  onHoverThread,
  onLoadThread,
  onDeleteConfirm,
  onDeleteConfirmed,
  onDismissPicker,
}: {
  threads: AIThreadSummary[]
  activeThreadId: number | null
  threadPickerOpen: boolean
  threadPickerFocusIdx: number
  threadDeleteConfirm: number | null
  hoveredThreadId: number | null
  threadPickerRef: RefObject<HTMLDivElement | null>
  onTogglePicker: () => void
  onNewChat: () => void
  onFocusIdxChange: (idx: number) => void
  onHoverThread: (id: number | null) => void
  onLoadThread: (id: number) => void
  onDeleteConfirm: (id: number) => void
  onDeleteConfirmed: (thread: AIThreadSummary) => void
  onDismissPicker: () => void
}) {
  return (
    <header className="ai-thread-bar">
      <button
        type="button"
        className="ai-thread-bar__compose"
        onClick={onNewChat}
        title="New chat"
        aria-label="New chat"
      >
        <IconCompose />
      </button>

      {threads.length > 0 && (
        <div className="ai-thread-bar__history-wrap">
          <button
            type="button"
            className={`ai-thread-bar__history${threadPickerOpen ? ' ai-thread-bar__history--open' : ''}`}
            onClick={onTogglePicker}
            aria-haspopup="listbox"
            aria-expanded={threadPickerOpen}
          >
            History
            <IconChevronDown />
          </button>

          {threadPickerOpen && (
            <>
              <div className="ai-thread-bar__backdrop" onClick={onDismissPicker} />
              <div
                ref={threadPickerRef}
                role="listbox"
                tabIndex={-1}
                className="ai-thread-bar__menu"
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    onDismissPicker()
                    return
                  }
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    onFocusIdxChange(Math.min(threadPickerFocusIdx + 1, threads.length - 1))
                    return
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault()
                    onFocusIdxChange(Math.max(threadPickerFocusIdx - 1, 0))
                    return
                  }
                  if (event.key === 'Enter') {
                    const t = threads[threadPickerFocusIdx]
                    if (t) onLoadThread(t.id)
                  }
                }}
              >
                {threads.map((thread, idx) => (
                  <div
                    key={thread.id}
                    role="option"
                    aria-selected={thread.id === activeThreadId}
                    className={`ai-thread-bar__option${
                      idx === threadPickerFocusIdx ? ' ai-thread-bar__option--focus' : ''
                    }${thread.id === activeThreadId ? ' ai-thread-bar__option--active' : ''}`}
                    onMouseEnter={() => {
                      onHoverThread(thread.id)
                      onFocusIdxChange(idx)
                    }}
                    onMouseLeave={() => onHoverThread(null)}
                  >
                    <button
                      type="button"
                      className="ai-thread-bar__option-btn"
                      onClick={() => onLoadThread(thread.id)}
                    >
                      <span className="ai-thread-bar__option-title">{thread.title}</span>
                      <span className="ai-thread-bar__option-time">{relativeTime(thread.lastMessageAt)}</span>
                    </button>
                    {threadDeleteConfirm === thread.id ? (
                      <button
                        type="button"
                        className="ai-thread-bar__delete-confirm"
                        onClick={() => onDeleteConfirmed(thread)}
                      >
                        Delete?
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="ai-thread-bar__delete"
                        style={{ opacity: hoveredThreadId === thread.id ? 1 : 0 }}
                        onClick={() => onDeleteConfirm(thread.id)}
                        aria-label={`Delete ${thread.title}`}
                      >
                        <Trash2 size={13} strokeWidth={1.9} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </header>
  )
})
