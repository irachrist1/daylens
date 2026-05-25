// Extracts filename-looking tokens from window_title strings already stored in
// app_sessions. No new capture — this is extraction from existing data.
// Results are marked as inferred (title-string evidence), not definitive.
import type Database from 'better-sqlite3'

export interface FileMention {
  filename: string
  extension: string
  appName: string
  windowTitle: string
  firstSeenAt: number  // epoch ms — earliest session that shows this filename
  totalSessions: number
  inferred: true        // always true — these come from title strings, not file events
}

export interface SearchFileMentionsResult {
  mentions: FileMention[]
  dateRange: { startDate: string; endDate: string }
  note: string
}

// Common code/doc extensions to match
const FILE_EXTENSIONS =
  'ts|tsx|js|jsx|mjs|mts|py|go|rs|java|kt|swift|rb|cs|cpp|c|h|vue|svelte|' +
  'md|mdx|txt|pdf|docx|doc|xlsx|xls|pptx|ppt|pages|numbers|keynote|' +
  'sketch|fig|figma|png|jpg|jpeg|svg|webp|gif|' +
  'sql|json|yaml|yml|toml|env|csv|sh|bash|zsh'

// Patterns that extract a filename from a window title:
//   "filename.ext — App"  (em-dash separator — Cursor, VS Code, Preview, Pages)
//   "filename.ext - App"  (hyphen separator — Word, Excel, Sublime, etc.)
//   "filename.ext"        (standalone — PDF viewer, Preview standalone)
//   "/path/to/filename.ext" (full path in title)
const PATTERNS: RegExp[] = [
  // "name.ext — App" or "name.ext - App"
  new RegExp(`([\\w\\-. ()]+\\.(${FILE_EXTENSIONS}))\\s*[—–-]`, 'gi'),
  // standalone with extension at end of string or before punctuation
  new RegExp(`([\\w\\-. ()]+\\.(${FILE_EXTENSIONS}))(?:\\s|$|[,;?!])`, 'gi'),
  // full path like /Users/... or ~/... or relative ./path/
  new RegExp(`(?:^|\\s)([~/.]?(?:[\\w./\\-]+/)+[\\w\\-.]+\\.(${FILE_EXTENSIONS}))`, 'gi'),
]

function extractFilenames(title: string): string[] {
  const found = new Set<string>()
  for (const pattern of PATTERNS) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(title)) !== null) {
      const raw = match[1]?.trim()
      if (!raw || raw.length < 3 || raw.length > 200) continue
      // Skip pure numeric or single-char filenames
      if (/^\d+\.\w+$/.test(raw)) continue
      found.add(raw)
    }
  }
  return [...found]
}

function localDayBounds(dateStr: string): [number, number] {
  const [y, m, d] = dateStr.split('-').map(Number)
  const from = new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
  return [from, from + 86_400_000]
}

function toDateStr(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Scans window_title strings for filename-like tokens and returns
 * deduplicated mentions grouped by filename.
 *
 * Exposed as an AI tool so the model can answer "which files did I touch?"
 * type questions with honest source attribution.
 */
export function searchFileMentions(
  db: Database.Database,
  params: { startDate?: string; endDate?: string },
): SearchFileMentionsResult {
  const now = Date.now()
  const fromMs = params.startDate ? localDayBounds(params.startDate)[0] : now - 7 * 86_400_000
  const toMs = params.endDate ? localDayBounds(params.endDate)[1] : now
  const startDate = toDateStr(fromMs)
  const endDate = toDateStr(toMs - 1)

  const rows = (db.prepare(`
    SELECT app_name, window_title, start_time
    FROM app_sessions
    WHERE window_title IS NOT NULL
      AND start_time >= ? AND start_time < ?
    ORDER BY start_time ASC
  `).all(fromMs, toMs) as { app_name: string; window_title: string; start_time: number }[])

  const byFilename = new Map<string, FileMention>()

  for (const row of rows) {
    const filenames = extractFilenames(row.window_title)
    for (const filename of filenames) {
      const ext = filename.split('.').pop()?.toLowerCase() ?? ''
      const existing = byFilename.get(filename.toLowerCase())
      if (existing) {
        existing.totalSessions++
        if (row.start_time < existing.firstSeenAt) existing.firstSeenAt = row.start_time
      } else {
        byFilename.set(filename.toLowerCase(), {
          filename,
          extension: ext,
          appName: row.app_name,
          windowTitle: row.window_title,
          firstSeenAt: row.start_time,
          totalSessions: 1,
          inferred: true,
        })
      }
    }
  }

  const mentions = [...byFilename.values()].sort((a, b) => b.totalSessions - a.totalSessions)

  return {
    mentions,
    dateRange: { startDate, endDate },
    note: 'These filenames are inferred from window title strings, not from file-system events. They indicate the window title contained a filename-like token — not that the file was definitely open or edited.',
  }
}
