import type { ReactNode } from 'react'

export interface ActivityListRow {
  id: string
  label: ReactNode
  detail: ReactNode
  onClick: () => void
}

export default function ActivityListCard({ title, rows }: { title: string; rows: ActivityListRow[] }) {
  if (rows.length === 0) return null
  return (
    <section style={{ borderRadius: 18, border: '1px solid var(--color-border-ghost)', background: 'var(--color-surface)', padding: '18px 20px' }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', marginBottom: 12 }}>
        {title}
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {rows.map((row) => (
          <button
            key={row.id}
            type="button"
            onClick={row.onClick}
            style={{
              width: '100%',
              border: '1px solid var(--color-border-ghost)',
              background: 'var(--color-surface-low)',
              borderRadius: 12,
              padding: '10px 14px',
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            <div style={{ fontSize: 13.5, fontWeight: 620, color: 'var(--color-text-primary)' }}>{row.label}</div>
            <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', marginTop: 3 }}>{row.detail}</div>
          </button>
        ))}
      </div>
    </section>
  )
}
