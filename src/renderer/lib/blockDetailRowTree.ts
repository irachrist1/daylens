// Block detail row tree — the nesting logic behind the "What you were in"
// panel (BlockDetailInspector), pulled out so it can be unit-tested without
// a DOM harness (Pure, no React — same pattern as dayWrapScenes.ts).
//
// A site or page visited inside a browser, or a file/document opened inside
// an app, is a breakdown of that owning app's tracked time, never additional
// time on top of it (docs/findings.md, "app time and site time
// double-counted"). This module turns a block's flat evidence arrays
// (topApps, topArtifacts, websites) into a tree: children nest under the app
// row they happened in, everything else stays a top-level sibling.

import type { ArtifactRef, AppCategory, PageRef, WebsiteSummary, WorkContextAppSummary, WorkContextBlock } from '@shared/types'
import { kindForDomain } from '@shared/workKind'

export type DetailRowKind = 'app' | 'artifact' | 'site'

export interface DetailRowNode {
  key: string
  kind: DetailRowKind
  seconds: number
  offTask: boolean
  // The app row this node happens inside, when one of the block's own top
  // apps owns it. Undefined means "top-level" — either a genuine sibling
  // app, or a site/artifact whose owner isn't in the block's top apps.
  ownerKey?: string
  children: DetailRowNode[]
  // Raw source object the renderer needs to build name/detail/icon/onOpen.
  // Exactly one of these is set, matching `kind`.
  app?: WorkContextAppSummary
  artifact?: ArtifactRef
  site?: WebsiteSummary
}

export interface DetailRowTree {
  // Nested, on-task rows: app rows (each with its children already attached)
  // plus any on-task orphan site/artifact rows, sorted by seconds desc.
  evidence: DetailRowNode[]
  // Off-task ("detour") rows, flat, sorted by seconds desc.
  detours: DetailRowNode[]
  detourSeconds: number
}

const isOffTaskCategory = (category: AppCategory): boolean =>
  category === 'entertainment' || category === 'social'

export function buildDetailRowTree(block: WorkContextBlock): DetailRowTree {
  // Rows carry two possible owner-linkage pairings, because ArtifactRef has
  // two parallel schemes: app-owned artifacts (files/windows) use
  // ownerBundleId/canonicalAppId, while browser-owned pages (PageRef) use
  // browserBundleId/canonicalBrowserId. A PageRef whose ownerBundleId/
  // canonicalAppId weren't populated (e.g. an older/incomplete producer)
  // still nests correctly as long as its browser fields are present.
  const ownerKeyFor = (
    bundleId?: string | null,
    canonicalId?: string | null,
    fallbackBundleId?: string | null,
    fallbackCanonicalId?: string | null,
  ): string | undefined => {
    const owner = block.topApps.slice(0, 8).find((app) =>
      (bundleId != null && app.bundleId === bundleId)
      || (canonicalId != null && app.canonicalAppId === canonicalId)
      || (fallbackBundleId != null && app.bundleId === fallbackBundleId)
      || (fallbackCanonicalId != null && app.canonicalAppId === fallbackCanonicalId))
    return owner ? `app:${owner.bundleId}` : undefined
  }

  const appRows: DetailRowNode[] = block.topApps.slice(0, 8).map((app) => ({
    key: `app:${app.bundleId}`,
    kind: 'app',
    seconds: app.totalSeconds,
    offTask: isOffTaskCategory(app.category),
    children: [],
    app,
  }))

  const artifactRows: DetailRowNode[] = block.topArtifacts.slice(0, 8).map((artifact) => {
    const pageRef = artifact as PageRef
    return {
      key: `art:${artifact.id}`,
      kind: 'artifact',
      seconds: artifact.totalSeconds,
      offTask: kindForDomain(artifact.host) === 'leisure',
      children: [],
      artifact,
      ownerKey: ownerKeyFor(
        artifact.ownerBundleId,
        artifact.canonicalAppId,
        pageRef.browserBundleId,
        pageRef.canonicalBrowserId,
      ),
    }
  })

  // Sites already represented by an artifact row are not repeated.
  const artifactHosts = new Set(block.topArtifacts.map((a) => a.host?.toLowerCase()).filter(Boolean) as string[])
  const siteRows: DetailRowNode[] = block.websites
    .filter((site) => !artifactHosts.has(site.domain.toLowerCase()))
    .slice(0, 8)
    .map((site) => ({
      key: `site:${site.domain}`,
      kind: 'site',
      seconds: site.totalSeconds,
      offTask: kindForDomain(site.domain) === 'leisure',
      children: [],
      site,
      ownerKey: ownerKeyFor(site.browserBundleId, site.canonicalBrowserId),
    }))

  // Nest each on-task site/page/file under the app it happened in; rows whose
  // app isn't listed stay top-level. Off-task rows keep flowing to detours.
  const childRows = [...artifactRows, ...siteRows].filter((row) => !row.offTask && row.ownerKey)
  const nested = appRows.map((app) => ({
    ...app,
    children: childRows.filter((row) => row.ownerKey === app.key).sort((a, b) => b.seconds - a.seconds),
  }))
  const orphanRows = [...artifactRows, ...siteRows].filter((row) => !row.offTask && !row.ownerKey)
  const allEvidence = [...nested, ...orphanRows].sort((a, b) => b.seconds - a.seconds)
  const evidence = allEvidence.filter((row) => !row.offTask)

  // "Detours": where active time went elsewhere inside this block — the
  // leisure sites and apps the user was actually in. Idle/away time is never
  // a detour; it renders as blank space on the grid instead.
  const detours = [
    ...allEvidence.filter((row) => row.offTask),
    ...[...artifactRows, ...siteRows].filter((row) => row.offTask),
  ].sort((a, b) => b.seconds - a.seconds)
  const detourSeconds = detours.reduce((sum, row) => sum + row.seconds, 0)

  return { evidence, detours, detourSeconds }
}
