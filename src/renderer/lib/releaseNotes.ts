function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
}

// electron-updater surfaces release notes as HTML for GitHub-published releases
// (the release body is rendered through GitHub's markdown pipeline). Convert
// the structural tags into the markdown-ish form the line splitter already
// understands, drop any remaining tags, then decode entities.
function normalizeHtmlReleaseNotes(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(/<h([1-6])[^>]*>/gi, (_match, level: string) => `\n${'#'.repeat(Number(level))} `)
      .replace(/<\/(li|p|div|tr|td|th|h[1-6])\s*>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?(ul|ol|table|tbody|thead|strong|em|b|i|code|span|a|pre|blockquote)[^>]*>/gi, '')
      .replace(/<[^>]+>/g, ''),
  )
}

function cleanReleaseLine(line: string): string {
  return line
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/^[-*]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .trim()
}

const INTERNAL_RELEASE_NOTE_TERMS = [
  'scopedcandidates',
  'regex',
  'useeffect',
  'closure',
  'ref set',
  'json',
  'provider',
  'haiku',
  'system prompt',
  'electron-builder',
  'github actions',
  'authenticode',
]

function sectionForLine(line: string, current: string | null): string | null {
  const heading = /^#{2,6}\s+(.+?)\s*$/.exec(line)
  if (!heading) return current
  return heading[1].trim().toLowerCase()
}

function isUserFacingSection(section: string | null): boolean {
  if (!section) return true
  if (/included commits|downloads|release assets|update metadata|validation/i.test(section)) return false
  return /highlights|fixed|added|changed|improved|new/i.test(section)
}

function conciseReleaseHighlight(rawLine: string): string | null {
  const cleaned = cleanReleaseLine(rawLine)
  if (!cleaned) return null
  if (/^[-a-f0-9]{7,}\s+/i.test(cleaned)) return null
  if (/^compare changes:/i.test(cleaned)) return null
  if (/^this .*workflow uploads/i.test(cleaned)) return null

  const firstSentence = cleaned.match(/^(.+?[.!?])(?:\s|$)/)?.[1]?.trim() ?? cleaned
  const hasInternalTerms = INTERNAL_RELEASE_NOTE_TERMS.some((term) => cleaned.toLowerCase().includes(term))
  const candidate = hasInternalTerms ? firstSentence : cleaned
  return candidate.length > 150 ? `${candidate.slice(0, 147).trimEnd()}...` : candidate
}

export function extractReleaseHighlights(releaseNotesText: string | null, limit = 2): string[] {
  if (!releaseNotesText) return []

  const normalized = /<[a-z!/][^>]*>/i.test(releaseNotesText)
    ? normalizeHtmlReleaseNotes(releaseNotesText)
    : releaseNotesText

  const lines = normalized
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  let currentSection: string | null = null
  const bullets: string[] = []
  for (const line of lines) {
    currentSection = sectionForLine(line, currentSection)
    if (!/^[-*]\s+/.test(line)) continue
    if (!isUserFacingSection(currentSection)) continue
    const highlight = conciseReleaseHighlight(line)
    if (highlight) bullets.push(highlight)
  }

  if (bullets.length > 0) return bullets.slice(0, limit)

  return lines
    .filter((line) => !line.startsWith('#'))
    .filter((line) => !/^compare changes:/i.test(line))
    .filter((line) => !/^v?\d+\.\d+\.\d+/i.test(line))
    .filter((line) => !/^(daylens\s+)?v?\d+\.\d+\.\d+(\s+-\s+\d{4}-\d{2}-\d{2})?$/i.test(line))
    .map(conciseReleaseHighlight)
    .filter((line): line is string => Boolean(line))
    .slice(0, limit)
}
