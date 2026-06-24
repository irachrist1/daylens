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

// Newest first. Each entry is a real release of Daylens.
export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    issue: 3,
    version: '2.1',
    date: '2026-06-24',
    headline: 'A first run that actually knows you',
    dek: 'Onboarding asks who you are, and now the whole app listens.',
    body:
      'Setting up Daylens used to collect your name, your work, your clients and the rhythm of your day, then quietly forget most of it. Now every answer earns its keep. Your recaps and the morning brief frame the day in your terms, the apps you call real work count toward your focus, your briefs arrive on your schedule instead of a fixed one, and the clients you named get recognised in your day. Tell Daylens about you once, and it shows up everywhere.',
    hero: { from: '#f6d365', to: '#fda085', accent: '#b65b2f' },
    notes: [
      'Recaps, briefs and wraps now write in your voice and for your role.',
      'Focus apps you picked count as real work in the timeline and Apps view.',
      'Work rhythm tunes when your morning brief and evening wrap arrive.',
    ],
  },
  {
    issue: 2,
    version: '2.0',
    date: '2026-06-20',
    headline: 'A timeline you can believe',
    dek: 'Your day, drawn like a calendar instead of a pile of slivers.',
    body:
      'The timeline now reads like a real calendar of your day. Blocks are sized by how long they lasted, so a three-hour stretch towers over a quick detour, and short moments fold into the work around them instead of cluttering the day. Two things that were really one thing merge cleanly, and you can fuse blocks yourself by clicking one, holding Shift, and clicking another. A glance tells you where your time went before you read a single label.',
    hero: { from: '#a1c4fd', to: '#c2e9fb', accent: '#3b6ea5' },
    notes: [
      'Blocks have a fifteen-minute floor, so no more thirty-second slivers.',
      'Shift-click two blocks to merge the whole span into one.',
    ],
  },
  {
    issue: 1,
    version: '1.9',
    date: '2026-06-12',
    headline: 'Bring your own AI, or use ours',
    dek: 'Five dollars of AI on the house, then your call.',
    body:
      'Daylens turns your local activity into recaps, briefs and answers using AI, and now you choose how it is powered. Start with five dollars of included usage, subscribe to keep going, or bring your own provider key and pay nobody but them. Either way your raw activity stays on your machine, and a usage view shows exactly where every cent and token went.',
    hero: { from: '#c3a5fd', to: '#e0c3fc', accent: '#6b4ea5' },
    notes: [
      'A usage view breaks spend down by feature, with a CSV export.',
      'Your keys live in the OS keychain, never in plain text.',
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
