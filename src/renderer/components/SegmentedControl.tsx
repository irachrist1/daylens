export default function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <div style={{
      display: 'inline-flex',
      gap: 3,
      padding: 3,
      borderRadius: 9,
      border: '1px solid var(--color-border-ghost)',
      background: 'var(--color-surface-high)',
      flexShrink: 0,
    }}>
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            type="button"
            key={option.value}
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            style={{
              padding: '4px 12px',
              borderRadius: 7,
              border: 'none',
              cursor: 'pointer',
              background: selected ? 'var(--gradient-primary)' : 'transparent',
              color: selected ? 'var(--color-primary-contrast)' : 'var(--color-text-secondary)',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
