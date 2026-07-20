// ---------------------------------------------------------------------------
// Domain → AppCategory — what kind of work a site IS, not just whether it is
// work at all (that coarser axis lives in workKind.ts / domainPolicy.ts).
//
// Why this exists: a browser session's category used to be whatever the
// BROWSER app was cataloged as, so a user who lives in one browser got every
// block collapsed into that single category — one color across the whole
// calendar, whatever they actually did. The block builder now splits a
// browser session's seconds across the categories of the sites reconciled
// inside it; this file is the site → category half of that.
//
// Keep it boring and declarative — it is meant to be read and audited. Hosts
// match exactly or by subdomain suffix ("m.youtube.com" ⊂ "youtube.com").
// Unknown hosts return null and their seconds stay plain 'browsing'.
// ---------------------------------------------------------------------------

import type { AppCategory } from './types'
import { policyForHost } from './domainPolicy'

const HOST_CATEGORIES: ReadonlyArray<[string, AppCategory]> = [
  // AI tools
  ['claude.ai', 'aiTools'],
  ['chatgpt.com', 'aiTools'],
  ['chat.openai.com', 'aiTools'],
  ['platform.openai.com', 'aiTools'],
  ['console.anthropic.com', 'aiTools'],
  ['gemini.google.com', 'aiTools'],
  ['aistudio.google.com', 'aiTools'],
  ['perplexity.ai', 'aiTools'],
  ['copilot.microsoft.com', 'aiTools'],
  ['poe.com', 'aiTools'],
  ['huggingface.co', 'aiTools'],

  // Research — reading code/PRs on GitHub badges as focused research, not
  // browsing and not hands-on development (established convention: workBlocks
  // categoryForTopPageArtifact and the block-splitting suite).
  ['github.com', 'research'],

  // Development
  ['gitlab.com', 'development'],
  ['bitbucket.org', 'development'],
  ['stackoverflow.com', 'development'],
  ['stackexchange.com', 'development'],
  ['localhost', 'development'],
  ['127.0.0.1', 'development'],
  ['npmjs.com', 'development'],
  ['developer.mozilla.org', 'development'],
  ['readthedocs.io', 'development'],
  ['vercel.com', 'development'],
  ['netlify.com', 'development'],
  ['supabase.com', 'development'],
  ['console.aws.amazon.com', 'development'],
  ['console.cloud.google.com', 'development'],

  // Design
  ['figma.com', 'design'],
  ['canva.com', 'design'],
  ['dribbble.com', 'design'],
  ['behance.net', 'design'],
  ['framer.com', 'design'],
  ['spline.design', 'design'],

  // Writing / docs
  ['docs.google.com', 'writing'],
  ['medium.com', 'writing'],
  ['substack.com', 'writing'],
  ['overleaf.com', 'writing'],

  // Productivity
  ['notion.so', 'productivity'],
  ['notion.site', 'productivity'],
  ['app.notion.com', 'productivity'],
  ['linear.app', 'productivity'],
  ['airtable.com', 'productivity'],
  ['trello.com', 'productivity'],
  ['asana.com', 'productivity'],
  ['calendar.google.com', 'productivity'],
  ['sheets.google.com', 'productivity'],
  ['atlassian.net', 'productivity'],

  // Email
  ['mail.google.com', 'email'],
  ['outlook.live.com', 'email'],
  ['outlook.office.com', 'email'],

  // Meetings
  ['meet.google.com', 'meetings'],
  ['zoom.us', 'meetings'],
  ['teams.microsoft.com', 'meetings'],

  // Communication
  ['slack.com', 'communication'],
  ['discord.com', 'communication'],
  ['web.whatsapp.com', 'communication'],
  ['web.telegram.org', 'communication'],

  // Research
  ['wikipedia.org', 'research'],
  ['scholar.google.com', 'research'],
  ['arxiv.org', 'research'],
  ['jstor.org', 'research'],

  // Education / courses — studying reads as research, not plain browsing.
  ['coursera.org', 'research'],
  ['udemy.com', 'research'],
  ['edx.org', 'research'],
  ['khanacademy.org', 'research'],
  ['datacamp.com', 'research'],
  ['pluralsight.com', 'research'],
  ['codecademy.com', 'research'],
  ['freecodecamp.org', 'research'],
  ['brilliant.org', 'research'],
  ['deeplearning.ai', 'research'],
  ['udacity.com', 'research'],
  ['futurelearn.com', 'research'],
  ['skillshare.com', 'research'],
  ['instructure.com', 'research'],
  ['blackboard.com', 'research'],
  ['moodle.org', 'research'],
]

// Hosts where minutes without keyboard/mouse input are normal engaged
// behavior: course platforms (video lectures, timed exams) and long-form
// reading/documentation. These get a bounded passive-presence hold — unlike
// entertainment/meetings, whose hold is open-ended because playback or a live
// call proves presence on its own.
const PASSIVE_READING_HOSTS: readonly string[] = [
  'coursera.org', 'udemy.com', 'edx.org', 'khanacademy.org', 'datacamp.com',
  'pluralsight.com', 'codecademy.com', 'freecodecamp.org', 'brilliant.org',
  'deeplearning.ai', 'udacity.com', 'futurelearn.com', 'skillshare.com',
  'instructure.com', 'blackboard.com', 'moodle.org',
  'developer.mozilla.org', 'readthedocs.io', 'wikipedia.org', 'arxiv.org',
  'scholar.google.com', 'jstor.org', 'medium.com', 'substack.com',
]

export type PassiveHoldKind = 'media' | 'reading'

/** How a site holds a no-input session open: 'media' (watching/attending —
 *  open-ended), 'reading' (studying/reading — held up to an explicit cap), or
 *  null (ordinary idle handling applies). */
export function passiveHoldKindForDomain(host: string | null | undefined): PassiveHoldKind | null {
  const normalized = normalizeHost(host)
  if (!normalized) return null
  const category = categoryForDomain(normalized)
  if (category === 'entertainment' || category === 'meetings') return 'media'
  for (const candidate of PASSIVE_READING_HOSTS) {
    if (normalized === candidate || normalized.endsWith(`.${candidate}`)) return 'reading'
  }
  return null
}

function normalizeHost(host: string | null | undefined): string | null {
  if (!host) return null
  const trimmed = host.trim().toLowerCase()
  if (!trimmed) return null
  return trimmed.replace(/^www\./, '')
}

// Resolve a site's own activity category, or null when the host carries no
// strong signal (generic browsing). domainPolicy's leisure sinks map first so
// the two files can never disagree about what is entertainment/social.
export function categoryForDomain(host: string | null | undefined): AppCategory | null {
  const normalized = normalizeHost(host)
  if (!normalized) return null

  const policy = policyForHost(normalized)
  if (policy === 'social_feed') return 'social'
  if (policy === 'entertainment') return 'entertainment'

  for (const [candidate, category] of HOST_CATEGORIES) {
    if (normalized === candidate || normalized.endsWith(`.${candidate}`)) return category
  }
  return null
}
