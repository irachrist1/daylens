import test from 'node:test'
import assert from 'node:assert/strict'
import type { AppCategory, ArtifactRef, PageRef, WorkContextAppSummary } from '../src/shared/types.ts'
import {
  dominantCategoryForBlock,
  appCategoryForSessionSummary,
  normalizeAppSummaryForBlockDisplay,
} from '../src/main/services/workBlocks.ts'

// Invariant 6: "A single off-task tab never sets a block's category."
// dominantCategoryForBlock derives the category from the block's foreground
// app distribution, refined — but never overridden — by the top page artifact
// when the base is already focused work. These cases use real shapes from the
// live DB (blk_338e5bade088df14 and the Notion review block).

function makePage(domain: string, seconds: number, title = `${domain} page`): PageRef {
  return {
    id: `page:${domain}:${seconds}`,
    artifactType: 'page',
    displayTitle: title,
    totalSeconds: seconds,
    confidence: 0.9,
    domain,
    host: domain,
    url: `https://${domain}/`,
    normalizedUrl: `https://${domain}/`,
    pageTitle: title,
    openTarget: { kind: 'url', url: `https://${domain}/` },
  } as unknown as PageRef
}

test('a single Netflix page never flips an aiTools-dominant block to entertainment (blk_338 shape)', () => {
  // Real row blk_338e5bade088df14: distribution has ZERO entertainment app-time,
  // but netflix.com was the top page artifact (1051s). The old code returned
  // 'entertainment' via the unconditional artifact override.
  const distribution: Partial<Record<AppCategory, number>> = { aiTools: 867, browsing: 39, productivity: 76 }
  const topArtifacts: ArtifactRef[] = [makePage('netflix.com', 1051, 'Netflix')]

  const category = dominantCategoryForBlock(distribution, topArtifacts)
  assert.notEqual(category, 'entertainment', 'an aiTools-majority block must not read as Leisure because one Netflix tab was open')
  assert.equal(category, 'aiTools')
})

test('a Notion-dominant block with a smaller YouTube detour reads as productivity, not Leisure', () => {
  // 46m reviewing work material in Notion, a YouTube video open as a
  // side-detour. Both live inside the Dia browser (base=browsing),
  // so intentional Notion work must carry productivity weight via the artifact.
  const distribution: Partial<Record<AppCategory, number>> = { browsing: 2760 }
  const topArtifacts: ArtifactRef[] = [
    makePage('app.notion.com', 2400, 'AI Training Session | Notion'),
    makePage('youtube.com', 600, 'Some Video - YouTube'),
  ]

  const category = dominantCategoryForBlock(distribution, topArtifacts)
  assert.equal(category, 'productivity', 'Notion review must set the category, not the background YouTube tab')
})

test('a genuinely entertainment-dominant block still reads as entertainment', () => {
  // Do not break the legitimate case: a browsing block whose real content was a
  // long Netflix session must still be entertainment.
  const distribution: Partial<Record<AppCategory, number>> = { browsing: 1500 }
  const topArtifacts: ArtifactRef[] = [makePage('netflix.com', 1400, 'Netflix')]

  const category = dominantCategoryForBlock(distribution, topArtifacts)
  assert.equal(category, 'entertainment')
})

test('entertainment can override a focused base only when it is the strict majority and the work is a minority', () => {
  // Focused work is a minority (40% of foreground), entertainment page is the
  // clear majority — a genuinely leisure-dominant stretch with scattered work.
  const distribution: Partial<Record<AppCategory, number>> = { aiTools: 300, browsing: 250, communication: 200 }
  const topArtifacts: ArtifactRef[] = [makePage('netflix.com', 900, 'Netflix')]

  const category = dominantCategoryForBlock(distribution, topArtifacts)
  assert.equal(category, 'entertainment', 'a minority of focused work does not defend a majority-entertainment block')
})

test('split focused work is not flipped by a social top artifact', () => {
  const distribution: Partial<Record<AppCategory, number>> = {
    development: 450,
    communication: 400,
    browsing: 150,
  }
  const topArtifacts: ArtifactRef[] = [makePage('x.com', 800)]
  const category = dominantCategoryForBlock(distribution, topArtifacts)
  assert.notEqual(category, 'social', 'one X.com tab must not flip an 85% work block')
  assert.equal(category, 'development')
})

test('split focused work is not flipped by an entertainment top artifact', () => {
  const distribution: Partial<Record<AppCategory, number>> = {
    development: 450,
    communication: 400,
    browsing: 150,
  }
  const topArtifacts: ArtifactRef[] = [makePage('netflix.com', 800)]
  const category = dominantCategoryForBlock(distribution, topArtifacts)
  assert.notEqual(category, 'entertainment')
  assert.equal(category, 'development')
})

test('focused development base beats a github research artifact', () => {
  const distribution: Partial<Record<AppCategory, number>> = { development: 1800, browsing: 300 }
  const topArtifacts: ArtifactRef[] = [
    makePage('github.com', 300, 'https://github.com/org/repo'),
  ]
  const category = dominantCategoryForBlock(distribution, topArtifacts)
  assert.equal(category, 'development')
})

test('browsing block with a small social detour stays browsing', () => {
  const distribution: Partial<Record<AppCategory, number>> = { browsing: 2400, social: 120 }
  const topArtifacts: ArtifactRef[] = [makePage('x.com', 120)]
  const category = dominantCategoryForBlock(distribution, topArtifacts)
  assert.equal(category, 'browsing')
})

