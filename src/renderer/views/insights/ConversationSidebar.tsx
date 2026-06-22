import { memo, useMemo, useState } from 'react'
import { FileText, Trash2 } from 'lucide-react'
import type { AIThreadSummary } from '@shared/types'
import { IconArchive, IconSearch } from './icons'

// D1: a proper conversation list — grouped by recency, searchable, with an
// Archive section and the current chat highlighted. FB3: the new-chat affordance
// and the collapse toggle live in the app header now (the sidebar is hidden by
// default), so this is just the list. FB5: Notion-style section headers + subtle
// active/hover rows. FB6: auto Day-report threads read as reports, not chats.

export interface ConversationSidebarProps {
  threads: AIThreadSummary[]
  activeThreadId: number | null
  onSelect: (id: number) => void
  onDelete: (thread: AIThreadSummary) => void
  onArchive: (thread: AIThreadSummary, archived: boolean) => void
}

const GROUP_ORDER = ['Today', 'Yesterday', 'Previous 7 Days', 'Previous 30 Days', 'Older'] as const
type GroupLabel = (typeof GROUP_ORDER)[number]

const DAY_MS = 86_400_000

// FB6: auto-generated day reports are titled "Day report YYYY-MM-DD". Detect them
// so they read as generated reports, not conversations.
const DAY_REPORT_RE = /^Day report \d{4}-\d{2}-\d{2}$/

function isDayReportThread(thread: Pick<AIThreadSummary, 'title'>): boolean {
  return DAY_REPORT_RE.test(thread.title.trim())
}

function recencyGroupOf(ms: number): GroupLabel {
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (ms >= startToday) return 'Today'
  if (ms >= startToday - DAY_MS) return 'Yesterday'
  if (ms >= startToday - 7 * DAY_MS) return 'Previous 7 Days'
  if (ms >= startToday - 30 * DAY_MS) return 'Previous 30 Days'
  return 'Older'
}

function matches(thread: AIThreadSummary, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return thread.title.toLowerCase().includes(q) || (thread.lastSnippet ?? '').toLowerCase().includes(q)
}

