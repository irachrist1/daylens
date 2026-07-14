// Parser/validator for genuinely model-written chat reports.
//
// NOTE (no fake AI): this module used to also export
// fallbackGeneratedReportContent — a templated report presented as if the AI
// wrote it whenever the model call failed or returned unparseable output. That
// violated the no-fake-AI rule ("when Daylens doesn't know, it says so"), so
// the chat report path now surfaces an honest, retryable error instead, and
// the template was deleted.

export interface GeneratedReportContent {
  assistantResponse: string
  reportTitle: string
  reportMarkdown: string
}

export function isUserFacingReportMarkdown(markdown: string): boolean {
  const normalized = markdown.toLowerCase()
  if (normalized.includes('evidence preview')) return false
  if (/\n-\s*(start|end|block|category):/i.test(markdown)) return false
  return markdown.trim().length >= 80
}

export function parseGeneratedReportResult(
  raw: string,
  fallbackTitle: string,
): GeneratedReportContent | null {
  const normalized = escapeJsonBlock(raw)
  if (!normalized) return null

  try {
    const parsed = JSON.parse(normalized) as {
      assistantResponse?: unknown
      reportTitle?: unknown
      reportMarkdown?: unknown
    }
    const assistantResponse = typeof parsed.assistantResponse === 'string' ? parsed.assistantResponse.trim() : ''
    const reportMarkdown = typeof parsed.reportMarkdown === 'string' ? parsed.reportMarkdown.trim() : ''
    const reportTitle = typeof parsed.reportTitle === 'string' && parsed.reportTitle.trim()
      ? parsed.reportTitle.trim()
      : fallbackTitle
    const effectiveBody = reportMarkdown || assistantResponse
    if (!effectiveBody) return null
    if (!isUserFacingReportMarkdown(effectiveBody)) return null
    return {
      assistantResponse: assistantResponse || `I generated ${reportTitle}.`,
      reportTitle,
      reportMarkdown: effectiveBody,
    }
  } catch {
    return null
  }
}

function escapeJsonBlock(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return fenced?.[1]?.trim() ?? raw.trim()
}
