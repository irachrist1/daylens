import test from 'node:test'
import assert from 'node:assert/strict'
import type { ArtifactRef, PageRef, WorkContextBlock } from '../src/shared/types.ts'
import { computeAppActivityDigest } from '../src/main/services/appActivityDigest.ts'

function makeBlock(overrides: Partial<WorkContextBlock> = {}): WorkContextBlock {
  const base: WorkContextBlock = {
    id: 'b1',
    startTime: 0,
    endTime: 30 * 60_000,
    dominantCategory: 'research',
    categoryDistribution: { research: 1 },
    ruleBasedLabel: 'Researching Perplexity',
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
      current: 'Researching Perplexity',
      source: 'rule',
      confidence: 0.5,
      narrative: null,
      ruleBased: 'Researching Perplexity',
      aiSuggested: null,
      override: null,
    },
    focusOverlap: { focusedSeconds: 0, totalSeconds: 0, focusRatio: 0 },
    evidenceSummary: {
      headline: '',
      detail: '',
      categoryCounts: {},
      appCount: 0,
      websiteCount: 0,
      documentCount: 0,
      pageCount: 0,
    },
    heuristicVersion: 'test',
    computedAt: 0,
    switchCount: 0,
    confidence: { score: 0.5, reasons: [] },
    isLive: false,
    ...overrides,
  } as WorkContextBlock
  return base
}

const resolve = (bundleId: string, _appName: string): { canonicalAppId: string | null } => {
  switch (bundleId) {
    case 'com.apple.Safari':
      return { canonicalAppId: 'safari' }
    case 'company.thebrowser.dia':
      return { canonicalAppId: 'dia' }
    case 'com.microsoft.VSCode':
      return { canonicalAppId: 'vscode' }
    default:
      return { canonicalAppId: null }
  }
}

test('pages attributed only to the browsers that captured them', () => {
  const perplexityFromSafari: PageRef = {
    id: 'page-safari-perplexity',
    artifactType: 'page',
    displayTitle: 'Perplexity',
    pageTitle: 'Perplexity',
    domain: 'perplexity.ai',
    totalSeconds: 900,
    confidence: 0.9,
    canonicalBrowserId: 'safari',
    browserBundleId: 'com.apple.Safari',
    openTarget: { kind: 'external_url', value: 'https://perplexity.ai/' },
  } as PageRef

  const perplexityFromDia: PageRef = {
    ...perplexityFromSafari,
    id: 'page-dia-perplexity',
    canonicalBrowserId: 'dia',
    browserBundleId: 'company.thebrowser.dia',
    totalSeconds: 600,
  } as PageRef

  const block = makeBlock({
    topApps: [
      { bundleId: 'com.apple.Safari', appName: 'Safari', category: 'research', totalSeconds: 900, sessionCount: 1, isBrowser: true },
      { bundleId: 'company.thebrowser.dia', appName: 'Dia', category: 'research', totalSeconds: 600, sessionCount: 1, isBrowser: true },
      { bundleId: 'com.microsoft.VSCode', appName: 'Code', category: 'development', totalSeconds: 1200, sessionCount: 1, isBrowser: false },
    ],
    pageRefs: [perplexityFromSafari, perplexityFromDia],
  })

  const digest = computeAppActivityDigest([block], resolve)
  const byApp = new Map(digest.map((row) => [row.canonicalAppId, row]))

  assert.equal(byApp.get('safari')?.topArtifactTitle, 'Perplexity')
  assert.equal(byApp.get('dia')?.topArtifactTitle, 'Perplexity')
  assert.equal(byApp.get('vscode')?.topArtifactTitle, null)
})

