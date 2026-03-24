import type { ReactNode } from 'react'

interface InsightCardProps {
  icon?: ReactNode
  tag?: string
  headline: string
  body?: ReactNode
  action?: ReactNode
  metric?: ReactNode
  accentColor?: string
}

export default function InsightCard({
  icon: _icon,
  tag,
  headline,
  body,
  action,
  metric,
  accentColor,
}: InsightCardProps) {
  const border = accentColor ? `1px solid ${accentColor}20` : 'none'

  return (
    <div
      className="card"
      style={{
        border,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {tag && (
            <span style={{
              display: 'inline-block',
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 999,
              background: accentColor ? `${accentColor}20` : 'rgba(194,198,214,0.10)',
              color: accentColor ?? 'var(--color-text-tertiary)',
              fontWeight: 500,
              marginBottom: 6,
            }}>
              {tag}
            </span>
          )}
          <p style={{
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            margin: 0,
            lineHeight: 1.35,
          }}>
            {headline}
          </p>
        </div>
        {metric && (
          <span style={{
            fontSize: 26,
            fontWeight: 700,
            color: 'var(--color-primary)',
            lineHeight: 1,
            flexShrink: 0,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {metric}
          </span>
        )}
      </div>

      {body && (
        <p style={{
          fontSize: 13,
          color: 'var(--color-text-secondary)',
          lineHeight: 1.6,
          margin: 0,
        }}>
          {body}
        </p>
      )}

      {action && (
        <div style={{ fontSize: 12, color: 'var(--color-primary)', textAlign: 'right' }}>
          {action}
        </div>
      )}
    </div>
  )
}
