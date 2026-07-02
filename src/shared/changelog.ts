// The in-app changelog ("Daylens Notes"), shown in Settings → Updates.
//
// SOURCE OF TRUTH: this file. These are hand-authored release notes, bundled
// with the app, describing things that actually shipped. When a release goes
// out, add a new entry at the TOP (newest first) and bump LATEST. Never
// fabricate a feature here — every entry must describe real, landed work, so
// the changelog stays trustworthy. There is no remote feed; the notes travel
// with the build, which is why a dev build can still show its own history.

export interface ChangelogEntry {
  /** Newsletter-style issue number, shown as "Issue 03". Monotonic, newest highest. */
  issue: number
  /** App version this shipped in, shown as a small detail (e.g. "2.1"). */
  version: string
  /** ISO date (YYYY-MM-DD) the release went out — the dateline. */
  date: string
  /** The big editorial headline for the release's highlight. */
  headline: string
  /** One-line standfirst under the headline. */
  dek: string
  /** A short, human paragraph: what changed and why it matters. */
  body: string
  /** Decorative gradient for the hero panel — an illustration, not a screenshot. */
  hero: { from: string; to: string; accent: string }
  /** Smaller "also in this release" notes. */
  notes?: string[]
}

// Newest first. Each entry is a real, shipped release of Daylens.
// v1.0.0 is the first version that was ever publicly released. Earlier
// development builds existed but were never shipped, so they do not appear here.
export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    issue: 1,
    version: '1.0.0',
    date: '2026-07-02',
    headline: 'Daylens ships',
    dek: 'Your laptop activity, turned into a calendar you can search and an AI that actually knows your day.',
    body:
      'Daylens captures what you work on, turns it into a timeline that reads like a real calendar, and lets you ask an AI about your day in plain language. Blocks are sized by how long they lasted, short detours fold into the work around them, and the apps you call real work count toward your focus. Bring your own provider key or start with included credit, your raw activity stays on your machine, and a usage view shows exactly where every cent and token went.',
    hero: { from: '#a1c4fd', to: '#c2e9fb', accent: '#3b6ea5' },
    notes: [
      'Timeline blocks are sized by duration, with a fifteen-minute floor.',
      'Shift-click two blocks to merge the whole span into one.',
      'Morning brief, evening wrap, and distraction alerts keep you honest.',
      'MCP server lets Claude Desktop and Cursor read your activity.',
    ],
  },
]

export const LATEST_CHANGELOG: ChangelogEntry = CHANGELOG[0]
export const LATEST_CHANGELOG_ISSUE: number = CHANGELOG[0]?.issue ?? 0

export function formatChangelogDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  if (!year || !month || !day) return iso
  const date = new Date(year, month - 1, day)
  return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
}

export function changelogIssueLabel(issue: number): string {
  return `Issue ${String(issue).padStart(2, '0')}`
}
