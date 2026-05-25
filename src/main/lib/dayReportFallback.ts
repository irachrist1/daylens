export interface ReportContextBundleLike {
  title: string
  scopeLabel: string
  tableRows: Array<Record<string, unknown>>
  chartRows: Array<{ label: string; value: number }>
  chartValueLabel: string
}

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

export function fallbackGeneratedReportContent(bundle: ReportContextBundleLike): GeneratedReportContent {
  const rows = bundle.tableRows
  const cleanRows = rows
    .map((row) => ({
      start: String(row.start ?? ''),
      end: String(row.end ?? ''),
      block: cleanReportBlockLabel(String(row.block ?? ''), String(row.category ?? '')),
      category: String(row.category ?? ''),
      apps: String(row.apps ?? ''),
      duration: String(row.duration ?? ''),
    }))
    .filter((row) => row.block)

  const topCategories = bundle.chartRows
    .slice(0, 4)
    .map((row) => `${row.label} (${row.value} ${bundle.chartValueLabel})`)
  const meaningful = cleanRows
    .filter((row) => ['development', 'aiTools', 'productivity', 'writing', 'design', 'research'].includes(row.category))
    .slice(0, 3)
  const drift = cleanRows
    .filter((row) => ['browsing', 'entertainment', 'social'].includes(row.category))
    .slice(0, 2)
  // Build the "from A to B" window only when both ends are present and
  // non-empty; otherwise fall back to the scope label. Weekly reports use
  // day-shaped tableRows that lack `start`/`end`, which previously produced
  // a literal "from undefined to undefined" in the rendered report. See B6.
  const firstStart = cleanRows[0]?.start?.trim() ?? ''
  const lastEnd = cleanRows[cleanRows.length - 1]?.end?.trim() ?? ''
  const hasExplicitWindow = firstStart.length > 0 && lastEnd.length > 0
  const dayWindow = hasExplicitWindow ? `${firstStart} to ${lastEnd}` : bundle.scopeLabel
  const primaryCategory = bundle.chartRows[0]?.label ?? 'mixed activity'
  const summary = topCategories.length > 0
    ? `Time was spread across ${topCategories.join(', ')}.`
    : 'Daylens found tracked activity, but not enough categorized detail for a strong breakdown.'
  const bestStretch = meaningful[0]
    ? `The clearest work signal was ${meaningful[0].block} from ${meaningful[0].start} to ${meaningful[0].end}.`
    : 'There was not one clean work stretch strong enough to name confidently.'
  const watchOut = drift[0]
    ? `Some time also drifted into ${drift.map((row) => row.block).join(' and ')}, so this should be read as a mixed day rather than a pure focus day.`
    : 'The evidence does not show a major non-work browser stretch in the summarized blocks.'
  const evidence = [
    `Tracked window: ${dayWindow}.`,
    meaningful.length > 0 ? `Work signals: ${meaningful.map((row) => `${row.block} (${row.duration})`).join('; ')}.` : null,
    drift.length > 0 ? `Mixed or drift signals: ${drift.map((row) => `${row.block} (${row.duration})`).join('; ')}.` : null,
  ].filter(Boolean)

  // B7: the takeaway used to literally announce "This report is
  // deterministic, not AI-written" — the worst-of-both: the user sees a
  // non-answer and sees that the system gave up. Replace with a takeaway
  // grounded in the same structured evidence (top category, work signals,
  // drift signals), so the report reads as a deliberate read of the day
  // rather than a printout of a fallback skeleton.
  const meaningfulShare = meaningful.length
  const driftShare = drift.length
  const takeaway = (() => {
    if (meaningfulShare > 0 && driftShare === 0) {
      return `The day reads as ${primaryCategory.replace(/([A-Z])/g, ' $1').toLowerCase()}-led, with the strongest signal in ${meaningful[0].block.toLowerCase()}. No major drift stretches showed up in the summarized blocks.`
    }
    if (meaningfulShare === 0 && driftShare > 0) {
      return `The day reads as mostly drift — ${drift.map((row) => row.block.toLowerCase()).join(' and ')} dominated the summarized blocks, with no single work stretch strong enough to anchor the day.`
    }
    if (meaningfulShare > 0 && driftShare > 0) {
      return `Treat this as a mixed day: real work happened in ${meaningful[0].block.toLowerCase()}, but ${drift.map((row) => row.block.toLowerCase()).join(' and ')} also pulled meaningful time.`
    }
    return `Activity was spread across ${primaryCategory.replace(/([A-Z])/g, ' $1').toLowerCase()} signals without a single block strong enough to anchor a clear theme.`
  })()

  return {
    assistantResponse: `I pulled together a grounded report for ${bundle.scopeLabel} from the local timeline.`,
    reportTitle: bundle.title,
    reportMarkdown: [
      `# ${bundle.title}`,
      '',
      `## Headline`,
      `A ${primaryCategory === 'browsing' ? 'mixed, browser-led' : primaryCategory.replace(/([A-Z])/g, ' $1').toLowerCase()} ${bundle.scopeLabel.toLowerCase().includes('week') ? 'week' : 'day'} with mixed signal.`,
      '',
      `## What happened`,
      hasExplicitWindow
        ? `Daylens tracked activity from ${dayWindow}. ${summary}`
        : `Daylens tracked activity over ${dayWindow}. ${summary}`,
      '',
      `## Strongest stretch`,
      bestStretch,
      '',
      `## Where time went`,
      watchOut,
      '',
      `## Takeaway`,
      takeaway,
      '',
      `## Evidence used`,
      ...evidence.map((line) => `- ${line}`),
    ].join('\n'),
  }
}

function escapeJsonBlock(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return fenced?.[1]?.trim() ?? raw.trim()
}

function cleanReportBlockLabel(label: string, category: string): string {
  const trimmed = label.trim()
  const fallback = (() => {
    switch (category) {
      case 'development': return 'development work'
      case 'aiTools': return 'AI-assisted work'
      case 'productivity': return 'admin or productivity work'
      case 'writing': return 'writing work'
      case 'research': return 'research'
      case 'browsing': return 'browser activity'
      case 'entertainment': return 'entertainment'
      case 'social': return 'social browsing'
      case 'email': return 'email'
      case 'communication': return 'communication'
      default: return 'tracked activity'
    }
  })()
  if (!trimmed) return fallback
  if (/\|\s*(linkedin|youtube|coursera|outlook|x|twitter)\b/i.test(trimmed)) return fallback
  if (/[-–]\s*youtube\b/i.test(trimmed)) return fallback
  if (/^watch\s+/i.test(trimmed)) return fallback
  if (/\bseason\s+\d+\s+episode\s+\d+\b/i.test(trimmed)) return fallback
  if (/^mail\s+-\s+/i.test(trimmed)) return fallback
  if (/^(chatgpt|youtube|outlook|mail)$/i.test(trimmed)) return fallback
  return trimmed.length > 72 ? `${trimmed.slice(0, 69)}...` : trimmed
}
