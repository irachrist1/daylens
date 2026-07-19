import { containsCredential, findCredentialPattern } from '../credentialPatterns'

export type SyncAllowlistViolationClass =
  | 'schema'
  | 'extra_field'
  | 'credential'
  | 'path'
  | 'raw_url'
  | 'unrestricted_filename'
  | 'opaque_source_shape'
  | 'excluded_class'

export interface SyncAllowlistViolationDetail {
  class: SyncAllowlistViolationClass
  path: string
  detail: string
}

// Absolute / home / drive paths and nested filesystem-looking segments.
const PATH_LIKE_RE =
  /(?:[A-Za-z]:\\|\/Users\/|\/home\/|\/var\/|\/tmp\/|~\/|\\{2}|local-file:|\/[^/\s]+\/[^/\s]+)/i

const RAW_URL_RE = /\bhttps?:\/\/[^\s)\]'"<>]+/i

// Keys that must never appear on a sync object (raw evidence / indexes).
const FORBIDDEN_KEY_RE =
  /^(imageBase64|framePath|ocrText|transcript|audioPath|windowTitle|embedding|embeddingVector|rawUrl|visitCount)$/i

export function looksLikePath(value: string): boolean {
  return PATH_LIKE_RE.test(value)
}

export function looksLikeRawUrl(value: string): boolean {
  return RAW_URL_RE.test(value)
}

export function looksLikeUnrestrictedFilename(value: string): boolean {
  if (/^local-file:/i.test(value)) return true
  // Unrestricted filenames with extensions that look like local file evidence.
  return /(?:^|[/\\])[^/\\]+\.(md|txt|pdf|docx?|png|jpe?g|gif|mov|mp4|wav|m4a)$/i.test(value)
}

export function classifyHumanField(value: string, path: string): SyncAllowlistViolationDetail | null {
  if (!value) return null

  const credential = findCredentialPattern(value)
  if (credential) {
    return { class: 'credential', path, detail: `credential pattern ${credential}` }
  }
  if (looksLikeRawUrl(value)) {
    return { class: 'raw_url', path, detail: 'raw URL' }
  }
  if (looksLikePath(value)) {
    return { class: 'path', path, detail: 'path-like value' }
  }
  if (looksLikeUnrestrictedFilename(value)) {
    return { class: 'unrestricted_filename', path, detail: 'unrestricted filename' }
  }
  return null
}

export function classifyArtifactId(value: string, path: string): SyncAllowlistViolationDetail | null {
  if (!value) return null
  if (/^local-file:/i.test(value) || looksLikePath(value) || looksLikeRawUrl(value)) {
    return { class: 'path', path, detail: 'artifact id looks like a local path or URL' }
  }
  // IDs are not human prose; skip broad credential entropy patterns.
  if (containsCredential(value) && /(?:sk-|xox|gh[pousr]_|AKIA|ya29\.|eyJ)/.test(value)) {
    return { class: 'credential', path, detail: 'credential-shaped artifact id' }
  }
  return null
}

export function collectForbiddenKeys(
  value: unknown,
  path = '',
  out: SyncAllowlistViolationDetail[] = [],
): SyncAllowlistViolationDetail[] {
  if (value == null) return out
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenKeys(item, `${path}[${index}]`, out))
    return out
  }
  if (typeof value !== 'object') return out

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = path ? `${path}.${key}` : key
    if (FORBIDDEN_KEY_RE.test(key)) {
      out.push({
        class: 'excluded_class',
        path: childPath,
        detail: `forbidden key ${key}`,
      })
    }
    collectForbiddenKeys(child, childPath, out)
  }
  return out
}

type HumanFieldWalker = (value: string, path: string) => void

