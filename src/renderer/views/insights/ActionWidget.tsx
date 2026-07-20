import type {
  AIActionWidget,
  AIMemoryOpPreview,
  AIMemoryProposal,
  AIMergeBlocksProposal,
  AIRenameBlockProposal,
} from '@shared/types'
import type { ActionWidgetStateEntry } from './types'

// DEV-109 — the inline preview→confirm widget (ai-actions.md). The AI proposes a
// change; this card shows exactly what would happen and commits ONLY when the
// user clicks Confirm. The look matches the existing inline action cards so it
// feels native (invariant 4). `surface: 'canvas'` is reserved for richer
// multi-item edits; for these one-line actions every proposal is a card.

export interface ActionWidgetProps {
  widget: AIActionWidget
  state?: ActionWidgetStateEntry
  onConfirm: (widget: AIActionWidget) => void
  onUndo: (proposalId: string, undo: NonNullable<ActionWidgetStateEntry['undo']>) => void
  onDismiss: (widget: AIActionWidget) => void
}

function IconCheck() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3.5 8.5l2.8 2.8L12.5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconUndo() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M6 3.5L2.5 7 6 10.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.5 7H10a3.5 3.5 0 010 7H7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const CARD: React.CSSProperties = {
  borderRadius: 12,
  border: '1px solid var(--color-border-ghost)',
  background: 'var(--color-surface-low)',
  padding: 14,
  display: 'grid',
  gap: 12,
}

const PRIMARY_BTN: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 9,
  border: '1px solid transparent',
  background: 'var(--color-primary)',
  color: 'var(--color-on-primary, #fff)',
  fontSize: 12.5,
  fontWeight: 700,
  cursor: 'pointer',
}

const GHOST_BTN: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 9,
  border: '1px solid var(--color-border-ghost)',
  background: 'var(--color-surface)',
  color: 'var(--color-text-secondary)',
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
}

const DANGER_BTN: React.CSSProperties = {
  ...PRIMARY_BTN,
  background: '#dc2626',
}

function memoryHeader(proposal: AIMemoryProposal): string {
  const kinds = new Set(proposal.ops.map((op) => op.op))
  if (kinds.size === 1 && kinds.has('add')) return 'Memory · would save'
  if (kinds.size === 1 && kinds.has('delete')) return 'Memory · would forget'
  if (kinds.size === 1 && kinds.has('update')) return 'Memory · would update'
  return 'Memory · would change'
}

function OpBadge({ op }: { op: AIMemoryOpPreview['op'] }) {
  const meta = op === 'add'
    ? { label: 'Add', color: 'var(--color-focus-green, #16a34a)' }
    : op === 'delete'
      ? { label: 'Forget', color: '#dc2626' }
      : { label: 'Update', color: 'var(--color-primary)' }
  return (
    <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: meta.color, background: 'var(--color-surface)', border: `1px solid ${meta.color}33`, borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap' }}>
      {meta.label}
    </span>
  )
}

function MemoryPreview({ proposal }: { proposal: AIMemoryProposal }) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {proposal.ops.map((op, index) => (
        <div key={index} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ paddingTop: 1 }}><OpBadge op={op.op} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: 'var(--color-text-primary)', lineHeight: 1.5 }}>
              {op.op === 'update' && op.previousText ? (
                <>
                  <span style={{ textDecoration: 'line-through', color: 'var(--color-text-tertiary)' }}>{op.previousText}</span>
                  <span style={{ margin: '0 6px', color: 'var(--color-text-tertiary)' }}>→</span>
                  <span>{op.text}</span>
                </>
              ) : op.op === 'delete' ? (
                <span style={{ textDecoration: 'line-through', color: 'var(--color-text-tertiary)' }}>{op.text}</span>
              ) : (
                <span>{op.text}</span>
              )}
            </div>
            {op.scope && (
              <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2 }}>{op.scope} memory</div>
            )}
          </div>
        </div>
      ))}
      {/* What saving means (DEV-185): exactly this text, used to personalize
          answers and search, and always yours to edit or delete. */}
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', lineHeight: 1.5 }}>
        Used to personalize answers and search. You can edit or delete it any time in Settings → Memory.
      </div>
    </div>
  )
}

