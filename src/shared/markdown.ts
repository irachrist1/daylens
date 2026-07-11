// The one markdown model for the whole app. The renderer's chat view and the
// main process's report exports (PDF / Word / HTML) both parse markdown through
// this module, so what reads as a heading, list, table, or bold span can never
// drift between the on-screen answer and the exported document. Rendering stays
// per-surface (React vs HTML strings); only the parse lives here.

export type MarkdownInlineToken =
  | { type: 'text'; text: string }
  | { type: 'strong'; text: string }
  | { type: 'em'; text: string }
  | { type: 'code'; text: string }

// **bold**, *em*, `code`. No `_em_`: underscores appear constantly in real
// evidence (focus_events, file_names) and must never italicize.
const INLINE_RE = /\*\*(.+?)\*\*|\*([^*\n]+?)\*|`([^`]+)`/g

export function parseInlineMarkdown(text: string): MarkdownInlineToken[] {
  const tokens: MarkdownInlineToken[] = []
  let last = 0
  let match: RegExpExecArray | null
  INLINE_RE.lastIndex = 0
  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > last) tokens.push({ type: 'text', text: text.slice(last, match.index) })
    if (match[1] !== undefined) tokens.push({ type: 'strong', text: match[1] })
    else if (match[2] !== undefined) tokens.push({ type: 'em', text: match[2] })
    else tokens.push({ type: 'code', text: match[3] })
    last = INLINE_RE.lastIndex
  }
  if (last < text.length) tokens.push({ type: 'text', text: text.slice(last) })
  return tokens
}

export type MarkdownBlockNode =
  | { type: 'heading'; level: number; text: string }
  | { type: 'bullet_list'; items: string[] }
  | { type: 'ordered_list'; items: Array<{ ordinal: string; text: string }> }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'paragraph'; lines: string[] }

function isTableSeparator(line: string): boolean {
  return /^\|?[\s|:]*-{2,}[\s|:-]*$/.test(line) && line.includes('|')
}

export function isMarkdownTable(text: string): boolean {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  return lines.length >= 2 && lines.findIndex(isTableSeparator) >= 1
}

function parseTableRow(row: string): string[] {
  return row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim())
}

function pushBlockNodes(nodes: MarkdownBlockNode[], lines: string[]): void {
  if (lines.length === 0) return

  const sepIdx = lines.findIndex(isTableSeparator)
  if (lines.length >= 2 && sepIdx >= 1) {
    nodes.push({
      type: 'table',
      headers: parseTableRow(lines[sepIdx - 1]),
      rows: lines.slice(sepIdx + 1).map(parseTableRow),
    })
    return
  }

  if (lines.every((line) => /^[-*]\s/.test(line))) {
    nodes.push({ type: 'bullet_list', items: lines.map((line) => line.replace(/^[-*]\s+/, '')) })
    return
  }

  if (lines.every((line) => /^\d+\.\s/.test(line))) {
    nodes.push({
      type: 'ordered_list',
      items: lines.map((line, index) => ({
        ordinal: line.match(/^(\d+)\./)?.[1] ?? String(index + 1),
        text: line.replace(/^\d+\.\s+/, ''),
      })),
    })
    return
  }

  const heading = lines[0].match(/^(#{1,4})\s+(.*)$/)
  if (heading) {
    nodes.push({ type: 'heading', level: heading[1].length, text: heading[2] })
    // A heading glued to its content without a blank line: parse the rest as
    // its own block instead of dropping it or leaving the raw '#' in a paragraph.
    pushBlockNodes(nodes, lines.slice(1))
    return
  }

  nodes.push({ type: 'paragraph', lines })
}

export function parseMarkdownBlocks(markdown: string): MarkdownBlockNode[] {
  const chunks = markdown.split(/\n{2,}/).map((chunk) => chunk.trim()).filter(Boolean)
  const nodes: MarkdownBlockNode[] = []
  for (const chunk of chunks) {
    pushBlockNodes(nodes, chunk.split('\n').map((line) => line.trim()).filter(Boolean))
  }
  return nodes
}
