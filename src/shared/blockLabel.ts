import type { WorkContextBlock } from './types'

const GENERIC_LABELS = new Set([
  'AI Tools',
  'Browsing',
  'Communication',
  'Design',
  'Development',
  'Email',
  'Insufficient Data',
  'Insufficient Data For Label',
  'Meetings',
  'Mixed Work',
  'Productivity',
  'Research',
  'Research & AI Chat',
  'System',
  'Uncategorized',
  'Web Session',
])

function isUsefulLabel(value: string | null | undefined): value is string {
  if (!value) return false
  const trimmed = value.trim()
  if (!trimmed) return false
  if (GENERIC_LABELS.has(trimmed)) return false
  // Browser-tab-title soup like "W2_Reading | Intro to ML | Perusall" is
  // evidence, not a label. Reject here so the safety net falls through to a
  // cleaner source; pipe-soup naturalization belongs upstream where labels
  // are composed (see workBlocks.ts `naturalizeLabel`).
  if (/ \| /.test(trimmed)) return false
  return true
}

function cleanSiteName(domain: string): string {
  const stripped = domain.replace(/^www\./i, '').split('.')[0] ?? ''
  if (!stripped) return ''
  return stripped.charAt(0).toUpperCase() + stripped.slice(1)
}

export function userVisibleBlockLabel(block: WorkContextBlock): string {
  const override = block.label.override?.trim()
  if (override) return override

  const current = block.label.current?.trim()
  if (isUsefulLabel(current)) return current

  const ai = block.aiLabel?.trim()
  if (isUsefulLabel(ai)) return ai

  const rule = block.ruleBasedLabel?.trim()
  if (isUsefulLabel(rule)) return rule

  const site = block.websites[0]?.domain
  if (site) {
    const clean = cleanSiteName(site)
    if (clean) return clean
  }

  return 'Untitled block'
}
