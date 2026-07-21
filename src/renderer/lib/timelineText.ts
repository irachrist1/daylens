import type { AppCategory, WorkContextBlock } from '@shared/types'
import { sanitizeForModel } from '@shared/aiSanitize'
import { blockActiveSeconds } from '@shared/blockDuration'
import { isArtifactCompatibleWithBlockCategory, looksLikeRawArtifactLabel, naturalizeLabel } from '@shared/blockLabel'
import { activityCategoryLabel } from '@shared/activityCategories'
import { formatDisplayAppName } from './apps'
import { formatDuration } from './format'

const PAGE_ARTIFACT_LABEL_CATEGORIES: ReadonlySet<AppCategory> = new Set([
  'browsing', 'research', 'entertainment', 'social', 'aiTools',
])

function pageArtifactLabelAllowed(block: WorkContextBlock): boolean {
  if (PAGE_ARTIFACT_LABEL_CATEGORIES.has(block.dominantCategory)) return true
  const totalSeconds = block.topApps.reduce((sum, app) => sum + (app.totalSeconds ?? 0), 0)
  if (totalSeconds <= 0) return false
  const browserInTop2 = block.topApps.slice(0, 2).find((app) => app.isBrowser)
  return browserInTop2 ? (browserInTop2.totalSeconds ?? 0) / totalSeconds > 0.5 : false
}

export function safeTimelineText(text: string): string {
  return sanitizeForModel(text)
}

export function shortDomainLabel(domain: string): string {
  return domain.replace(/^www\./i, '')
}

function categoryVerbPhrase(category: WorkContextBlock['dominantCategory']): { verb: string; noun: string } {
  switch (category) {
    case 'development': return { verb: 'editing', noun: 'code' }
    case 'design': return { verb: 'working on', noun: 'design work' }
    case 'writing': return { verb: 'writing', noun: 'a draft' }
    case 'research': return { verb: 'researching', noun: 'reference material' }
    case 'aiTools': return { verb: 'working with', noun: 'AI tools' }
    case 'email': return { verb: 'checking', noun: 'email' }
    case 'communication': return { verb: 'in', noun: 'conversation' }
    case 'meetings': return { verb: 'in', noun: 'meetings' }
    case 'browsing': return { verb: 'reviewing', noun: 'web context' }
    case 'productivity': return { verb: 'working through', noun: 'tasks' }
    case 'entertainment': return { verb: 'watching', noun: 'video content' }
    case 'social': return { verb: 'on', noun: 'social' }
    case 'system': return { verb: 'on', noun: 'system tasks' }
    default: return { verb: 'on', noun: 'mixed work' }
  }
}

function artifactPhraseForCategory(
  artifactTitle: string,
  artifactType: string,
  category: WorkContextBlock['dominantCategory'],
): string {
  if (/^inbox(?:\s*\(\d+\))?$/i.test(artifactTitle)) return 'email'
  if (artifactType === 'page' && category === 'browsing') return `the ${artifactTitle} page`
  if (artifactType === 'page' && (category === 'research' || category === 'aiTools')) return artifactTitle
  return artifactTitle
}

/** Deterministic renderer fallback only. Persisted main-process narrative wins. */
export function blockShortSummary(block: WorkContextBlock): string {
  const duration = formatDuration(blockActiveSeconds(block))
  const allApps = block.topApps.filter((app) => app.category !== 'system' && app.category !== 'uncategorized')
  const sites = pageArtifactLabelAllowed(block)
    ? block.websites.slice(0, 2).map((site) => shortDomainLabel(site.domain))
    : []
  const topArtifact = block.topArtifacts.find((artifact) => (
    artifact.displayTitle.trim().length > 0
    && isArtifactCompatibleWithBlockCategory(artifact, block.dominantCategory)
  ))
  const rawArtifact = topArtifact ? safeTimelineText(topArtifact.displayTitle.trim()) : null
  const cleanArtifact = rawArtifact ? naturalizeLabel(rawArtifact) || rawArtifact : null
  const naturalizedArtifact = cleanArtifact && !looksLikeRawArtifactLabel(cleanArtifact) ? cleanArtifact : null

  const orderedApps = (() => {
    if (!topArtifact) return allApps
    if (topArtifact.artifactType === 'page') {
      const browsers = allApps.filter((app) => app.isBrowser)
      return browsers.length > 0 ? browsers : allApps
    }
    if (topArtifact.ownerBundleId) {
      const owners = allApps.filter((app) => app.bundleId === topArtifact.ownerBundleId)
      return owners.length > 0 ? owners : allApps
    }
    return allApps
  })()
  const appNames = orderedApps.slice(0, 2).map((app) => formatDisplayAppName(app.appName))
  const primaryApp = appNames[0] ?? null
  const secondaryApp = appNames[1] ?? null
  const { verb, noun } = categoryVerbPhrase(block.dominantCategory)
  const supportingClause = secondaryApp
    ? `, mostly in ${primaryApp} with ${secondaryApp} as supporting context`
    : primaryApp ? `, mostly in ${primaryApp}` : ''

  if (naturalizedArtifact) {
    return `Spent ${duration} ${verb} ${artifactPhraseForCategory(naturalizedArtifact, topArtifact!.artifactType, block.dominantCategory)}${supportingClause}.`
  }
  if (primaryApp && sites.length > 0) return `Spent ${duration} ${verb} ${noun} across ${sites.join(' and ')}${supportingClause}.`
  if (primaryApp) return `Spent ${duration} ${verb} ${noun}${supportingClause}.`
  if (sites.length > 0) return `Spent ${duration} ${verb} ${noun} across ${sites.join(' and ')}.`
  return `Spent ${duration} on ${activityCategoryLabel(block.dominantCategory).toLowerCase()}.`
}
