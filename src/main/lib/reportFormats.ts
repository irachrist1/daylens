// Report export formats and the natural-language routing around them. Kept here,
// free of Electron, so the tricky "is this a fresh report or a re-export of the
// last one?" decision is unit-testable.

export type ReportExportFormat = 'pdf' | 'docx' | 'markdown' | 'html'

// The document format(s) the user named — "in word", "as a pdf", "markdown
// version". Reports default to PDF elsewhere when none is named.
export function detectRequestedFormats(question: string): ReportExportFormat[] {
  const q = question.toLowerCase()
  const formats: ReportExportFormat[] = []
  if (/\bpdf\b/.test(q)) formats.push('pdf')
  if (/\b(?:word|ms ?word|docx?)\b|\.docx?\b/.test(q)) formats.push('docx')
  if (/\bmarkdown\b|\bmd\b|\.md\b/.test(q)) formats.push('markdown')
  if (/\bhtml\b|\bweb ?page\b/.test(q)) formats.push('html')
  return [...new Set(formats)]
}

export function formatDisplayName(format: ReportExportFormat): string {
  switch (format) {
    case 'pdf': return 'a PDF'
    case 'docx': return 'a Word doc'
    case 'markdown': return 'a Markdown file'
    case 'html': return 'an HTML page'
  }
}

// A time word means "make a fresh report of <period>", not "re-export the last
// answer" — so those go down the generation path instead.
const TIME_WORD_RE =
  /\b(today|yesterday|tomorrow|week|month|year|day|days|morning|afternoon|evening|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|last|this|recent)\b/

// True when the message is essentially JUST "give me that in <format>": a format
// is named, no time period is referenced, and almost nothing substantive remains
// once filler and the format words are stripped. That's a re-export of the answer
// we just gave, not a fresh report.
export function looksLikeBareFormatRequest(question: string): boolean {
  if (detectRequestedFormats(question).length === 0) return false
  const lower = question.toLowerCase()
  if (TIME_WORD_RE.test(lower)) return false
  const remainder = lower
    .replace(/\b(in|as|to|into|a|an|the|me|that|this|it|give|gimme|can|could|i|get|got|have|please|pls|version|format|file|files|export|download|of|make|turn|convert|copy|now|instead|one|put|send|same|thing|report|doc|document|just|also|too)\b/g, ' ')
    .replace(/\b(?:word|ms ?word|docx?|pdf|markdown|md|html|web ?page)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return remainder.split(' ').filter(Boolean).length <= 2
}
