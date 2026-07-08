// ---------------------------------------------------------------------------
// The one humanizer for every user-facing title.
//
// Wave 1 leaked raw machine strings straight onto the surface: a notebook
// filename ("ResNet50_Malaria_Group3_Tonny_Colab.ipynb"), a raw video title
// ("I spent $200 to try Opus 4.8, was it worth it?"), a domain-derived label
// ("Free Movies"). Every title the user sees must pass through here first.
// ---------------------------------------------------------------------------

const DOMAIN_FRIENDLY_NAMES: Record<string, string> = {
  'youtube.com': 'YouTube',
  'youtu.be': 'YouTube',
  'music.youtube.com': 'YouTube Music',
  'netflix.com': 'Netflix',
  'twitch.tv': 'Twitch',
  'primevideo.com': 'Prime Video',
  'hulu.com': 'Hulu',
  'disneyplus.com': 'Disney+',
  'max.com': 'Max',
  'spotify.com': 'Spotify',
  'x.com': 'X',
  'twitter.com': 'X',
  'reddit.com': 'Reddit',
  'instagram.com': 'Instagram',
  'facebook.com': 'Facebook',
  'tiktok.com': 'TikTok',
  'linkedin.com': 'LinkedIn',
  'github.com': 'GitHub',
  'gitlab.com': 'GitLab',
  'docs.google.com': 'Google Docs',
  'sheets.google.com': 'Google Sheets',
  'colab.research.google.com': 'Google Colab',
  'mail.google.com': 'Gmail',
  'meet.google.com': 'Google Meet',
  'calendar.google.com': 'Google Calendar',
  'drive.google.com': 'Google Drive',
  'notion.so': 'Notion',
  'linear.app': 'Linear',
  'figma.com': 'Figma',
  'claude.ai': 'Claude',
  'chatgpt.com': 'ChatGPT',
  'chat.openai.com': 'ChatGPT',
  'stackoverflow.com': 'Stack Overflow',
  'posthog.com': 'PostHog',
  'whatsapp.com': 'WhatsApp',
  'openai.com': 'OpenAI',
  'localhost': 'Local dev server',
  '127.0.0.1': 'Local dev server',
}

// App-name suffixes that browsers/editors append to window titles.
const APP_SUFFIX_PATTERN = /\s*[—–-]\s*(google chrome|chrome|safari|firefox|microsoft edge|edge|arc|brave|opera|cursor|visual studio code|vs ?code|code|zsh|bash|warp|ghostty|iterm2?|terminal)\s*$/i

// Filename extensions and the friendly noun they map to (if any).
const EXTENSION_NOUNS: Record<string, string | null> = {
  ipynb: 'notebook',
  pdf: null,
  doc: null,
  docx: null,
  xls: null,
  xlsx: null,
  ppt: null,
  pptx: null,
}

// Tokens inside a filename that are noise — a person's name, a group number, a
// platform marker, a "copy/final" marker — and should be dropped from a title.
const FILENAME_NOISE = /^(group\d*|grp\d*|colab|copy|final|draft|v\d+|rev\d+|share[d]?|untitled)$/i

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeHost(host: string | null | undefined): string {
  return (host ?? '').trim().toLowerCase().replace(/^www\./, '')
}

// Leading subdomain labels that say WHERE a product is hosted, never WHAT it
// is. Without this, "app.intercom.com", "app.notion.com", and "app.weavy.ai"
// all collapse into one chart bar literally labeled "App" (the Jul 7 audit's
// "App" bar), and "us.posthog.com" becomes "Us".
const GENERIC_SUBDOMAIN_LABELS = new Set([
  'app', 'apps', 'web', 'my', 'm', 'mobile', 'us', 'eu', 'en', 'go', 'get',
  'portal', 'dashboard', 'console', 'admin', 'account', 'accounts', 'auth',
  'login', 'home', 'beta', 'staging', 'dev', 'api', 'secure', 'online', 'cloud',
])

// The friendly name for a domain ("youtube.com" → "YouTube"). Falls back to the
// capitalized first meaningful label ("alueducation.instructure.com" →
// "Alueducation", "app.intercom.com" → "Intercom").
export function friendlyDomain(host: string | null | undefined): string {
  const normalized = normalizeHost(host)
  if (!normalized) return ''
  if (DOMAIN_FRIENDLY_NAMES[normalized]) return DOMAIN_FRIENDLY_NAMES[normalized]
  const suffix = Object.keys(DOMAIN_FRIENDLY_NAMES).find((key) => normalized.endsWith(`.${key}`))
  if (suffix) return DOMAIN_FRIENDLY_NAMES[suffix]
  const labels = normalized.split('.').filter(Boolean)
  // Skip generic hosting labels, but never walk into the TLD: for
  // "app.intercom.com" the candidates are [app, intercom]; for a bare
  // "app.com" the stem stays "app" because nothing better exists.
  const candidates = labels.length > 1 ? labels.slice(0, -1) : labels
  const stem = candidates.find((label) => !GENERIC_SUBDOMAIN_LABELS.has(label))
    ?? candidates[candidates.length - 1]
    ?? normalized
  return stem ? `${stem[0].toUpperCase()}${stem.slice(1)}` : normalized
}

