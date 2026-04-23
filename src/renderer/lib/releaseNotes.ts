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

export function extractReleaseHighlights(releaseNotesText: string | null, limit = 4): string[] {
  if (!releaseNotesText) return []

  const normalized = /<[a-z!/][^>]*>/i.test(releaseNotesText)
    ? normalizeHtmlReleaseNotes(releaseNotesText)
    : releaseNotesText

  const lines = normalized
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const bullets = lines
    .filter((line) => /^[-*]\s+/.test(line))
    .map(cleanReleaseLine)
    .filter(Boolean)

  if (bullets.length > 0) return bullets.slice(0, limit)

  return lines
    .filter((line) => !line.startsWith('#'))
    .filter((line) => !/^compare changes:/i.test(line))
    .filter((line) => !/^v?\d+\.\d+\.\d+/i.test(line))
    .filter((line) => !/^(daylens\s+)?v?\d+\.\d+\.\d+(\s+-\s+\d{4}-\d{2}-\d{2})?$/i.test(line))
    .map(cleanReleaseLine)
    .filter(Boolean)
    .slice(0, limit)
}
