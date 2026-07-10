import SegmentedControl from './SegmentedControl'

function Chevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={direction === 'left' ? 'm10 3.5-4.5 4.5 4.5 4.5' : 'M6 3.5 10.5 8 6 12.5'} />
    </svg>
  )
}

export default function PeriodNavigator<T extends string>({
  label,
  value,
  options,
  onChange,
  onPrevious,
  onNext,
  nextDisabled,
  onToday,
}: {
  label: string
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (value: T) => void
  onPrevious: () => void
  onNext: () => void
  nextDisabled: boolean
  onToday?: () => void
}) {
  const arrowStyle = (disabled = false) => ({
    width: 32,
    height: 32,
    borderRadius: 999,
    border: 'none',
    background: 'transparent',
    cursor: disabled ? 'default' : 'pointer',
    color: 'var(--color-text-secondary)',
    opacity: disabled ? 0.3 : 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  } as const)

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button type="button" onClick={onPrevious} style={arrowStyle()} aria-label="Previous period">
          <Chevron direction="left" />
        </button>
        <div style={{
          minWidth: 156,
          textAlign: 'center',
          padding: '8px 16px',
          borderRadius: 999,
          border: '1px solid var(--color-border-ghost)',
          background: 'var(--color-surface)',
          fontSize: 13,
          fontWeight: 700,
          color: 'var(--color-text-primary)',
        }}>
          {label}
        </div>
        <button type="button" onClick={onNext} disabled={nextDisabled} style={arrowStyle(nextDisabled)} aria-label="Next period">
          <Chevron direction="right" />
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {onToday && (
          <button
            type="button"
            onClick={onToday}
            style={{
              padding: '7px 12px',
              borderRadius: 8,
              border: '1px solid var(--color-border-ghost)',
              background: 'var(--color-surface)',
              color: 'var(--color-text-secondary)',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Today
          </button>
        )}
        <SegmentedControl value={value} options={options} onChange={onChange} />
      </div>
    </div>
  )
}
