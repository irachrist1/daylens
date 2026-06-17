import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const DEFAULT_SOURCE_DB = path.join(os.homedir(), 'Library/Application Support/DaylensWindows/daylens.sqlite')
const SOURCE_DB = process.env.DAYLENS_TIMELINE_EVAL_SOURCE_DB ?? DEFAULT_SOURCE_DB
const OUTPUT_PATH = process.env.DAYLENS_TIMELINE_EVAL_OUTPUT
  ?? path.join(HERE, 'fixtures/founder-real-jun16-week.json')
const TRUTH_PATH = path.join(HERE, 'founder-truth.json')

const FOUNDER_DAY = '2026-06-16'
const WEEK_START = '2026-06-15'
const WEEK_END = '2026-06-21'

type SourceSession = {
  id: number
  bundle_id: string
  app_name: string
  start_time: number
  end_time: number | null
  duration_sec: number
  category: string
  window_title: string | null
}

type SourceVisit = {
  domain: string
  page_title: string | null
  url: string | null
  normalized_url: string | null
  page_key: string | null
  visit_time: number
  duration_sec: number
  browser_bundle_id: string | null
  canonical_browser_id: string | null
}

type FounderTruth = {
  fixtureId: string
  day: {
    date: string
    trackedMinutes: number
    toleranceMinutes: number
    source: string
  }
  week: {
    startDate: string
    endDate: string
    capturedThrough: string
    trackedMinutes: number
    toleranceMinutes: number
    source: string
  }
}

const PUBLIC_BEHAVIOR_DOMAINS = new Set([
  'chatgpt.com',
  'claude.ai',
  'cursor.com',
  'docs.google.com',
  'figma.com',
  'github.com',
  'linear.app',
  'meet.google.com',
  'netflix.com',
  'nextdns.io',
  'notion.so',
  'reddit.com',
  'slack.com',
  'starlink.com',
  'x.com',
  'youtube.com',
])

const SAFE_TITLE_TERMS = [
  'ChatGPT',
  'Claude',
  'Cursor',
  'Daylens',
  'Figma',
  'GitHub',
  'Google Meet',
  'Linear',
  'Machine Learning Pipeline',
  'Netflix',
  'NextDNS',
  'Notion',
  'Reddit',
  'Slack',
  'Starlink',
  'YouTube',
]

const SENSITIVE_ACCOUNT_DOMAIN = /(^|\.)(?:account|accounts|auth|calendar|checkout|intranet|login|mail|m365|myaccount|oauth2|outlook|passwords|sso)\./i
const SENSITIVE_TITLE = /\b(?:api keys?|billing|calendar|inbox|mail|oauth|password|sign[ -]?in|verification code|workspace)\b/i
const PRIVATE_IP = /\b(?:(?:10|127)\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g
const LOCAL_PATH = /(?:\/Users\/[^/\s]+|[A-Za-z]:\\Users\\[^\\\s]+)/g
const FOUNDER_IDENTIFIERS = /\b(?:christian\s+tonny|irachrist1|tonny)\b/gi

function localDateMs(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day, 0, 0, 0, 0).getTime()
}

function localDateTimeMs(dateTime: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(dateTime)
  if (!match) throw new Error(`Invalid local fixture timestamp: ${dateTime}`)
  const [, year, month, day, hour, minute, second] = match.map(Number)
  const value = new Date(year, month - 1, day, hour, minute, second, 0)
  if (
    value.getFullYear() !== year
    || value.getMonth() !== month - 1
    || value.getDate() !== day
    || value.getHours() !== hour
    || value.getMinutes() !== minute
    || value.getSeconds() !== second
  ) {
    throw new Error(`Invalid local fixture timestamp: ${dateTime}`)
  }
  return value.getTime()
}

