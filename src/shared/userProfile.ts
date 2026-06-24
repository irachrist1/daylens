import type { AppCategory, WorkRhythm } from './types'

// The profile the user fills in during onboarding, distilled into things the AI
// and the focus logic can actually use. Onboarding persists every one of these
// into AppSettings; this module is the single place that turns them into prompt
// context and focus signal, so a field can never be "collected but ignored".

export interface UserProfile {
  userName?: string
  userRole?: string
  userIntent?: string
  userGoals?: string[]
  interestedCategories?: AppCategory[]
  userClients?: string[]
  workRhythm?: WorkRhythm
  focusApps?: string[]
}

// Human labels for the activity categories the user can say they care about.
const CATEGORY_LABELS: Record<AppCategory, string> = {
  development: 'coding',
  communication: 'messaging and chat',
  research: 'research and reading',
  writing: 'writing',
  aiTools: 'AI tools',
  design: 'design',
  browsing: 'web browsing',
  meetings: 'meetings',
  entertainment: 'entertainment',
  email: 'email',
  productivity: 'docs and planning',
  social: 'social media',
  system: 'system',
  uncategorized: 'other',
}

export function categoryLabel(category: AppCategory): string {
  return CATEGORY_LABELS[category] ?? String(category)
}

export function workRhythmLabel(rhythm: WorkRhythm | undefined): string | null {
  switch (rhythm) {
    case 'early':
      return 'an early bird who starts and finishes early'
    case 'night':
      return 'a night owl whose real work happens later in the day'
    case 'always':
      return 'always on, with work spread across the whole day'
    case 'standard':
      return 'a fairly standard nine-to-five day'
    default:
      return null
  }
}

function cleanList(values: string[] | undefined, limit: number): string[] {
  if (!Array.isArray(values)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of values) {
    const value = String(raw ?? '').trim()
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
    if (out.length >= limit) break
  }
  return out
}

function joinWithAnd(values: string[]): string {
  if (values.length <= 1) return values.join('')
  if (values.length === 2) return `${values[0]} and ${values[1]}`
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`
}

/**
 * A short "about this person" block appended to a recap / brief / wrap / chat
 * system prompt. It frames the writing in the user's own terms — who they are,
 * why they are here, what they care about, who their clients are. Returns '' for
 * a blank profile so a brand-new user's prompts stay clean. It never asserts a
 * fact about the day; it only tells the model whose day it is writing about.
 */
export function userProfileDirective(input: UserProfile): string {
  const lines: string[] = []

  const name = String(input.userName ?? '').trim()
  const role = String(input.userRole ?? '').trim()
  if (name && role) lines.push(`They are ${name}, and they describe what they do as: ${role}.`)
  else if (name) lines.push(`Their name is ${name}.`)
  else if (role) lines.push(`They describe what they do as: ${role}.`)

  const intent = String(input.userIntent ?? '').trim()
  if (intent) lines.push(`Why they are using Daylens: ${intent}.`)

  const goals = cleanList(input.userGoals, 5)
  if (goals.length > 0) lines.push(`What they are working toward: ${joinWithAnd(goals)}.`)

  const categories = (input.interestedCategories ?? []).map(categoryLabel)
  const interests = cleanList(categories, 5)
  if (interests.length > 0) {
    lines.push(`They care most about ${joinWithAnd(interests)}; when these show up in the day, lead with them.`)
  }

  const clients = cleanList(input.userClients, 8)
  if (clients.length > 0) {
    lines.push(`They work with these clients or projects: ${joinWithAnd(clients)}. When the evidence clearly shows work for one of them, name it and attribute the time; never guess which client when it is not in the evidence.`)
  }

  const focusApps = cleanList(input.focusApps, 8)
  if (focusApps.length > 0) {
    lines.push(`They count these as their real, focused work: ${joinWithAnd(focusApps)}.`)
  }

  const rhythm = workRhythmLabel(input.workRhythm)
  if (rhythm) lines.push(`Their working rhythm is ${rhythm}.`)

  if (lines.length === 0) return ''

  return [
    'About the person whose day you are writing for (use this only to frame the day in their terms, never to invent facts that are not in the evidence):',
    ...lines.map((line) => `- ${line}`),
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Focus apps → "real work"
// ---------------------------------------------------------------------------

function normalizeFocusToken(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase()
}

/**
 * Does this app match one of the apps the user marked as "real work" in
 * onboarding? Focus apps are stored as a free list of bundle ids and/or display
 * names, so we match a token against either the bundle id or the app name,
 * exact or as a contained phrase ("Figma" matches "Figma Desktop").
 */
export function appMatchesFocusList(
  focusApps: string[] | undefined,
  bundleId: string | null | undefined,
  appName: string | null | undefined,
): boolean {
  if (!Array.isArray(focusApps) || focusApps.length === 0) return false
  const bundle = normalizeFocusToken(bundleId)
  const name = normalizeFocusToken(appName)
  if (!bundle && !name) return false
  for (const raw of focusApps) {
    const token = normalizeFocusToken(raw)
    if (!token) continue
    if (token === bundle || token === name) return true
    if (name && (name.includes(token) || token.includes(name))) return true
    if (bundle && bundle.includes(token)) return true
  }
  return false
}
