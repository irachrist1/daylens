// Granola's local cache reader (DEV-193). Granola keeps meeting notes on the
// Mac itself — a JSON cache under ~/Library/Application Support/Granola — and
// exposes no public per-account API, so this connector reads that file and
// nothing else: no network, no account, no credential anywhere in the flow.
//
// The parser is deliberately TOLERANT (the cache is another app's private
// format and may shift) and deliberately NARROW: it touches meeting identity,
// times, participants, and the person's own note lines — minimized at parse
// time. Transcript stores, audio references, and unknown fields are never
// read (connectors.md §Granola: "Daylens stores references and minimized
// permitted content; it does not record meeting audio").

const MAX_NOTE_LINES = 12
const MAX_NOTE_LINE_CHARS = 200
const MAX_PARTICIPANTS = 12

export interface GranolaParticipant {
  /** Source-native identity when the cache carries one (lowercased email). */
  email: string | null
  name: string
}

export interface GranolaNoteDoc {
  id: string
  title: string
  createdAtMs: number | null
  updatedAtMs: number
  /** Scheduled meeting range from the attached calendar event, when present. */
  startMs: number | null
  endMs: number | null
  /** The linked calendar event's source-native id, when the cache carries
   *  one — the strongest cross-source corroboration a note can offer. */
  calendarEventId: string | null
  participants: GranolaParticipant[]
  /** The person's own note lines, minimized: trimmed, capped in count and length. */
  noteLines: string[]
}

export interface GranolaCacheContent {
  docs: GranolaNoteDoc[]
  /** Human label for the connected source (the account email when the cache
   *  names one) — never a path. */
  accountLabel: string | null
}

function parseTime(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

function clipLine(line: string): string {
  return line.length > MAX_NOTE_LINE_CHARS ? `${line.slice(0, MAX_NOTE_LINE_CHARS - 1)}…` : line
}

/** Plain note lines from whichever representation the cache carries: a plain
 *  or markdown string, Granola's ProseMirror document (text leaves only —
 *  attachments, marks, and unknown nodes contribute nothing), or the note's
 *  summary string when the person typed nothing themselves. */
export function extractNoteLines(doc: Record<string, unknown>): string[] {
  const plain = typeof doc.notes_plain === 'string' && doc.notes_plain.trim()
    ? doc.notes_plain
    : typeof doc.notes_markdown === 'string' && doc.notes_markdown.trim()
      ? doc.notes_markdown
      : null
  const text = plain
    ?? proseMirrorText(doc.notes)
    ?? (typeof doc.summary === 'string' && doc.summary.trim() ? doc.summary : null)
  if (!text) return []
  const lines: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^[-*••]\s*/, '').replace(/^#+\s*/, '').trim()
    if (!line) continue
    lines.push(clipLine(line))
    if (lines.length >= MAX_NOTE_LINES) break
  }
  return lines
}

function proseMirrorText(node: unknown, depth = 0): string | null {
  if (depth > 12 || node == null || typeof node !== 'object') return null
  const record = node as Record<string, unknown>
  if (record.type === 'text' && typeof record.text === 'string') return record.text
  const content = record.content
  if (!Array.isArray(content)) return null
  const parts: string[] = []
  for (const child of content) {
    const text = proseMirrorText(child, depth + 1)
    if (text) parts.push(text)
  }
  if (parts.length === 0) return null
  // Block containers separate their children as lines; inline containers
  // (paragraphs, headings) join their text runs back together.
  const type = String(record.type ?? 'doc')
  const isBlockContainer = ['doc', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'taskList', 'taskItem'].includes(type)
  return parts.join(isBlockContainer ? '\n' : '')
}

