// Fixture builder for the DEV-193 Granola adapter tests: an in-memory
// filesystem the adapter's injected `readFileImpl` serves, plus a builder for
// Granola's cache shape — the double-encoded `{"cache": "<json>"}` wrapper by
// default, the direct object variant on request. No real Granola install is
// touched; the owner checklist covers the real-account leg.

export const FAKE_GRANOLA_CACHE_PATH = '/granola-home/Library/Application Support/Granola/cache-v3.json'

export interface FakeGranolaDoc {
  id: string
  title?: string
  created_at?: string
  updated_at?: string
  deleted_at?: string | null
  notes_plain?: string
  notes_markdown?: string
  notes?: unknown
  summary?: string
  transcript?: unknown
  transcribe?: unknown
  people?: unknown
  google_calendar_event?: unknown
}

export interface FakeGranolaState {
  user?: { email?: string }
  documents: FakeGranolaDoc[]
  transcripts?: Record<string, unknown>
}

export function buildGranolaCacheRaw(
  state: FakeGranolaState,
  options: { wrapped?: boolean } = {},
): string {
  const documents: Record<string, FakeGranolaDoc> = {}
  for (const doc of state.documents) documents[doc.id] = doc
  const inner = {
    state: {
      user: state.user,
      documents,
      transcripts: state.transcripts,
    },
  }
  if (options.wrapped === false) return JSON.stringify(inner)
  return JSON.stringify({ cache: JSON.stringify(inner) })
}

export interface FakeGranolaFilesystem {
  readFileImpl: (filePath: string) => Promise<string>
  write(filePath: string, content: string): void
  writeCache(state: FakeGranolaState, options?: { wrapped?: boolean }): void
  remove(filePath: string): void
}

export function createFakeGranolaFilesystem(): FakeGranolaFilesystem {
  const files = new Map<string, string>()
  return {
    async readFileImpl(filePath: string): Promise<string> {
      const content = files.get(filePath)
      if (content == null) throw new Error(`ENOENT: ${filePath}`)
      return content
    },
    write(filePath, content) { files.set(filePath, content) },
    writeCache(state, options) { files.set(FAKE_GRANOLA_CACHE_PATH, buildGranolaCacheRaw(state, options)) },
    remove(filePath) { files.delete(filePath) },
  }
}
