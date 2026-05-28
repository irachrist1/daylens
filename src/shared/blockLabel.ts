import type { WorkContextBlock } from './types'

const GENERIC_LABELS = new Set([
  'AI Tools',
  'Browsing',
  'Building & Testing',
  'Communication',
  'Design',
  'Development',
  'Email',
  'General Browsing',
  'General Productivity',
  'Inbox Triage',
  'Insufficient Data',
  'Insufficient Data For Label',
  'Meetings',
  'Misc Tasks',
  'Mixed Browsing',
  'Mixed Work',
  'Productivity',
  'Research',
  'Research & AI Chat',
  'System',
  'Terminal Session',
  'Terminal Work',
  'Uncategorized',
  'Untitled Block',
  'Web Session',
  'Writing',
])

export function naturalizeLabel(value: string): string {
  if (!value) return ''
  let cleaned = value.trim()

  // 1. Clean trailing browser/app names
  cleaned = cleaned.replace(/\s*-\s*(?:Google Chrome|Safari|Arc|Firefox|Brave|Microsoft Edge|Chrome)$/i, '')

  // 2. Clean trailing pipe-soup or dash-soup (domain names, app names, etc.)
  const splitters = [/\s*\|\s*/, /\s*—\s*/, /\s*-\s*/]
  for (const splitter of splitters) {
    if (splitter.test(cleaned)) {
      const segments = cleaned.split(splitter).map(s => s.trim()).filter(Boolean)
      if (segments.length > 1) {
        const domainOrAppSuffixes = /^(?:github|jira|figma|google docs|google sheets|safari|chrome|arc|domain|perusall|youtube|twitter|facebook|notion|slack|canvas|gmail|inbox|mailbox|drive|calendar|meet)$/i
        const filtered = segments.filter(s => !domainOrAppSuffixes.test(s))
        if (filtered.length > 0) {
          cleaned = filtered[0]
          break
        } else {
          cleaned = segments[0]
          break
        }
      }
    }
  }

  return cleaned.trim()
}

function isUsefulLabel(value: string | null | undefined): value is string {
  if (!value) return false
  const trimmed = value.trim()
  if (!trimmed) return false
  if (GENERIC_LABELS.has(trimmed)) return false
  const pipeSegments = trimmed.split(/\s*\|\s*/).filter(Boolean)
  // 3+ pipe segments is almost always raw browser-tab soup
  // ("W2_Reading | Intro to ML | Perusall"). Reject so we fall through to a
  // useful AI/rule label, top artifact, or domain fallback rather than
  // showing the user the tab title verbatim.
  if (pipeSegments.length >= 3) return false
  if (pipeSegments.length === 2) {
    const natural = naturalizeLabel(trimmed)
    if (!natural || GENERIC_LABELS.has(natural)) return false
  }
  return true
}

function cleanSiteName(domain: string): string {
  const stripped = domain.replace(/^www\./i, '').split('.')[0] ?? ''
  if (!stripped) return ''
  return stripped.charAt(0).toUpperCase() + stripped.slice(1)
}

export function userVisibleBlockLabel(block: WorkContextBlock): string {
  const override = block.label.override?.trim()
  // User override is intentional — preserve it verbatim even if it contains
  // pipes or other characters that naturalize would strip.
  if (override) return override

  const current = block.label.current?.trim()
  if (isUsefulLabel(current)) return naturalizeLabel(current)

  const ai = block.aiLabel?.trim()
  if (isUsefulLabel(ai)) return naturalizeLabel(ai)

  const rule = block.ruleBasedLabel?.trim()
  if (isUsefulLabel(rule)) return naturalizeLabel(rule)

  // Before defaulting to a website domain or "Untitled block", try the
  // dominant artifact title — that is what the user was actually looking at,
  // and a naturalized version reads better than "Untitled block" or a bare
  // domain like "github.com".
  const topArtifact = block.topArtifacts.find((artifact) => artifact.displayTitle?.trim().length > 0)
  if (topArtifact) {
    const naturalized = naturalizeLabel(topArtifact.displayTitle.trim())
    if (naturalized && !GENERIC_LABELS.has(naturalized)) return naturalized
  }

  const site = block.websites[0]?.domain
  if (site) {
    const clean = cleanSiteName(site)
    if (clean) return clean
  }

  return 'Untitled block'
}
