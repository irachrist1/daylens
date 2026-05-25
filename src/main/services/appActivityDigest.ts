import type {
  AppActivityDigest,
  ArtifactRef,
  PageRef,
  WorkContextBlock,
  WorkContextAppSummary,
} from '@shared/types'
import { resolveCanonicalApp as defaultResolveCanonicalApp } from '../lib/appIdentity'
import { userVisibleBlockLabel } from '@shared/blockLabel'
import { isHostBlockedForAppsRail } from '@shared/domainPolicy'

type ResolveCanonicalApp = (bundleId: string, appName: string) => { canonicalAppId: string | null }

interface Bucket {
  canonicalAppId: string
  bundleId: string
  appName: string
  topBlock: { label: string; seconds: number } | null
  topArtifact: { title: string; seconds: number } | null
}

function resolveAppCanonicalId(
  app: Pick<WorkContextAppSummary, 'bundleId' | 'appName'>,
  resolve: ResolveCanonicalApp,
): string | null {
  if (!app.bundleId) return null
  const identity = resolve(app.bundleId, app.appName)
  return identity.canonicalAppId ?? app.bundleId
}

function pageOwnerCanonicalId(page: PageRef, resolve: ResolveCanonicalApp): string | null {
  if (page.canonicalAppId) return page.canonicalAppId
  if (page.canonicalBrowserId) return page.canonicalBrowserId
  if (page.browserBundleId) {
    const identity = resolve(page.browserBundleId, page.browserBundleId)
    return identity.canonicalAppId ?? page.browserBundleId
  }
  return null
}

// Pages stored as ArtifactRef (artifactType === 'page') should still be
// owned by their browser. The PageRef-specific fields may be present.
function artifactOwnerCanonicalId(
  artifact: ArtifactRef,
  resolve: ResolveCanonicalApp,
): string | null {
  if (artifact.canonicalAppId) return artifact.canonicalAppId
  if (artifact.ownerBundleId) {
    const ownerName = artifact.ownerAppName ?? artifact.ownerBundleId
    const identity = resolve(artifact.ownerBundleId, ownerName)
    return identity.canonicalAppId ?? artifact.ownerBundleId
  }
  if (artifact.artifactType === 'page') {
    return pageOwnerCanonicalId(artifact as PageRef, resolve)
  }
  return null
}

// True when the persisted block label appears to have come from a
// host-blocklisted artifact. We check both pageRefs and topArtifacts of
// the block: if any of them sits on a blocked host AND its title matches
// the persisted label, the label was sourced from that artifact and is
// not safe to propagate. This guards against legacy bad labels that the
// backfill migration hasn't cleared yet.
function labelLooksHostBlocked(block: WorkContextBlock, label: string): boolean {
  const normalizedLabel = label.toLowerCase()
  const candidates: Array<{ host: string | null | undefined; title: string | null | undefined }> = []
  for (const page of block.pageRefs) {
    candidates.push({ host: page.domain ?? page.host, title: page.displayTitle })
    candidates.push({ host: page.domain ?? page.host, title: page.pageTitle ?? null })
  }
  for (const artifact of block.topArtifacts) {
    candidates.push({ host: artifact.host, title: artifact.displayTitle })
  }
  for (const c of candidates) {
    if (!c.title || !c.host) continue
    if (!isHostBlockedForAppsRail(c.host)) continue
    if (c.title.toLowerCase() === normalizedLabel) return true
  }
  return false
}

export function computeAppActivityDigest(
  blocks: WorkContextBlock[],
  resolve: ResolveCanonicalApp = defaultResolveCanonicalApp,
): AppActivityDigest[] {
  const buckets = new Map<string, Bucket>()

  for (const block of blocks) {
    const blockSeconds = Math.max(0, Math.round((block.endTime - block.startTime) / 1000))
    if (blockSeconds < 60) continue

    const sanitizedLabel = userVisibleBlockLabel(block)
    let blockLabel = sanitizedLabel === 'Untitled block' ? '' : sanitizedLabel.trim()
    // Legacy labels persisted before the domain policy may still carry a
    // blocked-host title. Suppress so they don't propagate to every app.
    if (blockLabel && labelLooksHostBlocked(block, blockLabel)) blockLabel = ''

    const appCanonicalIds = new Map<string, { bundleId: string; appName: string; canonicalAppId: string }>()
    for (const app of block.topApps) {
      const canonicalAppId = resolveAppCanonicalId(app, resolve)
      if (!canonicalAppId) continue
      if (!appCanonicalIds.has(canonicalAppId)) {
        appCanonicalIds.set(canonicalAppId, { bundleId: app.bundleId, appName: app.appName, canonicalAppId })
      }
    }
    if (appCanonicalIds.size === 0) continue

    for (const { bundleId, appName, canonicalAppId } of appCanonicalIds.values()) {
      const bucket = buckets.get(canonicalAppId) ?? {
        canonicalAppId,
        bundleId,
        appName,
        topBlock: null,
        topArtifact: null,
      }

      // Block label belongs to the block as a whole — every app participating
      // in the block is part of the labeled work — so it can attach to all
      // co-occurring apps.
      if (blockLabel && (!bucket.topBlock || blockSeconds > bucket.topBlock.seconds)) {
        bucket.topBlock = { label: blockLabel, seconds: blockSeconds }
      }

      for (const artifact of block.topArtifacts) {
        // Domain policy: adult/social-feed/entertainment hosts never head
        // the Apps view. Adult is already filtered at buildPageCandidates,
        // but persisted artifacts predating the policy can still appear
        // here, so we defend a second time.
        if (isHostBlockedForAppsRail(artifact.host)) continue

        const ownerId = artifactOwnerCanonicalId(artifact, resolve)
        // Pages always belong to a browser. If we can't resolve the owning
        // browser (legacy rows with null canonicalAppId AND null
        // canonicalBrowserId AND null browserBundleId), drop the artifact —
        // never fall back to "only app in the block," because that path is
        // exactly how YouTube/Perplexity ended up labeling VS Code and
        // Ghostty rows in the Apps tab.
        const isPageArtifact = artifact.artifactType === 'page'
        const owned = ownerId !== null
          ? ownerId === canonicalAppId
          : (isPageArtifact ? false : appCanonicalIds.size === 1)
        if (!owned) continue

        const title = artifact.displayTitle?.trim()
        if (!title) continue
        if (!bucket.topArtifact || artifact.totalSeconds > bucket.topArtifact.seconds) {
          bucket.topArtifact = { title, seconds: artifact.totalSeconds }
        }
      }

      for (const page of block.pageRefs) {
        if (isHostBlockedForAppsRail(page.domain ?? page.host ?? null)) continue
        const ownerId = pageOwnerCanonicalId(page, resolve)
        // Pages without a resolvable browser owner cannot be safely attributed
        // to a non-browser app; drop them rather than smearing across topApps.
        if (ownerId === null || ownerId !== canonicalAppId) continue

        const title = (page.pageTitle ?? page.displayTitle)?.trim()
        if (!title) continue
        if (!bucket.topArtifact || page.totalSeconds > bucket.topArtifact.seconds) {
          bucket.topArtifact = { title, seconds: page.totalSeconds }
        }
      }

      buckets.set(canonicalAppId, bucket)
    }
  }

  return Array.from(buckets.values()).map((bucket) => ({
    canonicalAppId: bucket.canonicalAppId,
    bundleId: bucket.bundleId,
    appName: bucket.appName,
    topBlockLabel: bucket.topBlock?.label ?? null,
    topArtifactTitle: bucket.topArtifact?.title ?? null,
  }))
}
