import type { CSSProperties, ReactNode } from 'react'
import InlineRevealText from './InlineRevealText'

export default function EvidenceIdentity({
  icon,
  title,
  detail,
  titleStyle,
}: {
  icon: ReactNode
  title: string
  detail?: ReactNode
  titleStyle?: CSSProperties
}) {
  return (
    <>
      {icon}
      <div style={{ flex: 1, minWidth: 0 }}>
        <InlineRevealText
          text={title}
          style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', ...titleStyle }}
        />
        {detail}
      </div>
    </>
  )
}
