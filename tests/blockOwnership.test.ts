import test from 'node:test'
import assert from 'node:assert/strict'
import type { ArtifactRef, WorkContextBlock } from '../src/shared/types.ts'
import { userVisibleBlockLabel } from '../src/shared/blockLabel.ts'

function makeBlock(overrides: Partial<WorkContextBlock> = {}): WorkContextBlock {
  const base: WorkContextBlock = {
    id: 'b1',
    startTime: 0,
    endTime: 60_000,
    dominantCategory: 'development',
    categoryDistribution: { development: 1 },
    ruleBasedLabel: '',
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
      current: '',
      source: 'rule',
      confidence: 0.5,
      narrative: null,
      ruleBased: '',
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

function makeArtifact(overrides: Partial<ArtifactRef> & Pick<ArtifactRef, 'artifactType' | 'displayTitle'>): ArtifactRef {
  return {
    id: overrides.id ?? `art-${Math.random().toString(36).slice(2, 8)}`,
    displayTitle: overrides.displayTitle,
    artifactType: overrides.artifactType,
    totalSeconds: overrides.totalSeconds ?? 60,
    confidence: overrides.confidence ?? 0.6,
    openTarget: overrides.openTarget ?? { kind: 'none' as never },
    ...overrides,
  } as ArtifactRef
}

test('dev block with co-occurring YouTube tab does not take the YouTube title as its label', () => {
  // Kiro + Ghostty are top apps; Safari has a YouTube tab on the side.
  const youtubePage = makeArtifact({
    artifactType: 'page',
    displayTitle: 'How to build an Electron app in 2026 - YouTube',
    host: 'youtube.com',
  })
  const block = makeBlock({
    dominantCategory: 'development',
    categoryDistribution: { development: 0.85, entertainment: 0.15 },
    topApps: [
      { bundleId: 'com.kiro.kiro', appName: 'Kiro', category: 'development', totalSeconds: 1800, sessionCount: 4, isBrowser: false } as any,
      { bundleId: 'com.mitchellh.ghostty', appName: 'Ghostty', category: 'development', totalSeconds: 900, sessionCount: 3, isBrowser: false } as any,
      { bundleId: 'com.apple.Safari', appName: 'Safari', category: 'browsing', totalSeconds: 240, sessionCount: 2, isBrowser: true } as any,
    ],
    pageRefs: [youtubePage as any],
    topArtifacts: [youtubePage],
  })

  const label = userVisibleBlockLabel(block)
  assert.ok(
    !label.toLowerCase().includes('youtube')
      && !label.includes('Electron app in 2026'),
    `dev block label should not be the YouTube title (got: ${JSON.stringify(label)})`,
  )
})

test('research block still uses a YouTube page artifact as its label', () => {
  // Sanity check: the gate only blocks page artifacts for non-page-compatible
  // categories. A research block where the page is the actual subject should
  // still take the artifact title.
  const youtubePage = makeArtifact({
    artifactType: 'page',
    displayTitle: 'Stanford CS229 Lecture 1',
    host: 'youtube.com',
  })
  const block = makeBlock({
    dominantCategory: 'research',
    categoryDistribution: { research: 1 },
    pageRefs: [youtubePage as any],
    topArtifacts: [youtubePage],
  })

  assert.equal(userVisibleBlockLabel(block), 'Stanford CS229 Lecture 1')
})

test('dev block prefers a document artifact (IDE window) over a co-occurring browser page', () => {
  const editorWindow = makeArtifact({
    artifactType: 'window',
    displayTitle: 'src/main/services/workBlocks.ts — daylens',
  })
  const youtubePage = makeArtifact({
    artifactType: 'page',
    displayTitle: 'Lo-fi beats to code to - YouTube',
    host: 'youtube.com',
  })
  const block = makeBlock({
    dominantCategory: 'development',
    documentRefs: [editorWindow as any],
    pageRefs: [youtubePage as any],
    // page comes first in topArtifacts intentionally — historical bug ordering.
    topArtifacts: [youtubePage, editorWindow],
  })

  const label = userVisibleBlockLabel(block)
  assert.ok(label.includes('workBlocks.ts'), `expected editor window title, got ${JSON.stringify(label)}`)
})
