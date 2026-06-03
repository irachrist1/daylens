// FB11: pure mention-token parsing for the sent message. App/Client mentions
// serialize with a leading `@` (so the bubble can re-chip them); Day phrases
// serialize plain, so only `@Token` runs become chips. Kept React-free so it is
// unit-testable.

export type MentionSegment =
  | { type: 'text'; value: string }
  | { type: 'mention'; name: string }

const MENTION_TOKEN_RE = /(^|[\s(])@([A-Za-z0-9][\w.-]*)/g

export function splitMentionSegments(text: string): MentionSegment[] {
  const segments: MentionSegment[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  MENTION_TOKEN_RE.lastIndex = 0
  while ((match = MENTION_TOKEN_RE.exec(text)) !== null) {
    const lead = match[1]
    const name = match[2]
    const start = match.index + lead.length
    if (start > lastIndex) segments.push({ type: 'text', value: text.slice(lastIndex, start) })
    segments.push({ type: 'mention', name })
    lastIndex = start + name.length + 1
  }
  if (lastIndex < text.length) segments.push({ type: 'text', value: text.slice(lastIndex) })
  return segments
}
