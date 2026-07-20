// Packet citations (DEV-182). The agent's answer may tag claims with [Cn]
// markers pointing at the context-packet items rendered into its prompt
// (renderContextPacketForAgent). This module resolves those markers into a
// verified citation list bound to THIS exchange's packet:
//   - a marker survives only when Cn names a real item in the packet — a
//     marker the packet cannot back is dropped and logged, so every persisted
//     citation resolves to a recorded, disclosed item (citation integrity);
//   - surviving markers are renumbered by first appearance and rendered as
//     unicode superscripts (¹ ²…) so the visible answer stays readable and
//     the numbered source chips under the answer line up with the text.
import type { ContextItemKind, ContextPacket } from '../services/contextPacket'

export interface PacketCitation {
  /** Display number: 1-based, in order of first appearance in the answer. */
  marker: number
  /** Stable identity of the cited packet item (block:<id>, file:<path>, …). */
  identity: string
  kind: ContextItemKind
  /** The disclosed statement the claim traces to. */
  statement: string
}

const SUPERSCRIPT_DIGITS = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹']

function superscript(value: number): string {
  return String(value)
    .split('')
    .map((digit) => SUPERSCRIPT_DIGITS[Number(digit)] ?? '')
    .join('')
}

// One bracket group: [C3] or a tolerated list form like [C1, C2] / [C1,2].
// Leading whitespace is folded into the match so a valid citation renders as
// "claim¹" and a dropped one leaves "claim." with no stray gap.
const MARKER_RE = /\s*\[C\d+(?:\s*,\s*C?\d+)*\]/g

/**
 * Resolve the answer's [Cn] markers against the exchange's packet. Returns the
 * display text (markers replaced by superscripts, unverifiable markers
 * removed) and the ordered citation list for persistence and the chat UI.
 */
export function resolvePacketCitations(
  text: string,
  packet: ContextPacket | null,
): { text: string; citations: PacketCitation[] } {
  if (!text || !text.includes('[C')) return { text, citations: [] }
  const citations: PacketCitation[] = []
  const displayByIdentity = new Map<string, number>()
  let dropped = 0
  const resolved = text.replace(MARKER_RE, (marker) => {
    const rendered: string[] = []
    for (const digits of marker.match(/\d+/g) ?? []) {
      const item = packet?.items[Number(digits) - 1]
      if (!item) {
        dropped += 1
        continue
      }
      let display = displayByIdentity.get(item.identity)
      if (display == null) {
        display = citations.length + 1
        displayByIdentity.set(item.identity, display)
        citations.push({
          marker: display,
          identity: item.identity,
          kind: item.kind,
          statement: item.statement,
        })
      }
      rendered.push(superscript(display))
    }
    return rendered.join(' ')
  })
  if (dropped > 0) {
    console.warn(`[agent:citations] dropped ${dropped} marker(s) the context packet cannot back`)
  }
  return { text: resolved, citations }
}