function ThreadRow({
  thread,
  active,
  archived,
  hovered,
  confirmingDelete,
  onSelect,
  onHover,
  onArchive,
  onRequestDelete,
  onConfirmDelete,
}: {
  thread: AIThreadSummary
  active: boolean
  archived: boolean
  hovered: boolean
  confirmingDelete: boolean
  onSelect: () => void
  onHover: (hovering: boolean) => void
  onArchive: () => void
  onRequestDelete: () => void
  onConfirmDelete: () => void
}) {
  const isReport = isDayReportThread(thread)
  return (
    <div
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 2, borderRadius: 8, marginBottom: 1,
        background: active ? 'var(--color-surface-high)' : hovered ? 'var(--color-surface-muted)' : 'transparent',
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
        title={thread.title}
        style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, textAlign: 'left', padding: '6px 9px', border: 'none', background: 'transparent', color: 'var(--color-text-primary)', fontSize: 12.5, cursor: 'pointer' }}
      >
        {isReport && (
          <span style={{ display: 'inline-flex', flexShrink: 0, color: 'var(--color-text-tertiary)' }}>
            <FileText size={13} strokeWidth={1.8} aria-hidden="true" />
          </span>
        )}
        <span style={{ flex: 1, minWidth: 0, fontWeight: active ? 650 : 520, color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: archived ? 0.7 : 1 }}>
          {thread.title || 'New chat'}
        </span>
      </button>
      {confirmingDelete ? (
        <button
          type="button"
          onClick={onConfirmDelete}
          style={{ flexShrink: 0, padding: '3px 7px', marginRight: 4, border: 'none', borderRadius: 4, background: 'rgba(239,68,68,0.12)', color: '#ef4444', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
        >
          Delete?
        </button>
      ) : (hovered || active) ? (
        <div style={{ display: 'flex', flexShrink: 0, marginRight: 3 }}>
          <button
            type="button"
            onClick={onArchive}
            aria-label={archived ? `Unarchive ${thread.title}` : `Archive ${thread.title}`}
            title={archived ? 'Unarchive' : 'Archive'}
            style={{ width: 24, height: 24, border: 'none', borderRadius: 5, background: 'transparent', color: 'var(--color-text-tertiary)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}
          >
            <IconArchive size={12} />
          </button>
          <button
            type="button"
            onClick={onRequestDelete}
            aria-label={`Delete ${thread.title}`}
            title="Delete"
            style={{ width: 24, height: 24, border: 'none', borderRadius: 5, background: 'transparent', color: 'var(--color-text-tertiary)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}
          >
            <Trash2 size={12} strokeWidth={1.9} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  )
}

function ConversationSidebarImpl({
  threads,
  activeThreadId,
  onSelect,
  onDelete,
  onArchive,
}: ConversationSidebarProps) {
  const [query, setQuery] = useState('')
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [archiveOpen, setArchiveOpen] = useState(false)

  const { groups, archived } = useMemo(() => {
    const active = threads.filter((t) => !t.archived && matches(t, query))
    const arch = threads.filter((t) => t.archived && matches(t, query))
    const byGroup = new Map<GroupLabel, AIThreadSummary[]>()
    for (const thread of [...active].sort((a, b) => b.lastMessageAt - a.lastMessageAt)) {
      const label = recencyGroupOf(thread.lastMessageAt)
      const bucket = byGroup.get(label) ?? []
      bucket.push(thread)
      byGroup.set(label, bucket)
    }
    const ordered = GROUP_ORDER
      .map((label) => ({ label, items: byGroup.get(label) ?? [] }))
      .filter((g) => g.items.length > 0)
    return { groups: ordered, archived: arch.sort((a, b) => b.lastMessageAt - a.lastMessageAt) }
  }, [threads, query])

  const totalActive = threads.filter((t) => !t.archived).length

  const renderRow = (thread: AIThreadSummary, isArchived: boolean) => (
    <ThreadRow
      key={thread.id}
      thread={thread}
      active={thread.id === activeThreadId}
      archived={isArchived}
      hovered={hoveredId === thread.id}
      confirmingDelete={confirmDeleteId === thread.id}
      onSelect={() => { setConfirmDeleteId(null); onSelect(thread.id) }}
      onHover={(hovering) => setHoveredId(hovering ? thread.id : null)}
      onArchive={() => { setConfirmDeleteId(null); onArchive(thread, !isArchived) }}
      onRequestDelete={() => setConfirmDeleteId(thread.id)}
      onConfirmDelete={() => { setConfirmDeleteId(null); void onDelete(thread) }}
    />
  )

  return (
    <aside
      style={{ flexShrink: 0, width: 248, display: 'flex', flexDirection: 'column', height: '100%', borderRight: '1px solid var(--color-border-ghost)', background: 'var(--color-surface-low)' }}
      aria-label="Conversations"
    >
      <div style={{ flexShrink: 0, padding: '12px 10px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, height: 32, padding: '0 9px', borderRadius: 8, border: '1px solid var(--color-border-ghost)', background: 'var(--color-surface)' }}>
          <span style={{ color: 'var(--color-text-tertiary)', display: 'inline-flex', flexShrink: 0 }}><IconSearch size={13} /></span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search chats"
            aria-label="Search chats"
            style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none', color: 'var(--color-text-primary)', fontSize: 12 }}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 12px' }}>
        {totalActive === 0 && archived.length === 0 ? (
          <div style={{ padding: '14px 8px', fontSize: 12, color: 'var(--color-text-tertiary)', lineHeight: 1.5 }}>
            No chats yet. Ask Daylens anything to start one.
          </div>
        ) : groups.length === 0 && archived.length === 0 ? (
          <div style={{ padding: '14px 8px', fontSize: 12, color: 'var(--color-text-tertiary)' }}>No matches.</div>
        ) : (
          groups.map((group) => (
            <div key={group.label} style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', padding: '0 9px 5px' }}>
                {group.label}
              </div>
              {group.items.map((thread) => renderRow(thread, false))}
            </div>
          ))
        )}

        {archived.length > 0 && (
          <div style={{ marginTop: 16, borderTop: '1px solid var(--color-border-ghost)', paddingTop: 10 }}>
            <button
              type="button"
              onClick={() => setArchiveOpen((v) => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '4px 9px', border: 'none', background: 'transparent', color: 'var(--color-text-tertiary)', cursor: 'pointer', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}
            >
              <IconArchive size={12} />
              Archived ({archived.length})
              <span style={{ marginLeft: 'auto', fontSize: 11 }}>{archiveOpen ? '–' : '+'}</span>
            </button>
            {archiveOpen && <div style={{ marginTop: 4 }}>{archived.map((thread) => renderRow(thread, true))}</div>}
          </div>
        )}
      </div>
    </aside>
  )
}

export const ConversationSidebar = memo(ConversationSidebarImpl)
