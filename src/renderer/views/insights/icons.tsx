import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

export const actionButtonStyle: CSSProperties = {
  width: 30,
  height: 30,
  padding: 0,
  borderRadius: 999,
  border: '1px solid var(--color-border-ghost)',
  background: 'transparent',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'transform 140ms ease, background 180ms ease, border-color 180ms ease, color 180ms ease',
  transformOrigin: 'center',
}

export function IconCopy() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="3" width="8" height="10" rx="2" />
      <path d="M3.5 11.5h-1A1.5 1.5 0 0 1 1 10V3.5A1.5 1.5 0 0 1 2.5 2H8" />
    </svg>
  )
}

export function IconThumbsUp() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6.5 7 8.8 2.8A1.3 1.3 0 0 1 11.2 4v2h1.4A1.4 1.4 0 0 1 14 7.7l-.8 4A1.8 1.8 0 0 1 11.4 13H6.5" />
      <path d="M2 7h4.5v6H2z" />
    </svg>
  )
}

export function IconThumbsDown() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.5 9 7.2 13.2A1.3 1.3 0 0 1 4.8 12v-2H3.4A1.4 1.4 0 0 1 2 8.3l.8-4A1.8 1.8 0 0 1 4.6 3h4.9" />
      <path d="M9.5 3H14v6H9.5z" />
    </svg>
  )
}

export function IconRetry() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 5V1.8h-3.2" />
      <path d="M13 2.2A6 6 0 1 0 14 8" />
    </svg>
  )
}

export function IconCompose() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 2.5L13.5 5L5.5 13H3v-2.5L11 2.5Z" />
      <path d="M9.5 4l2.5 2.5" />
    </svg>
  )
}

export function IconChevronDown() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 4l4 4 4-4" />
    </svg>
  )
}

export function IconArtifactFile({ kind }: { kind: 'csv' | 'html_chart' | 'markdown' | string }) {
  if (kind === 'csv' || kind === 'json_table') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="1" width="12" height="14" rx="2" />
        <path d="M5 6h6M5 9h6M5 12h4" />
      </svg>
    )
  }
  if (kind === 'html_chart' || kind === 'html') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12 L5 8 L8 10 L11 5 L14 7" />
        <rect x="1" y="1" width="14" height="14" rx="2" />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="1" width="12" height="14" rx="2" />
      <path d="M5 5h6M5 8h6M5 11h4" />
    </svg>
  )
}

export function IconActionButton({
  label,
  feedbackLabel,
  selected = false,
  success = false,
  tone = 'neutral',
  pulseNonce = 0,
  reducedMotion = false,
  onClick,
  children,
}: {
  label: string
  feedbackLabel?: string
  selected?: boolean
  success?: boolean
  tone?: 'neutral' | 'positive' | 'negative'
  pulseNonce?: number
  reducedMotion?: boolean
  onClick: () => void
  children: ReactNode
}) {
  const [pressed, setPressed] = useState(false)
  const pulseName = pulseNonce > 0
    ? (pulseNonce % 2 === 0 ? 'insightsActionBounceA' : 'insightsActionBounceB')
    : null

  const selectedBackground = tone === 'negative'
    ? 'rgba(248, 113, 113, 0.10)'
    : 'var(--color-accent-dim)'
  const selectedBorder = tone === 'negative'
    ? 'rgba(248, 113, 113, 0.30)'
    : 'rgba(173, 198, 255, 0.28)'
  const selectedText = tone === 'negative'
    ? '#f87171'
    : 'var(--color-text-primary)'
  const background = success ? 'rgba(79, 219, 200, 0.12)' : selected ? selectedBackground : 'transparent'
  const borderColor = success ? 'rgba(79, 219, 200, 0.30)' : selected ? selectedBorder : 'var(--color-border-ghost)'
  const textColor = success ? 'var(--color-focus-green)' : selected ? selectedText : 'var(--color-text-secondary)'

  return (
    <button
      onClick={onClick}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') setPressed(true)
      }}
      onKeyUp={(event) => {
        if (event.key === 'Enter' || event.key === ' ') setPressed(false)
      }}
      onBlur={() => setPressed(false)}
      title={feedbackLabel ?? label}
      aria-label={feedbackLabel ?? label}
      style={{
        ...actionButtonStyle,
        color: textColor,
        background,
        borderColor,
        transform: reducedMotion ? undefined : pressed ? 'scale(0.92)' : undefined,
        animation: !reducedMotion && pulseName
          ? `${pulseName} 200ms cubic-bezier(0.2, 0.9, 0.2, 1.15)`
          : undefined,
      }}
    >
      {children}
    </button>
  )
}