test('communication-dominant work is not flipped by a social top artifact', () => {
  const distribution: Partial<Record<AppCategory, number>> = { communication: 700, browsing: 300 }
  const topArtifacts: ArtifactRef[] = [makePage('x.com', 800)]
  const category = dominantCategoryForBlock(distribution, topArtifacts)
  assert.equal(category, 'communication')
})

test('split work with communication plurality is not flipped by a leisure top artifact', () => {
  const distribution: Partial<Record<AppCategory, number>> = {
    aiTools: 250,
    research: 250,
    communication: 300,
    browsing: 200,
  }
  const topArtifacts: ArtifactRef[] = [makePage('netflix.com', 900)]
  const category = dominantCategoryForBlock(distribution, topArtifacts)
  assert.equal(category, 'aiTools')
})

test('a leisure artifact tied with total work intent does not beat work', () => {
  const distribution: Partial<Record<AppCategory, number>> = { aiTools: 400, communication: 400, browsing: 200 }
  const topArtifacts: ArtifactRef[] = [makePage('netflix.com', 800)]
  const category = dominantCategoryForBlock(distribution, topArtifacts)
  assert.equal(category, 'aiTools')
})

function makeLocalhostPage(seconds: number, port = 4321): PageRef {
  return {
    id: `page:localhost:${port}:${seconds}`,
    artifactType: 'page',
    displayTitle: 'Local dev server',
    totalSeconds: seconds,
    confidence: 0.9,
    domain: `localhost:${port}`,
    host: `localhost:${port}`,
    url: `http://localhost:${port}/`,
    normalizedUrl: `http://localhost:${port}/`,
    pageTitle: 'Local dev server',
    openTarget: { kind: 'url', url: `http://localhost:${port}/` },
  } as unknown as PageRef
}

test('a late-night mostly-leisure block with a localhost tab is NOT development', () => {
  // Real row: the 00:00-04:00 block. Distribution is browsing-dominant with heavy
  // entertainment+social; only a 262s dev sliver. A localhost:4321 page was open
  // (the SPCS site), and the old localhost rule stamped the whole 4h block
  // 'development' on that sliver alone, so a Netflix/YouTube night was counted as
  // development WORK. The dev evidence (localhost 2055s + dev 262s = 2317s) is
  // out-weighed by leisure (entertainment 2843 + social 510 = 3353s): not dev.
  const distribution: Partial<Record<AppCategory, number>> = {
    development: 262, aiTools: 7, entertainment: 2843, social: 510, design: 3, browsing: 6220,
  }
  const topArtifacts: ArtifactRef[] = [
    makePage('localhost:4321', 2055, 'SPCS Group') as unknown as PageRef,
    makePage('youtube.com', 1800, 'Some Video - YouTube'),
    makePage('netflix.com', 1043, 'Netflix'),
  ]
  // Rebuild the localhost artifact with a real localhost host so isLocalhostArtifact matches.
  topArtifacts[0] = makeLocalhostPage(2055)
  const category = dominantCategoryForBlock(distribution, topArtifacts)
  assert.notEqual(category, 'development', 'a mostly-leisure night must not read as development because localhost was open')
})

test('a genuine local-dev block (localhost + editor, little leisure) still reads as development', () => {
  // Do not break the case the localhost rule exists for: heavy time on the local
  // dev server plus editor time, with only a small leisure detour.
  const distribution: Partial<Record<AppCategory, number>> = {
    development: 900, browsing: 3000, entertainment: 200,
  }
  const topArtifacts: ArtifactRef[] = [makeLocalhostPage(2600)]
  const category = dominantCategoryForBlock(distribution, topArtifacts)
  assert.equal(category, 'development', 'localhost dev + editor time, minimal leisure, is development')
})

test('browser app category is always browsing regardless of block-level category', () => {
  // Block might read productivity from a Notion page, but Dia/Safari/Chrome
  // themselves are always "Browsing" on the app rail — must not regress when
  // dominantCategoryForBlock changes.
  const productivityBlockCategory = dominantCategoryForBlock(
    { browsing: 2760 },
    [makePage('app.notion.com', 2400, 'AI Training Session | Notion')],
  )
  assert.equal(productivityBlockCategory, 'productivity')

  for (const browser of [
    { bundleId: 'company.thebrowser.dia', appName: 'Dia', category: 'productivity' as AppCategory },
    { bundleId: 'com.apple.Safari', appName: 'Safari', category: 'research' as AppCategory },
    { bundleId: 'com.google.Chrome', appName: 'Google Chrome', category: 'development' as AppCategory },
  ]) {
    assert.equal(
      appCategoryForSessionSummary(browser),
      'browsing',
      `${browser.appName} app-level category must stay browsing even when session.category is ${browser.category}`,
    )
  }
})

test('stored browser app evidence is normalized back to browsing on display', () => {
  const staleEvidenceApp: WorkContextAppSummary = {
    bundleId: 'company.thebrowser.dia',
    canonicalAppId: 'dia',
    appName: 'Dia',
    category: 'productivity',
    totalSeconds: 2400,
    sessionCount: 1,
    isBrowser: false,
  }

  const normalized = normalizeAppSummaryForBlockDisplay(staleEvidenceApp)
  assert.equal(normalized.category, 'browsing')
  assert.equal(normalized.isBrowser, true)
  assert.equal(normalized.totalSeconds, staleEvidenceApp.totalSeconds)
})