test('artifacts attached to the canonical app that owns them, not co-occurring apps', () => {
  const intuneAdmin: ArtifactRef = {
    id: 'page-intune',
    artifactType: 'page',
    displayTitle: 'Microsoft Intune admin center',
    totalSeconds: 720,
    confidence: 0.8,
    canonicalAppId: 'safari',
    openTarget: { kind: 'external_url', value: 'https://intune.microsoft.com/' },
  } as ArtifactRef

  const vsCodeDoc: ArtifactRef = {
    id: 'doc-router',
    artifactType: 'document',
    displayTitle: 'insightsQueryRouter.ts',
    totalSeconds: 1100,
    confidence: 0.95,
    ownerBundleId: 'com.microsoft.VSCode',
    ownerAppName: 'Code',
    openTarget: { kind: 'local_path', value: '/src/main/insightsQueryRouter.ts' },
  } as ArtifactRef

  const block = makeBlock({
    topApps: [
      { bundleId: 'com.apple.Safari', appName: 'Safari', category: 'research', totalSeconds: 720, sessionCount: 1, isBrowser: true },
      { bundleId: 'com.microsoft.VSCode', appName: 'Code', category: 'development', totalSeconds: 1100, sessionCount: 1, isBrowser: false },
    ],
    topArtifacts: [intuneAdmin, vsCodeDoc],
  })

  const digest = computeAppActivityDigest([block], resolve)
  const byApp = new Map(digest.map((row) => [row.canonicalAppId, row]))

  assert.equal(byApp.get('safari')?.topArtifactTitle, 'Microsoft Intune admin center')
  assert.equal(byApp.get('vscode')?.topArtifactTitle, 'insightsQueryRouter.ts')
})

test('block label still attaches to all apps in the block', () => {
  const block = makeBlock({
    label: {
      current: 'Pipeline debugging',
      source: 'rule',
      confidence: 0.6,
      narrative: null,
      ruleBased: 'Pipeline debugging',
      aiSuggested: null,
      override: null,
    },
    ruleBasedLabel: 'Pipeline debugging',
    topApps: [
      { bundleId: 'com.apple.Safari', appName: 'Safari', category: 'research', totalSeconds: 300, sessionCount: 1, isBrowser: true },
      { bundleId: 'com.microsoft.VSCode', appName: 'Code', category: 'development', totalSeconds: 900, sessionCount: 1, isBrowser: false },
    ],
  })

  const digest = computeAppActivityDigest([block], resolve)
  const labels = digest.map((row) => [row.canonicalAppId, row.topBlockLabel])
  assert.deepEqual(
    new Map(labels as [string, string | null][]),
    new Map([
      ['safari', 'Pipeline debugging'],
      ['vscode', 'Pipeline debugging'],
    ]),
  )
})

// Regression for the live-DB symptom in V1-PHASE-6 screenshots: VS Code and
// Ghostty rows in the Apps tab were headlined "YouTube" because the digest
// fell back to "single app in block" attribution for page artifacts whose
// canonicalAppId / canonicalBrowserId / browserBundleId were all null
// (legacy rows). Pages must NEVER attach to a non-browser app — even when
// the block has only one app — because we cannot prove the app owned the page.
test('page artifacts with no browser owner do not leak onto a single non-browser app', () => {
  const orphanYouTubePage: ArtifactRef = {
    id: 'page-youtube-orphan',
    artifactType: 'page',
    displayTitle: 'YouTube',
    totalSeconds: 120,
    confidence: 0.5,
    // canonicalAppId, ownerBundleId, canonicalBrowserId, browserBundleId all unset.
    openTarget: { kind: 'external_url', value: 'https://youtube.com/' },
  } as ArtifactRef

  const block = makeBlock({
    topApps: [
      { bundleId: 'com.microsoft.VSCode', appName: 'Code', category: 'development', totalSeconds: 1200, sessionCount: 1, isBrowser: false },
    ],
    topArtifacts: [orphanYouTubePage],
  })

  const digest = computeAppActivityDigest([block], resolve)
  const vscode = digest.find((row) => row.canonicalAppId === 'vscode')
  assert.ok(vscode, 'vscode row should still exist')
  assert.equal(vscode!.topArtifactTitle, null, 'unowned page must not headline a non-browser app')
})