// A token is an acronym/identifier worth keeping verbatim (ResNet50, GPT4, API).
function looksLikeAcronymOrModel(token: string): boolean {
  return /[A-Z]/.test(token) && /[A-Z].*[a-z]|[A-Z].*\d|\d/.test(token) && token.length <= 12
    ? true
    : /^[A-Z]{2,6}\d*$/.test(token)
}

function humanizeFilename(name: string): string {
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  const base = dot > 0 && ext.length <= 5 ? name.slice(0, dot) : name
  const noun = Object.prototype.hasOwnProperty.call(EXTENSION_NOUNS, ext) ? EXTENSION_NOUNS[ext] : undefined

  const rawTokens = base.split(/[_\-\s]+/).filter(Boolean)
  // Filenames are usually `<content>_<metadata…>` — a group number, a person's
  // name, a platform marker, all bunched at the tail. The first noise token
  // marks where content ends, so truncate there ("ResNet50_Malaria_Group3_
  // Tonny_Colab" → "ResNet50 Malaria"). If the noise leads the name, just drop
  // the noise tokens individually instead of nuking everything.
  const firstNoiseIndex = rawTokens.findIndex((token) => FILENAME_NOISE.test(token))
  const meaningful = firstNoiseIndex > 0
    ? rawTokens.slice(0, firstNoiseIndex)
    : rawTokens.filter((token) => !FILENAME_NOISE.test(token))
  const words = (meaningful.length > 0 ? meaningful : rawTokens).map((token) =>
    looksLikeAcronymOrModel(token) ? token : token.toLowerCase(),
  )

  let title = compact(words.join(' '))
  if (noun && !new RegExp(`\\b${noun}\\b`, 'i').test(title)) {
    title = compact(`${title} ${noun}`)
  }
  // Capitalize the first letter if it is a plain word.
  if (title && /^[a-z]/.test(title)) title = title[0].toUpperCase() + title.slice(1)
  return title || name
}

// A "messy" filename is one a person should never read raw: a data/office file
// (notebook, PDF, spreadsheet) or any file whose name is underscore-mangled.
// Clean code paths ("src/renderer/views/Insights.tsx", "run.ts") are already
// developer-readable and pass through untouched.
function looksLikeMessyFilename(value: string): boolean {
  if (/\s/.test(value)) return false
  if (/\.(ipynb|pdf|docx?|xlsx?|pptx?|csv|key|numbers|pages)$/i.test(value)) return true
  if (/_/.test(value) && /\.[a-z0-9]{1,5}$/i.test(value)) return true
  return false
}

// The universal entry point: turn any raw title/label/subject into something a
// person should read. Strips app suffixes, humanizes filenames, maps domains.
export function humanizeTitle(raw: string | null | undefined): string | null {
  let value = compact(raw ?? '')
  if (!value) return null

  // Strip a trailing " — AppName" / " - Google Chrome" suffix (possibly twice:
  // "file - daylens - Cursor").
  let prev: string
  do {
    prev = value
    value = compact(value.replace(APP_SUFFIX_PATTERN, ''))
  } while (value !== prev && value.length > 0)

  if (!value) return null

  // A bare domain maps to its friendly name.
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(value)) {
    return friendlyDomain(value)
  }

  // The head segment of an editor title is usually the file ("run.ts — daylens").
  const head = value.split(/\s+[—–|]\s+/)[0]?.trim() || value
  if (looksLikeMessyFilename(head)) {
    return humanizeFilename(head)
  }
  if (looksLikeMessyFilename(value)) {
    return humanizeFilename(value)
  }

  return value
}

// Activity-shaped title for a leisure block, derived from the leisure domains it
// sat on. Never the raw page/video title presented as a subject.
//   ["youtube.com", "netflix.com"] → "Watching YouTube & Netflix"
//   ["x.com"]                       → "On X"
//   []                              → "Browsing"
export function leisureActivityTitle(domains: Array<string | null | undefined>): string {
  const WATCH = new Set(['YouTube', 'Netflix', 'Twitch', 'Prime Video', 'Hulu', 'Disney+', 'Max', 'YouTube Music', 'Vimeo'])
  const LISTEN = new Set(['Spotify', 'SoundCloud'])
  const friendly: string[] = []
  for (const domain of domains) {
    const name = friendlyDomain(domain)
    if (name && !friendly.includes(name)) friendly.push(name)
    if (friendly.length >= 2) break
  }
  if (friendly.length === 0) return 'Browsing'

  const joined = friendly.length === 2 ? `${friendly[0]} & ${friendly[1]}` : friendly[0]
  if (friendly.every((name) => WATCH.has(name))) return `Watching ${joined}`
  if (friendly.every((name) => LISTEN.has(name))) return `Listening on ${joined}`
  // Social / mixed.
  if (friendly.length === 1 && (friendly[0] === 'X' || friendly[0] === 'Reddit' || friendly[0] === 'Instagram' || friendly[0] === 'Facebook' || friendly[0] === 'LinkedIn' || friendly[0] === 'TikTok')) {
    return `On ${friendly[0]}`
  }
  if (WATCH.has(friendly[0])) return `Watching ${joined}`
  return `On ${joined}`
}
