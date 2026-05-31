import type { ReactNode } from 'react'

function inlineNodes(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_|`([^`]+)`/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    const full = match[0]
    if (full.startsWith('**')) {
      parts.push(<strong key={match.index}>{match[1]}</strong>)
    } else if (full.startsWith('*') || full.startsWith('_')) {
      parts.push(<em key={match.index}>{match[2] ?? match[3]}</em>)
    } else {
      parts.push(<code key={match.index} className="bg-[var(--color-surface-high)] px-1 py-px rounded text-[12px]">{match[4]}</code>)
    }
    last = re.lastIndex
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function MarkdownBlock({ text, blockKey }: { text: string; blockKey: number }): ReactNode {
  const lines = text.split('\n').map((line) => line.trimEnd())
  const nonEmpty = lines.filter((line) => line.trim())
  if (nonEmpty.length === 0) return null

  if (/^#{1,4}\s/.test(nonEmpty[0])) {
    const level = nonEmpty[0].match(/^(#{1,4})/)?.[1].length ?? 2
    const content = nonEmpty[0].replace(/^#{1,4}\s+/, '')
    const sizeClass = level === 1 ? 'text-[16px]' : level === 2 ? 'text-[14px]' : 'text-[13px]'
    return <p key={blockKey} className={`${sizeClass} font-semibold text-[var(--color-text-primary)] leading-snug`}>{inlineNodes(content)}</p>
  }

  if (nonEmpty.every((line) => /^[-*]\s/.test(line))) {
    return (
      <ul key={blockKey} className="flex flex-col gap-1 pl-1">
        {nonEmpty.map((line, index) => (
          <li key={index} className="flex gap-2 text-[13px] leading-relaxed">
            <span className="shrink-0 opacity-40 mt-0.5">-</span>
            <span>{inlineNodes(line.replace(/^[-*]\s+/, ''))}</span>
          </li>
        ))}
      </ul>
    )
  }

  if (nonEmpty.every((line) => /^\d+\.\s/.test(line))) {
    return (
      <ol key={blockKey} className="flex flex-col gap-1 pl-1">
        {nonEmpty.map((line, index) => (
          <li key={index} className="flex gap-2 text-[13px] leading-relaxed">
            <span className="shrink-0 text-[var(--color-text-tertiary)] tabular-nums min-w-[1.2em] text-right">
              {line.match(/^(\d+)\./)?.[1] ?? index + 1}.
            </span>
            <span>{inlineNodes(line.replace(/^\d+\.\s+/, ''))}</span>
          </li>
        ))}
      </ol>
    )
  }

  return (
    <p key={blockKey} className="text-[13px] leading-relaxed">
      {lines.flatMap((line, index) => {
        const nodes = inlineNodes(line)
        return index < lines.length - 1 ? [...nodes, <br key={`br-${index}`} />] : nodes
      })}
    </p>
  )
}

function isMarkdownTable(text: string): boolean {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  return lines.length >= 2 && lines.some((l) => /^\|?[\s|:]*-{2,}[\s|:-]*$/.test(l) && l.includes('|'))
}

function MarkdownTable({ text }: { text: string }) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const sepIdx = lines.findIndex((l) => /^\|?[\s|:]*-{2,}[\s|:-]*$/.test(l) && l.includes('|'))
  if (sepIdx < 1) return <p style={{ fontSize: 13, lineHeight: 1.6 }}>{text}</p>

  const parseRow = (row: string): string[] =>
    row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim())

  const headers = parseRow(lines[sepIdx - 1])
  const dataRows = lines.slice(sepIdx + 1).map(parseRow)

  return (
    <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid var(--color-border-ghost)' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} style={{
                padding: '8px 12px',
                textAlign: 'left',
                fontWeight: 700,
                fontSize: 11,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                color: 'var(--color-text-tertiary)',
                borderBottom: '1px solid var(--color-border-ghost)',
                whiteSpace: 'nowrap',
                background: 'var(--color-surface-low)',
              }}>
                {inlineNodes(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dataRows.map((row, ri) => (
            <tr key={ri} style={{ borderBottom: ri < dataRows.length - 1 ? '1px solid var(--color-border-ghost)' : 'none' }}>
              {row.map((cell, ci) => (
                <td key={ci} style={{
                  padding: '8px 12px',
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  color: ci === 0 ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                  fontWeight: ci === 0 ? 580 : 400,
                  verticalAlign: 'top',
                }}>
                  {inlineNodes(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function MarkdownMessage({ content }: { content: string }) {
  const blocks = content.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean)
  if (blocks.length === 0) {
    return <p className="text-[13px] leading-relaxed">{content}</p>
  }
  return (
    <div className="flex flex-col gap-2.5">
      {blocks.map((block, index) =>
        isMarkdownTable(block)
          ? <MarkdownTable key={index} text={block} />
          : <MarkdownBlock key={index} text={block} blockKey={index} />
      )}
    </div>
  )
}