function RenamePreview({ proposal }: { proposal: AIRenameBlockProposal }) {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', fontWeight: 600 }}>
        {proposal.timeRange} · block
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, textDecoration: 'line-through', color: 'var(--color-text-tertiary)' }}>{proposal.previousLabel}</span>
        <span style={{ color: 'var(--color-text-tertiary)' }}>→</span>
        <span style={{ fontSize: 13.5, fontWeight: 650, color: 'var(--color-text-primary)' }}>{proposal.nextLabel}</span>
      </div>
    </div>
  )
}

function MergePreview({ proposal }: { proposal: AIMergeBlocksProposal }) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'grid', gap: 4 }}>
        {[
          { range: proposal.firstRange, label: proposal.firstLabel },
          { range: proposal.secondRange, label: proposal.secondLabel },
        ].map((b, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontWeight: 600, minWidth: 96 }}>{b.range}</span>
            <span style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>{b.label}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4, borderTop: '1px solid var(--color-border-ghost)' }}>
        <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontWeight: 700, minWidth: 96 }}>{proposal.mergedRange}</span>
        <span style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>becomes one block</span>
      </div>
    </div>
  )
}

function headerLabel(widget: AIActionWidget): string {
  switch (widget.kind) {
    case 'memory_write': return memoryHeader(widget)
    case 'rename_block': return 'Rename block'
    case 'merge_blocks': return 'Merge blocks'
  }
}

export function ActionWidget({ widget, state, onConfirm, onUndo, onDismiss }: ActionWidgetProps) {
  const status = state?.status ?? 'idle'

  // Committed: collapse to a quiet confirmation strip with an undo when offered.
  if (status === 'committed') {
    const confirmation = widget.kind === 'memory_write'
      ? widget.ops.every((op) => op.op === 'delete')
        ? 'Removed from memory'
        : widget.ops.every((op) => op.op === 'update')
          ? 'Memory updated'
          : 'Saved to memory'
      : (state?.summary ?? 'Done.')
    return (
      <div
        role="status"
        aria-live="polite"
        style={{ display: 'inline-flex', width: 'fit-content', maxWidth: '100%', alignItems: 'center', gap: 8, border: '1px solid var(--color-border-ghost)', borderRadius: 999, background: 'var(--color-surface)', padding: state?.undo ? '5px 6px 5px 9px' : '6px 10px' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ color: 'var(--color-focus-green, #16a34a)', display: 'inline-flex' }}><IconCheck /></span>
          <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{confirmation}</span>
        </div>
        {state?.undo && (
          <button type="button" onClick={() => onUndo(widget.proposalId, state.undo!)} style={{ ...GHOST_BTN, display: 'inline-flex', alignItems: 'center', gap: 5, borderRadius: 999, padding: '5px 8px', fontSize: 11.5 }}>
            <IconUndo /> Undo
          </button>
        )}
      </div>
    )
  }

  // Cancelled preview: a quiet line, no longer actionable.
  if (state?.dismissed) {
    return (
      <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', padding: '4px 2px' }}>
        Cancelled — nothing changed.
      </div>
    )
  }

  const busy = status === 'committing' || status === 'undoing'

  return (
    <div style={CARD}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>
        {headerLabel(widget)}
      </div>

      {widget.kind === 'memory_write' && <MemoryPreview proposal={widget} />}
      {widget.kind === 'rename_block' && <RenamePreview proposal={widget} />}
      {widget.kind === 'merge_blocks' && <MergePreview proposal={widget} />}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => onConfirm(widget)}
          disabled={busy}
          style={{ ...(widget.destructive ? DANGER_BTN : PRIMARY_BTN), opacity: busy ? 0.7 : 1, cursor: busy ? 'default' : 'pointer' }}
        >
          {status === 'committing' ? 'Applying…' : widget.confirmLabel}
        </button>
        <button type="button" onClick={() => onDismiss(widget)} disabled={busy} style={{ ...GHOST_BTN, opacity: busy ? 0.7 : 1 }}>
          Cancel
        </button>
        {status === 'error' && (
          <span style={{ fontSize: 12, color: '#f87171' }}>{state?.error ?? 'Could not apply that.'}</span>
        )}
      </div>
    </div>
  )
}
