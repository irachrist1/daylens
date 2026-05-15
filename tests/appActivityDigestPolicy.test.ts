// Defense-in-depth tests for the App activity digest. Even if a corrupted
// block label slipped through the labeler (e.g. legacy persisted row
// pre-domain-policy, or a future regression), the digest must NOT propagate
// the bad label to every co-occurring app's headline.

import test from 'node:test'
import assert from 'node:assert/strict'
import type { PageRef, WorkContextBlock } from '../src/shared/types.ts'
import { computeAppActivityDigest } from '../src/main/services/appActivityDigest.ts'

function makeBlock(overrides: Partial<WorkContextBlock> = {}): WorkContextBlock {
  return {
    id: 'b1',
    startTime: 0,
    endTime: 60 * 60_000,
    dominantCategory: 'development',
    categoryDistribution: { development: 1 },
    ruleBasedLabel: 'Development',
    aiLabel: null,
    sessions: [],
    topApps: [],
    websites: [],
    keyPages: [],
    pageRefs: [],
    documentRefs: [],
    topArtifacts: [],
    workflowRefs: [],
    label: {
      current: 'Development',
      source: 'rule',
      confidence: 0.5,
      narrative: null,
      ruleBased: 'Development',
      aiSuggested: null,
      override: null,
    },
    focusOverlap: { focusedSeconds: 0, totalSeconds: 0, focusRatio: 0 },
    evidenceSummary: {
      headline: '', detail: '', categoryCounts: {},
      appCount: 0, websiteCount: 0, documentCount: 0, pageCount: 0,
    },
    heuristicVersion: 'test',
    computedAt: 0,
    switchCount: 0,
    confidence: { score: 0.5, reasons: [] },
    isLive: false,
    ...overrides,
  } as WorkContextBlock
}

const resolve = (bundleId: string): { canonicalAppId: string | null } => {
  if (bundleId === 'com.microsoft.VSCode') return { canonicalAppId: 'vscode' }
  if (bundleId === 'company.thebrowser.dia') return { canonicalAppId: 'dia' }
  if (bundleId === 'com.apple.Safari') return { canonicalAppId: 'safari' }
  return { canonicalAppId: null }
}

test('legacy block label sourced from an adult-host page does not propagate to any app', () => {
  // Simulates a persisted row from before the domain policy shipped:
  // label.current matches a pornhub page artifact title that co-occurred
  // in this block. The digest must refuse to attach that label to the
  // co-occurring VS Code app even though it nominally belongs to the block.
  const pornPage: PageRef = {
    id: 'page-porn',
    artifactType: 'page',
    displayTitle: 'Cutie Brunette Some Title - Pornhub.com',
    pageTitle: 'Cutie Brunette Some Title - Pornhub.com',
    domain: 'pornhub.com',
    host: 'pornhub.com',
    totalSeconds: 90,
    confidence: 0.5,
    canonicalBrowserId: 'dia',
    browserBundleId: 'company.thebrowser.dia',
    openTarget: { kind: 'external_url', value: 'https://pornhub.com/' },
  } as PageRef

  const block = makeBlock({
    label: {
      current: 'Cutie Brunette Some Title - Pornhub.com',
      source: 'artifact',
      confidence: 0.88,
      narrative: null,
      ruleBased: 'Development',
      aiSuggested: null,
      override: null,
    },
    topApps: [
      { bundleId: 'com.microsoft.VSCode', appName: 'Code', category: 'development', totalSeconds: 3600, sessionCount: 1, isBrowser: false },
      { bundleId: 'company.thebrowser.dia', appName: 'Dia', category: 'browsing', totalSeconds: 90, sessionCount: 1, isBrowser: true },
    ],
    pageRefs: [pornPage],
    topArtifacts: [pornPage],
  })

  const digest = computeAppActivityDigest([block], resolve)
  const vscode = digest.find((row) => row.canonicalAppId === 'vscode')
  const dia = digest.find((row) => row.canonicalAppId === 'dia')

  assert.ok(vscode, 'vscode row should exist')
  // The contaminated label must be cleared by labelLooksHostBlocked.
  assert.equal(vscode!.topBlockLabel, null, 'adult-host-sourced label must not propagate to VS Code')
  assert.equal(vscode!.topArtifactTitle, null, 'VS Code must not get the porn page as its artifact either')

  // Dia row: the page IS owned by Dia, so it could in theory surface there,
  // but isHostBlockedForAppsRail keeps adult hosts out of the apps view entirely.
  assert.ok(dia, 'dia row should exist')
  assert.equal(dia!.topArtifactTitle, null, 'adult host page must not headline Dia in the apps rail')
})

test('social-feed page does not headline a co-occurring non-browser app', () => {
  // Twitter is not adult, but it's still suppressed from the apps rail
  // because the headline "Twitter / X" is low-signal noise on a dev row.
  const twitterPage: PageRef = {
    id: 'page-twitter',
    artifactType: 'page',
    displayTitle: 'Home / X',
    pageTitle: 'Home / X',
    domain: 'x.com',
    host: 'x.com',
    totalSeconds: 120,
    confidence: 0.5,
    canonicalBrowserId: 'dia',
    browserBundleId: 'company.thebrowser.dia',
    openTarget: { kind: 'external_url', value: 'https://x.com/' },
  } as PageRef

  const block = makeBlock({
    topApps: [
      { bundleId: 'com.microsoft.VSCode', appName: 'Code', category: 'development', totalSeconds: 3600, sessionCount: 1, isBrowser: false },
      { bundleId: 'company.thebrowser.dia', appName: 'Dia', category: 'browsing', totalSeconds: 120, sessionCount: 1, isBrowser: true },
    ],
    pageRefs: [twitterPage],
    topArtifacts: [twitterPage],
  })

  const digest = computeAppActivityDigest([block], resolve)
  const vscode = digest.find((row) => row.canonicalAppId === 'vscode')
  const dia = digest.find((row) => row.canonicalAppId === 'dia')
  assert.equal(vscode?.topArtifactTitle, null)
  assert.equal(dia?.topArtifactTitle, null, 'social_feed pages should not headline the apps rail')
})

test('work-relevant pages still attach to their owning browser', () => {
  const notionPage: PageRef = {
    id: 'page-notion',
    artifactType: 'page',
    displayTitle: 'Daylens v1 redesign',
    pageTitle: 'Daylens v1 redesign',
    domain: 'notion.so',
    host: 'notion.so',
    totalSeconds: 600,
    confidence: 0.9,
    canonicalBrowserId: 'safari',
    browserBundleId: 'com.apple.Safari',
    openTarget: { kind: 'external_url', value: 'https://notion.so/v1' },
  } as PageRef

  const block = makeBlock({
    dominantCategory: 'browsing',
    topApps: [
      { bundleId: 'com.apple.Safari', appName: 'Safari', category: 'browsing', totalSeconds: 600, sessionCount: 1, isBrowser: true },
    ],
    pageRefs: [notionPage],
    topArtifacts: [notionPage],
  })

  const digest = computeAppActivityDigest([block], resolve)
  const safari = digest.find((row) => row.canonicalAppId === 'safari')
  assert.equal(safari?.topArtifactTitle, 'Daylens v1 redesign')
})
