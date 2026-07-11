import type { ReactNode } from 'react'
import { parseInlineMarkdown, parseMarkdownBlocks, type MarkdownBlockNode } from '@shared/markdown'

// Chat-side markdown rendering. Parsing lives in @shared/markdown (shared with
// the report exporter in main); this file only maps the parsed nodes to JSX.

function inlineNodes(text: string): ReactNode[] {
  return parseInlineMarkdown(text).map((token, index) => {
    switch (token.type) {
      case 'strong': return <strong key={index}>{token.text}</strong>
      case 'em': return <em key={index}>{token.text}</em>
      case 'code': return <code key={index} className="bg-[var(--color-surface-high)] px-1 py-px rounded text-[12px]">{token.text}</code>
      default: return token.text
    }
  })
}

function MarkdownTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
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
          {rows.map((row, ri) => (
            <tr key={ri} style={{ borderBottom: ri < rows.length - 1 ? '1px solid var(--color-border-ghost)' : 'none' }}>
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

function renderBlockNode(node: MarkdownBlockNode, key: number): ReactNode {
  switch (node.type) {
    case 'heading': {
      const sizeClass = node.level === 1 ? 'text-[16px]' : node.level === 2 ? 'text-[14px]' : 'text-[13px]'
      return <p key={key} className={`${sizeClass} font-semibold text-[var(--color-text-primary)] leading-snug`}>{inlineNodes(node.text)}</p>
    }
    case 'bullet_list':
      return (
        <ul key={key} className="flex flex-col gap-1 pl-1">
          {node.items.map((item, index) => (
            <li key={index} className="flex gap-2 text-[13px] leading-relaxed">
              <span className="shrink-0 opacity-40 mt-0.5">-</span>
              <span>{inlineNodes(item)}</span>
            </li>
          ))}
        </ul>
      )
    case 'ordered_list':
      return (
        <ol key={key} className="flex flex-col gap-1 pl-1">
          {node.items.map((item, index) => (
            <li key={index} className="flex gap-2 text-[13px] leading-relaxed">
              <span className="shrink-0 text-[var(--color-text-tertiary)] tabular-nums min-w-[1.2em] text-right">
                {item.ordinal}.
              </span>
              <span>{inlineNodes(item.text)}</span>
            </li>
          ))}
        </ol>
      )
    case 'table':
      return <MarkdownTable key={key} headers={node.headers} rows={node.rows} />
    case 'paragraph':
      return (
        <p key={key} className="text-[13px] leading-relaxed">
          {node.lines.flatMap((line, index) => {
            const nodes = inlineNodes(line)
            return index < node.lines.length - 1 ? [...nodes, <br key={`br-${index}`} />] : nodes
          })}
        </p>
      )
  }
}

export function MarkdownMessage({ content }: { content: string }) {
  const blocks = parseMarkdownBlocks(content)
  if (blocks.length === 0) {
    return <p className="text-[13px] leading-relaxed">{content}</p>
  }
  return (
    <div className="flex flex-col gap-2.5">
      {blocks.map((node, index) => renderBlockNode(node, index))}
    </div>
  )
}
