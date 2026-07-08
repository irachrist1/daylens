// ---------------------------------------------------------------------------
// Window-title semantic context — Stage 0.1 of the Wrapped data layer.
//
// app_sessions stores rich window titles (project names, document titles,
// meeting names, branch names) that the wrap facts historically ignored: the
// narrator knew "4 hours in Cursor" but not that it was the billing service.
// This module distills a day's titles per app into a few semantic clusters —
// humanized descriptions of what the titles suggest, never the raw strings.
//
// Deterministic and pure (no AI, no DB, no Electron) so it runs in the
// renderer facts builder, the main-process tools, and tests identically.
// Humanization rides the SAME logic as timeline block naming (humanizeTitle),
// so a filename or app-suffixed title cleans up the same way everywhere.
// ---------------------------------------------------------------------------

import { humanizeTitle } from './humanize'

export interface TitleSessionInput {
  windowTitle?: string | null
  durationSeconds: number
}

export interface WindowTitleCluster {
  /** Humanized description of what the titles suggest ("SPCS Build Proposal CCI"). */
  label: string
  /** How many sessions fell into this cluster. */
  sessions: number
  /** Total seconds across those sessions. */
  seconds: number
}

export interface AppTitleContext {
  appName: string
  clusters: WindowTitleCluster[]
}

const MAX_CLUSTERS_PER_APP = 5
const MIN_CLUSTER_SECONDS = 60
const MIN_KEY_LENGTH = 3
/** Two cluster keys merge when one is a prefix of the other at this length —
 *  the capture truncates long titles with an ellipsis, so "Meet – Machine
 *  Learning…" and "Meet – Machine Learning Pipeline" are the same thing. */
const PREFIX_MERGE_MIN_LENGTH = 12

/** Browser-profile and badge chrome that precedes the real title. */
const PROFILE_PREFIX_RE = /^(?:work|personal|school|profile \d+)\s+[—–-]\s+/i
const BADGE_PREFIX_RE = /^\(\d+\)\s*/
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi

/** UI chrome that carries no subject at all. */
const CHROME_TITLES = new Set([
  'new tab', 'new chat', 'new conversation', 'new thread', 'new session',
  'untitled', 'home', 'inbox', 'settings', 'notifications', 'dashboard',
  'sign in', 'log in', 'login', 'loading', 'blank',
])

function stripDecorations(raw: string): string {
  return raw
    .replace(BADGE_PREFIX_RE, '')
    .replace(PROFILE_PREFIX_RE, '')
    .replace(EMAIL_RE, '')
    // Braille spinner glyphs and control characters from terminal captures.
    .replace(/[\u2800-\u28FF]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F]/g, '')
    // Leading decorative symbols ("\u2733 Claude Code", "\u26EC New Session").
    .replace(/^[^\p{L}\p{N}]+/u, '')
    // Truncation ellipses from the capture layer.
    .replace(/[.\u2026]{3,}\s*$|\u2026\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The meaningful subject segment of a title. Multi-segment titles read
 *  subject-first ("Caching | Claude Platform", "Sign in - Claude"), so the
 *  first non-chrome segment wins. */
function subjectSegment(cleaned: string): string {
  // Split only on unambiguous chrome separators (pipe, bullet, em dash). An en
  // dash stays: it joins subject parts ("Meet – Machine Learning Pipeline").
  const segments = cleaned.split(/\s*[|•]\s*|\s+—\s+/).map((s) => s.trim()).filter(Boolean)
  for (const segment of segments) {
    if (!CHROME_TITLES.has(segment.toLowerCase())) return segment
  }
  return segments[0] ?? cleaned
}

function clusterKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 48)
}

/** Distill one app's day of window titles into semantic clusters, biggest
 *  first. Sessions whose title is missing, equals the app name, or is pure UI
 *  chrome contribute nothing. */
export function clusterWindowTitles(
  appName: string,
  sessions: TitleSessionInput[],
): WindowTitleCluster[] {
  interface Bucket { label: string; key: string; sessions: number; seconds: number }
  const buckets = new Map<string, Bucket>()
  const appNameKey = clusterKey(appName)

  for (const session of sessions) {
    const raw = (session.windowTitle ?? '').trim()
    if (!raw) continue
    const cleaned = stripDecorations(raw)
    if (!cleaned) continue
    const subject = subjectSegment(cleaned)
    const humanized = humanizeTitle(subject) ?? subject
    if (!humanized || humanized.length < MIN_KEY_LENGTH) continue
    if (CHROME_TITLES.has(humanized.toLowerCase())) continue
    const key = clusterKey(humanized)
    if (!key || key.length < MIN_KEY_LENGTH) continue
    // A title that is just the app's own name carries no context ("Granola").
    if (key === appNameKey) continue
    const existing = buckets.get(key)
    if (existing) {
      existing.sessions += 1
      existing.seconds += Math.max(0, session.durationSeconds)
      // Prefer the longest observed form as the display label — the capture
      // truncates, so the longest form is the least clipped one.
      if (humanized.length > existing.label.length) existing.label = humanized
    } else {
      buckets.set(key, { label: humanized, key, sessions: 1, seconds: Math.max(0, session.durationSeconds) })
    }
  }

  // Merge truncation variants: a key that is a prefix of a longer key (or vice
  // versa) at meaningful length is the same subject clipped at different points.
  const ordered = [...buckets.values()].sort((a, b) => b.key.length - a.key.length)
  const merged: Bucket[] = []
  for (const bucket of ordered) {
    const host = merged.find((m) =>
      bucket.key.length >= PREFIX_MERGE_MIN_LENGTH
      && (m.key.startsWith(bucket.key) || bucket.key.startsWith(m.key)))
    if (host) {
      host.sessions += bucket.sessions
      host.seconds += bucket.seconds
      if (bucket.label.length > host.label.length) host.label = bucket.label
    } else {
      merged.push({ ...bucket })
    }
  }

  return merged
    .filter((b) => b.seconds >= MIN_CLUSTER_SECONDS)
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, MAX_CLUSTERS_PER_APP)
    .map((b) => ({
      label: b.label.replace(/[\s:;,*\-–—]+$/, ''),
      sessions: b.sessions,
      seconds: Math.round(b.seconds),
    }))
}

const MAX_CONTEXT_APPS = 6
const MIN_APP_CONTEXT_SECONDS = 5 * 60

/** Per-app title context for a whole day: which apps had real title signal,
 *  and what the titles suggest the user was doing in each. */
export function buildDayTitleContext(
  sessions: Array<{ appName: string; windowTitle?: string | null; durationSeconds: number; category?: string }>,
): AppTitleContext[] {
  const byApp = new Map<string, TitleSessionInput[]>()
  for (const session of sessions) {
    if (!session.appName) continue
    if (session.category === 'system' || session.category === 'uncategorized') continue
    const list = byApp.get(session.appName)
    if (list) list.push(session)
    else byApp.set(session.appName, [session])
  }
  const out: AppTitleContext[] = []
  for (const [appName, appSessions] of byApp) {
    const clusters = clusterWindowTitles(appName, appSessions)
    if (clusters.length === 0) continue
    const seconds = clusters.reduce((s, c) => s + c.seconds, 0)
    if (seconds < MIN_APP_CONTEXT_SECONDS) continue
    out.push({ appName, clusters })
  }
  return out
    .sort((a, b) =>
      b.clusters.reduce((s, c) => s + c.seconds, 0) - a.clusters.reduce((s, c) => s + c.seconds, 0))
    .slice(0, MAX_CONTEXT_APPS)
}