function participantsOf(doc: Record<string, unknown>, selfEmails: Set<string>): GranolaParticipant[] {
  const out: GranolaParticipant[] = []
  const seen = new Set<string>()
  const push = (nameValue: unknown, emailValue: unknown, self: boolean): void => {
    if (out.length >= MAX_PARTICIPANTS) return
    const email = typeof emailValue === 'string' && emailValue.includes('@')
      ? emailValue.trim().toLowerCase()
      : null
    if (self || (email && selfEmails.has(email))) return
    const name = typeof nameValue === 'string' && nameValue.trim() ? nameValue.trim() : email
    if (!name) return
    const key = email ?? `name:${name.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ email, name })
  }

  const people = doc.people
  if (Array.isArray(people)) {
    for (const person of people) {
      if (person && typeof person === 'object') {
        const record = person as Record<string, unknown>
        push(record.name, record.email, record.self === true || record.creator === true)
      }
    }
  } else if (people && typeof people === 'object') {
    const record = people as Record<string, unknown>
    const creator = record.creator
    if (creator && typeof creator === 'object') {
      const creatorRecord = creator as Record<string, unknown>
      if (typeof creatorRecord.email === 'string') selfEmails.add(creatorRecord.email.trim().toLowerCase())
    }
    const attendees = record.attendees
    if (Array.isArray(attendees)) {
      for (const attendee of attendees) {
        if (attendee && typeof attendee === 'object') {
          const attendeeRecord = attendee as Record<string, unknown>
          push(attendeeRecord.name, attendeeRecord.email, attendeeRecord.self === true)
        }
      }
    }
  }

  const calendarEvent = doc.google_calendar_event
  if (calendarEvent && typeof calendarEvent === 'object') {
    const attendees = (calendarEvent as Record<string, unknown>).attendees
    if (Array.isArray(attendees)) {
      for (const attendee of attendees) {
        if (attendee && typeof attendee === 'object') {
          const attendeeRecord = attendee as Record<string, unknown>
          push(attendeeRecord.displayName ?? attendeeRecord.name, attendeeRecord.email, attendeeRecord.self === true)
        }
      }
    }
  }
  return out
}

function calendarRange(doc: Record<string, unknown>): {
  startMs: number | null
  endMs: number | null
  calendarEventId: string | null
} {
  const event = doc.google_calendar_event
  if (!event || typeof event !== 'object') return { startMs: null, endMs: null, calendarEventId: null }
  const record = event as Record<string, unknown>
  const timeOf = (value: unknown): number | null => {
    if (!value || typeof value !== 'object') return null
    return parseTime((value as Record<string, unknown>).dateTime)
  }
  return {
    startMs: timeOf(record.start),
    endMs: timeOf(record.end),
    calendarEventId: typeof record.id === 'string' && record.id.trim() ? record.id.trim() : null,
  }
}

function documentsOf(state: Record<string, unknown>): Array<Record<string, unknown>> {
  const documents = state.documents
  if (Array.isArray(documents)) {
    return documents.filter((doc): doc is Record<string, unknown> => doc != null && typeof doc === 'object')
  }
  if (documents && typeof documents === 'object') {
    return Object.values(documents as Record<string, unknown>)
      .filter((doc): doc is Record<string, unknown> => doc != null && typeof doc === 'object')
  }
  return []
}

/**
 * Parse the raw cache file text. Granola wraps its state as
 * `{"cache": "<stringified json>"}`; a direct object is accepted too.
 * Throws a plain-language error when the file cannot be read as a Granola
 * cache — the caller turns that into connect/sync failure copy.
 */
export function parseGranolaCache(raw: string): GranolaCacheContent {
  let outer: unknown
  try {
    outer = JSON.parse(raw)
  } catch {
    throw new Error('The Granola cache file is not readable JSON.')
  }
  if (outer == null || typeof outer !== 'object') {
    throw new Error('The Granola cache file has an unexpected shape.')
  }
  let stateHost = outer as Record<string, unknown>
  if (typeof stateHost.cache === 'string') {
    try {
      const inner = JSON.parse(stateHost.cache)
      if (inner && typeof inner === 'object') stateHost = inner as Record<string, unknown>
    } catch {
      throw new Error('The Granola cache file is not readable JSON.')
    }
  }
  const state = (stateHost.state && typeof stateHost.state === 'object'
    ? stateHost.state
    : stateHost) as Record<string, unknown>

  const selfEmails = new Set<string>()
  const user = state.user
  if (user && typeof user === 'object') {
    const email = (user as Record<string, unknown>).email
    if (typeof email === 'string' && email.includes('@')) selfEmails.add(email.trim().toLowerCase())
  }

  const docs: GranolaNoteDoc[] = []
  for (const doc of documentsOf(state)) {
    const id = typeof doc.id === 'string' && doc.id.trim() ? doc.id.trim() : null
    if (!id) continue
    if (doc.deleted_at != null) continue
    const updatedAtMs = parseTime(doc.updated_at) ?? parseTime(doc.created_at)
    if (updatedAtMs == null) continue
    const { startMs, endMs, calendarEventId } = calendarRange(doc)
    docs.push({
      id,
      title: typeof doc.title === 'string' && doc.title.trim() ? doc.title.trim() : 'Untitled meeting',
      createdAtMs: parseTime(doc.created_at),
      updatedAtMs,
      startMs,
      endMs,
      calendarEventId,
      participants: participantsOf(doc, selfEmails),
      noteLines: extractNoteLines(doc),
    })
  }
  return {
    docs,
    accountLabel: selfEmails.size > 0 ? [...selfEmails][0] : null,
  }
}

// ─── Transcript retrieval (never ingestion) ──────────────────────────────────
// Transcripts are HIGH-sensitivity content (privacy-retention-and-sync.md):
// they never enter the ledger, the day layer, memory records, or any index.
// This reader exists for exactly one path — an explicit question that needs a
// transcript excerpt, disclosed and recorded through the context packet — and
// is called from nowhere else.

/** Stitch the transcript text for one document from whichever shape the cache
 *  carries: a top-level `state.transcripts` map (docId → segments or string)
 *  or a `transcribe`/`transcript` field on the document itself. Returns the
 *  joined text, or null when the meeting has no transcript. */
export function extractTranscriptText(raw: string, docId: string): string | null {
  let outer: unknown
  try {
    outer = JSON.parse(raw)
  } catch {
    return null
  }
  if (outer == null || typeof outer !== 'object') return null
  let stateHost = outer as Record<string, unknown>
  if (typeof stateHost.cache === 'string') {
    try {
      const inner = JSON.parse(stateHost.cache)
      if (inner && typeof inner === 'object') stateHost = inner as Record<string, unknown>
    } catch {
      return null
    }
  }
  const state = (stateHost.state && typeof stateHost.state === 'object'
    ? stateHost.state
    : stateHost) as Record<string, unknown>

  const transcripts = state.transcripts
  if (transcripts && typeof transcripts === 'object' && !Array.isArray(transcripts)) {
    const entry = (transcripts as Record<string, unknown>)[docId]
    const text = transcriptEntryText(entry)
    if (text) return text
  }
  for (const doc of documentsOf(state)) {
    if (doc.id !== docId) continue
    return transcriptEntryText(doc.transcribe) ?? transcriptEntryText(doc.transcript)
  }
  return null
}

function transcriptEntryText(entry: unknown): string | null {
  if (typeof entry === 'string') return entry.trim() || null
  if (!Array.isArray(entry)) return null
  const parts: string[] = []
  for (const segment of entry) {
    if (typeof segment === 'string') {
      if (segment.trim()) parts.push(segment.trim())
      continue
    }
    if (segment && typeof segment === 'object') {
      const record = segment as Record<string, unknown>
      const text = typeof record.text === 'string' ? record.text : typeof record.content === 'string' ? record.content : null
      if (text?.trim()) parts.push(text.trim())
    }
  }
  return parts.length > 0 ? parts.join(' ') : null
}