function shiftDateString(dateStr: string, days: number): string {
  const next = new Date(localDateMs(dateStr))
  next.setDate(next.getDate() + days)
  const year = next.getFullYear()
  const month = String(next.getMonth() + 1).padStart(2, '0')
  const day = String(next.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function localDateString(ms: number): string {
  const date = new Date(ms)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function sourceSessionEnd(session: SourceSession): number {
  return session.end_time ?? (session.start_time + session.duration_sec * 1000)
}

function splitSessionByDay(session: SourceSession, rangeStartMs: number, rangeEndMs: number): SourceSession[] {
  const originalStart = Math.max(session.start_time, rangeStartMs)
  const originalEnd = Math.min(sourceSessionEnd(session), rangeEndMs)
  if (originalEnd <= originalStart) return []

  const pieces: SourceSession[] = []
  let start = originalStart
  while (start < originalEnd) {
    const nextDate = shiftDateString(localDateString(start), 1)
    const dayEnd = Math.min(localDateMs(nextDate), originalEnd)
    if (dayEnd > start) {
      pieces.push({
        ...session,
        start_time: start,
        end_time: dayEnd,
        duration_sec: Math.max(1, Math.round((dayEnd - start) / 1000)),
      })
    }
    start = dayEnd
  }
  return pieces
}

function clock(ms: number): string {
  const date = new Date(ms)
  return [
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
  ].join(':')
}

const opaqueAliases = new Map<string, Map<string, string>>()

function opaqueAlias(prefix: string, value: string): string {
  const normalized = value.trim().toLowerCase()
  const aliases = opaqueAliases.get(prefix) ?? new Map<string, string>()
  opaqueAliases.set(prefix, aliases)
  const existing = aliases.get(normalized)
  if (existing) return existing
  const alias = `${prefix}-${String(aliases.size + 1).padStart(4, '0')}`
  aliases.set(normalized, alias)
  return alias
}

function normalizedHost(value: string): string {
  return value.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '')
}

function sanitizeDomain(rawDomain: string): string {
  const domain = normalizedHost(rawDomain)
  if (!domain) return 'unknown.example'
  if (domain === 'localhost' || PRIVATE_IP.test(domain) || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(domain)) {
    PRIVATE_IP.lastIndex = 0
    return 'private-network.example'
  }
  PRIVATE_IP.lastIndex = 0
  if (domain.endsWith('.slack.com') && domain !== 'slack.com') return 'workspace.example'
  if (SENSITIVE_ACCOUNT_DOMAIN.test(domain)) return 'account.example'
  if (PUBLIC_BEHAVIOR_DOMAINS.has(domain)) return domain
  const publicParent = [...PUBLIC_BEHAVIOR_DOMAINS].find((candidate) => domain.endsWith(`.${candidate}`))
  if (publicParent) return publicParent
  return `${opaqueAlias('site', domain)}.example`
}

function sanitizeInlineSecrets(value: string): string {
  return value
    .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(FOUNDER_IDENTIFIERS, '[founder]')
    .replace(LOCAL_PATH, '[local-path]')
    .replace(PRIVATE_IP, '192.0.2.1')
    .replace(/\s+/g, ' ')
    .trim()
}

function sanitizeTitle(value: string | null | undefined, rawDomain?: string): string | null {
  const text = sanitizeInlineSecrets(value ?? '')
  if (!text) return null

  const safeDomain = sanitizeDomain(rawDomain ?? '')
  if (safeDomain === 'account.example' || safeDomain === 'workspace.example' || SENSITIVE_TITLE.test(text)) {
    return `[redacted page on ${safeDomain}]`
  }

  const withoutUrls = text.replace(/https?:\/\/[^\s"')]+/gi, (rawUrl) => {
    try {
      return `https://${sanitizeDomain(new URL(rawUrl).hostname)}/fixture`
    } catch {
      return '[redacted url]'
    }
  })
  const behaviorTerms = SAFE_TITLE_TERMS.filter((term) => (
    withoutUrls.toLowerCase().includes(term.toLowerCase())
  ))
  if (behaviorTerms.length > 0) {
    return [...new Set(behaviorTerms)].join(' + ')
  }
  return `[redacted page on ${safeDomain}]`
}

function sanitizeAppName(rawName: string): string {
  const value = sanitizeInlineSecrets(rawName)
  if (!value || value.includes('[founder]') || value.includes('[local-path]')) {
    return 'Fixture App'
  }
  return value.slice(0, 80)
}

function bundleIdForApp(rawBundleId: string, rawAppName: string): string {
  const appName = rawAppName.toLowerCase()
  const bundleId = rawBundleId.toLowerCase()
  if (appName === 'dia' || bundleId.includes('thebrowser.dia') || bundleId.includes('/dia.app/')) {
    return 'company.thebrowser.dia'
  }
  if (appName === 'safari' || bundleId.includes('com.apple.safari') || bundleId.includes('/safari.app/')) {
    return 'com.apple.Safari'
  }
  if (appName === 'comet' || bundleId.includes('perplexity.comet') || bundleId.includes('/comet.app/')) {
    return 'ai.perplexity.comet'
  }
  if (appName === 'cursor' || bundleId.includes('/cursor.app/')) return 'cursor'
  if (appName === 'electron' || bundleId.includes('/electron.app/')) return 'com.github.electron'
  if (appName === 'loginwindow' || bundleId.includes('loginwindow')) return 'com.apple.loginwindow'
  return `fixture.identity.${opaqueAlias('id', rawBundleId)}`
}

function browserBundleId(rawBundleId: string | null): string | null {
  if (!rawBundleId) return null
  const lower = rawBundleId.toLowerCase()
  if (lower.includes('dia')) return 'company.thebrowser.dia'
  if (lower.includes('safari')) return 'com.apple.Safari'
  if (lower.includes('chrome')) return 'com.google.Chrome'
  if (lower.includes('firefox')) return 'org.mozilla.firefox'
  if (lower.includes('edge')) return 'com.microsoft.edgemac'
  if (lower.includes('comet')) return 'ai.perplexity.comet'
  return `fixture.identity.${opaqueAlias('id', rawBundleId)}`
}

function canonicalBrowserId(rawCanonicalId: string | null, rawBundleId: string | null): string | null {
  const lower = `${rawCanonicalId ?? ''} ${rawBundleId ?? ''}`.toLowerCase()
  if (lower.includes('dia')) return 'dia'
  if (lower.includes('safari')) return 'safari'
  if (lower.includes('chrome')) return 'chrome'
  if (lower.includes('firefox')) return 'firefox'
  if (lower.includes('edge')) return 'edge'
  if (lower.includes('comet')) return 'comet'
  if (rawBundleId) return browserBundleId(rawBundleId)
  return rawCanonicalId ? `fixture.identity.${opaqueAlias('id', rawCanonicalId)}` : null
}

function fixtureUrl(domain: string, sourcePageIdentity: string): string {
  return `https://${domain}/daylens-fixture/${opaqueAlias('page', sourcePageIdentity)}`
}

function sourcePageIdentity(visit: SourceVisit): string {
  const pageIdentity = visit.page_key?.trim()
    || visit.normalized_url?.trim()
    || visit.url?.trim()
    || visit.page_title?.trim()
    || 'unknown-page'
  return `${normalizedHost(visit.domain)}\u0000${pageIdentity}`
}

function assertSanitizedFixture(serialized: string): void {
  const forbidden: Array<[string, RegExp]> = [
    ['founder identity', /\b(?:christian\s+tonny|irachrist1|tonny)\b/i],
    ['email address', /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i],
    ['local user path', /(?:\/Users\/|[A-Za-z]:\\Users\\)/i],
    ['private IP address', /\b(?:10|127|192\.168|172\.(?:1[6-9]|2\d|3[01]))(?:\.\d{1,3}){2,3}\b/i],
    ['private Slack workspace', /[a-z0-9-]+\.slack\.com/i],
    ['raw account or mail host', /"(?:domain|url)":\s*"[^"]*(?:accounts?|auth|calendar|login|mail|outlook|passwords)\.(?!example\b)/i],
  ]
  const violations = forbidden.filter(([, pattern]) => pattern.test(serialized)).map(([label]) => label)
  if (violations.length > 0) {
    throw new Error(`Founder fixture sanitization failed: ${violations.join(', ')}`)
  }
}

const truth = JSON.parse(fs.readFileSync(TRUTH_PATH, 'utf8')) as FounderTruth
if (
  truth.fixtureId !== 'founder-real-jun16-week'
  || truth.day.date !== FOUNDER_DAY
  || truth.week.startDate !== WEEK_START
  || truth.week.endDate !== WEEK_END
) {
  throw new Error(`Founder truth file does not match the configured fixture window: ${TRUTH_PATH}`)
}

const db = new Database(SOURCE_DB, { readonly: true })

try {
  const fromMs = localDateMs(WEEK_START)
  const toMs = Math.min(
    localDateMs(shiftDateString(WEEK_END, 1)),
    localDateTimeMs(truth.week.capturedThrough),
  )
  const rawSessions = db.prepare(`
    SELECT
      id,
      bundle_id,
      app_name,
      start_time,
      end_time,
      duration_sec,
      category,
      window_title
    FROM app_sessions
    WHERE start_time < ?
      AND COALESCE(end_time, start_time + duration_sec * 1000) > ?
      AND duration_sec > 0
    ORDER BY start_time, id
  `).all(toMs, fromMs) as SourceSession[]
  const sessions = rawSessions
    .flatMap((session) => splitSessionByDay(session, fromMs, toMs))
    .sort((left, right) => left.start_time - right.start_time || left.id - right.id)

  const visits = db.prepare(`
    SELECT
      domain,
      page_title,
      url,
      normalized_url,
      page_key,
      visit_time,
      duration_sec,
      browser_bundle_id,
      canonical_browser_id
    FROM website_visits
    WHERE visit_time >= ? AND visit_time < ? AND duration_sec > 0
    ORDER BY visit_time, id
  `).all(fromMs, toMs) as SourceVisit[]

  const fixture = {
    id: truth.fixtureId,
    name: 'Founder real Jun 16 + current week',
    date: FOUNDER_DAY,
    description: 'Sanitized real founder day/week export for the Phase 0 truth baseline. Timing, duration, category, and behavior-relevant public app/site identity are retained; personal content, paths, accounts, private hosts, and unrelated page titles are pseudonymized.',
    expectedToFailOnCurrentMain: true,
    phase0Checks: ['dogfood', 'segmentation', 'duration', 'kind-tag', 'apps', 'week-consistency'],
    truthSources: [truth.day.source, truth.week.source],
    sessions: sessions.map((session) => {
      const startDate = localDateString(session.start_time)
      const sessionEnd = sourceSessionEnd(session)
      const endTime = localDateString(sessionEnd) === startDate ? sessionEnd : sessionEnd - 1000
      return {
        date: startDate === FOUNDER_DAY ? undefined : startDate,
        start: clock(session.start_time),
        end: clock(endTime),
        bundleId: bundleIdForApp(session.bundle_id, session.app_name),
        appName: sanitizeAppName(session.app_name),
        category: session.category,
        title: sanitizeTitle(session.window_title),
      }
    }),
    browserEvidence: visits.map((visit) => {
      const visitDate = localDateString(visit.visit_time)
      const domain = sanitizeDomain(visit.domain)
      return {
        date: visitDate === FOUNDER_DAY ? undefined : visitDate,
        at: clock(visit.visit_time),
        durationSeconds: visit.duration_sec,
        browserBundleId: browserBundleId(visit.browser_bundle_id),
        canonicalBrowserId: canonicalBrowserId(visit.canonical_browser_id, visit.browser_bundle_id),
        domain,
        url: fixtureUrl(domain, sourcePageIdentity(visit)),
        title: sanitizeTitle(visit.page_title, visit.domain),
      }
    }),
    expectedEpisodes: [
      {
        id: 'morning-network-setup',
        start: '08:03:00',
        end: '10:07:00',
        label: 'Starlink setup and testing',
        labelIncludes: ['Starlink', 'Building', 'Testing'],
        kind: 'work',
        intentRole: 'execution',
        intentSubjectIncludes: ['Starlink', 'network', 'testing'],
      },
      {
        id: 'midday-machine-learning-pipeline',
        start: '11:10:00',
        end: '13:11:00',
        label: 'Machine learning pipeline class',
        labelIncludes: ['Machine Learning Pipeline', 'Meet'],
        kind: 'work',
        intentRole: 'coordination',
        intentSubjectIncludes: ['Machine Learning Pipeline', 'Meet'],
      },
      {
        id: 'afternoon-starlink-debugging',
        start: '14:55:00',
        end: '16:47:00',
        label: 'Starlink and NextDNS debugging',
        labelIncludes: ['Starlink', 'NextDNS'],
        kind: 'work',
        intentRole: 'execution',
        intentSubjectIncludes: ['Starlink', 'NextDNS'],
      },
      {
        id: 'evening-watching',
        start: '18:36:00',
        end: '20:54:00',
        label: 'Watching Netflix and YouTube',
        labelIncludes: ['Watching', 'Netflix', 'YouTube'],
        kind: 'leisure',
      },
    ],
    expectedDay: {
      trackedMinutes: truth.day.trackedMinutes,
      toleranceMinutes: truth.day.toleranceMinutes,
      maxBlockCount: 8,
      minMaterialBlockMinutes: 5,
      forbiddenTopApps: ['loginwindow'],
      forbiddenLabels: ['Untitled block'],
      forbiddenMatteredIncludes: ['Netflix', 'YouTube', 'X'],
      forbiddenCarryoverIncludes: ['Netflix', 'YouTube', 'X'],
    },
    expectedWeek: {
      startDate: truth.week.startDate,
      endDate: truth.week.endDate,
      trackedMinutes: truth.week.trackedMinutes,
      toleranceMinutes: truth.week.toleranceMinutes,
      forbiddenTopApps: ['loginwindow'],
    },
  }

  const serialized = `${JSON.stringify(fixture, null, 2)}\n`
  assertSanitizedFixture(serialized)
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true })
  fs.writeFileSync(OUTPUT_PATH, serialized)
  console.log(`Wrote ${OUTPUT_PATH}`)
  console.log(`Sessions: ${sessions.length} (${rawSessions.length} source); visits: ${visits.length}`)
  console.log(`Truth targets: ${truth.day.trackedMinutes}m day; ${truth.week.trackedMinutes}m week`)
} finally {
  db.close()
}
