// Daylens domain policy — a tiny allow/deny system for which web domains
// are eligible to label a block, surface as a "top artifact", or appear in
// the Apps view. Used by:
//   - workBlocks.buildPageCandidates (gates artifact creation at source)
//   - workBlocks.preferredArtifactLabel (gates label promotion)
//   - appActivityDigest (gates topArtifacts surfacing per app)
//
// The blocklist below is intentionally short and conservative. It is NOT
// a content filter for the user's protection — Daylens already records the
// visit in website_visits.url for the user's own reference. The blocklist's
// job is to keep these titles from being elevated to block headlines /
// app-row headlines, because that's how a porn page title ends up labeling
// a development block.
//
// Categories:
//   - 'adult': adult content; never label a block.
//   - 'social_feed': infinite-scroll feed pages whose titles ("Twitter / X",
//     "Instagram", "TikTok") add no signal; allowed inside their own
//     browser detail panel but not promoted as block labels.
//   - 'entertainment': long-form video sinks where the title is the *content*
//     ("Top 10 …"), not the work. Allowed in browser detail; never the block
//     label for a non-entertainment block.

export type DomainPolicyCategory = 'adult' | 'social_feed' | 'entertainment'

// Exact-match hosts (after stripping leading www.).
const HOST_RULES: Map<string, DomainPolicyCategory> = new Map([
  // Adult — non-exhaustive; covers the high-traffic sinks. We deliberately
  // skip exhaustive enumeration because (a) we don't need it, the wildcard
  // matchers below catch most cases, and (b) the list is shipped in source
  // and we don't want to bloat the bundle.
  ['pornhub.com', 'adult'],
  ['xvideos.com', 'adult'],
  ['xnxx.com', 'adult'],
  ['xhamster.com', 'adult'],
  ['redtube.com', 'adult'],
  ['youporn.com', 'adult'],
  ['spankbang.com', 'adult'],
  ['onlyfans.com', 'adult'],
  ['stripchat.com', 'adult'],
  ['chaturbate.com', 'adult'],
  ['eporner.com', 'adult'],
  ['tnaflix.com', 'adult'],
  ['brazzers.com', 'adult'],
  ['bangbros.com', 'adult'],
  ['realitykings.com', 'adult'],
  ['javhd.com', 'adult'],
  ['fapello.com', 'adult'],
  ['motherless.com', 'adult'],
  ['rule34.xxx', 'adult'],

  // Social feeds — only the bare-feed surface, not the app's productive
  // sub-surfaces (e.g. Slack workspaces live on slack.com but those are
  // legitimately a workstream; we don't gate them here, only the social
  // newsfeeds).
  ['twitter.com', 'social_feed'],
  ['x.com', 'social_feed'],
  ['instagram.com', 'social_feed'],
  ['tiktok.com', 'social_feed'],
  ['reddit.com', 'social_feed'],
  ['facebook.com', 'social_feed'],

  // Entertainment sinks where the page title is the content, not the work.
  ['youtube.com', 'entertainment'],
  ['youtu.be', 'entertainment'],
  ['music.youtube.com', 'entertainment'],
  ['netflix.com', 'entertainment'],
  ['twitch.tv', 'entertainment'],
  ['primevideo.com', 'entertainment'],
  ['hulu.com', 'entertainment'],
  ['disneyplus.com', 'entertainment'],
  ['max.com', 'entertainment'],
  ['spotify.com', 'entertainment'],
  ['soundcloud.com', 'entertainment'],
  ['vimeo.com', 'entertainment'],
])

// Suffix rules — any host ENDING in one of these strings hits the rule.
// Used for adult TLDs and known wildcard sinks.
const HOST_SUFFIX_RULES: Array<{ suffix: string; category: DomainPolicyCategory }> = [
  { suffix: '.xxx', category: 'adult' },
  { suffix: '.porn', category: 'adult' },
  { suffix: '.sex', category: 'adult' },
  { suffix: '.adult', category: 'adult' },
  // Wildcard subdomains of the major hosts above are picked up by the
  // .endsWith path in policyForHost; we don't need separate suffix entries.
]

// Substring rules — last-resort heuristic for obviously-adult hostnames
// that aren't in the explicit list. Conservative: must match a stem, not
// a substring of a longer word. We anchor on dots/dashes to avoid false
// positives on words like "essex".
const ADULT_STEM_PATTERNS: RegExp[] = [
  /(^|[.\-])porn([.\-]|$)/i,
  /(^|[.\-])xxx([.\-]|$)/i,
  /(^|[.\-])nsfw([.\-]|$)/i,
  /(^|[.\-])hentai([.\-]|$)/i,
]

function normalizeHost(host: string | null | undefined): string | null {
  if (!host) return null
  const trimmed = host.trim().toLowerCase()
  if (!trimmed) return null
  return trimmed.replace(/^www\./, '')
}

export function policyForHost(host: string | null | undefined): DomainPolicyCategory | null {
  const normalized = normalizeHost(host)
  if (!normalized) return null

  const exact = HOST_RULES.get(normalized)
  if (exact) return exact

  // endsWith covers subdomains of explicitly-listed hosts (e.g.
  // de.pornhub.com → ends with "pornhub.com").
  for (const [rule, category] of HOST_RULES) {
    if (normalized.endsWith(`.${rule}`)) return category
  }

  for (const { suffix, category } of HOST_SUFFIX_RULES) {
    if (normalized.endsWith(suffix)) return category
  }

  for (const pattern of ADULT_STEM_PATTERNS) {
    if (pattern.test(normalized)) return 'adult'
  }

  return null
}

export function isAdultHost(host: string | null | undefined): boolean {
  return policyForHost(host) === 'adult'
}

// True when this host should NEVER be promoted to a block label. Adult is
// the hard rule; the other categories are recommendation-only.
export function isHostBlockedForLabel(host: string | null | undefined): boolean {
  const policy = policyForHost(host)
  return policy === 'adult'
}

// True when this host should be suppressed from the Apps-view per-app
// "top artifacts" list — kept only inside the user's own private browser
// history detail. Adult is mandatory; social_feed and entertainment are
// also suppressed because they pollute the headline.
export function isHostBlockedForAppsRail(host: string | null | undefined): boolean {
  const policy = policyForHost(host)
  return policy === 'adult' || policy === 'social_feed' || policy === 'entertainment'
}

// True when a page artifact at this host should be filtered out entirely
// — never become an ArtifactRef in `topArtifacts`. Today this is adult
// only; we keep social/entertainment in the artifact pool so they still
// power browser-detail panels and the timeline.
export function isHostFilteredFromArtifacts(host: string | null | undefined): boolean {
  return policyForHost(host) === 'adult'
}