function walkRecapSummary(
  recap: {
    headline: string
    chapters: Array<{ eyebrow: string; title: string; body: string }>
    metrics: Array<{ label: string; value: string; detail: string }>
    changeSummary: string
    promptChips: string[]
  },
  base: string,
  visit: HumanFieldWalker,
) {
  visit(recap.headline, `${base}.headline`)
  visit(recap.changeSummary, `${base}.changeSummary`)
  recap.promptChips.forEach((chip, index) => visit(chip, `${base}.promptChips[${index}]`))
  recap.chapters.forEach((chapter, index) => {
    visit(chapter.eyebrow, `${base}.chapters[${index}].eyebrow`)
    visit(chapter.title, `${base}.chapters[${index}].title`)
    visit(chapter.body, `${base}.chapters[${index}].body`)
  })
  recap.metrics.forEach((metric, index) => {
    visit(metric.label, `${base}.metrics[${index}].label`)
    visit(metric.value, `${base}.metrics[${index}].value`)
    visit(metric.detail, `${base}.metrics[${index}].detail`)
  })
}

export function collectRemoteSyncValueViolations(payload: {
  daySummary: {
    recap: {
      day: Parameters<typeof walkRecapSummary>[0]
      week: Parameters<typeof walkRecapSummary>[0] | null
      month: Parameters<typeof walkRecapSummary>[0] | null
    }
    coverage: { coverageNote: string | null }
    topWorkstreams: Array<{ label: string }>
  }
  workBlocks: Array<{
    label: string
    topPages: Array<{ domain: string; label: string | null }>
    artifactIds: string[]
  }>
  entities: Array<{ label: string }>
  artifacts: Array<{ title: string }>
}): SyncAllowlistViolationDetail[] {
  const violations: SyncAllowlistViolationDetail[] = []
  const visitHuman: HumanFieldWalker = (value, path) => {
    const hit = classifyHumanField(value, path)
    if (hit) violations.push(hit)
  }

  walkRecapSummary(payload.daySummary.recap.day, 'daySummary.recap.day', visitHuman)
  if (payload.daySummary.recap.week) {
    walkRecapSummary(payload.daySummary.recap.week, 'daySummary.recap.week', visitHuman)
  }
  if (payload.daySummary.recap.month) {
    walkRecapSummary(payload.daySummary.recap.month, 'daySummary.recap.month', visitHuman)
  }
  if (payload.daySummary.coverage.coverageNote) {
    visitHuman(payload.daySummary.coverage.coverageNote, 'daySummary.coverage.coverageNote')
  }
  payload.daySummary.topWorkstreams.forEach((stream, index) => {
    visitHuman(stream.label, `daySummary.topWorkstreams[${index}].label`)
  })

  payload.workBlocks.forEach((block, index) => {
    visitHuman(block.label, `workBlocks[${index}].label`)
    block.topPages.forEach((page, pageIndex) => {
      // Domains are hostnames; still reject path/URL/credential-shaped values.
      const domainHit = classifyHumanField(page.domain, `workBlocks[${index}].topPages[${pageIndex}].domain`)
      if (domainHit) violations.push(domainHit)
      if (page.label != null) {
        visitHuman(page.label, `workBlocks[${index}].topPages[${pageIndex}].label`)
      }
    })
    block.artifactIds.forEach((id, idIndex) => {
      const hit = classifyArtifactId(id, `workBlocks[${index}].artifactIds[${idIndex}]`)
      if (hit) violations.push(hit)
    })
  })

  payload.entities.forEach((entity, index) => {
    visitHuman(entity.label, `entities[${index}].label`)
  })
  payload.artifacts.forEach((artifact, index) => {
    visitHuman(artifact.title, `artifacts[${index}].title`)
  })

  return violations
}

export function collectPresenceValueViolations(presence: {
  currentBlockLabel: string | null
}): SyncAllowlistViolationDetail[] {
  if (presence.currentBlockLabel == null) return []
  const hit = classifyHumanField(presence.currentBlockLabel, 'currentBlockLabel')
  return hit ? [hit] : []
}
