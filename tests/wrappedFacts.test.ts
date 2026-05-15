import test from 'node:test'
import assert from 'node:assert/strict'
import type { WebsiteSummary } from '../src/shared/types.ts'
import {
  QUALITY_THRESHOLDS,
  buildBrowserContext,
  categoryBreakdownFromSources,
  classifyDomain,
  computeFocusByPeriod,
  computeIdentityConfidence,
  computeQuality,
  isDomainWorkRelevant,
  largestRemainderPercentages,
  looksLikeRawArtifactLabel,
  selectPeakBlock,
  sanitizeWrappedLabel,
} from '../src/renderer/lib/wrappedFacts.ts'
import type { AppCategory, WorkContextBlock } from '../src/shared/types.ts'

// ─── computeQuality ────────────────────────────────────────────────────────────

test('computeQuality: 0 seconds → empty', () => {
  assert.equal(computeQuality(0), 'empty')
})

test('computeQuality: negative seconds → empty', () => {
  assert.equal(computeQuality(-1), 'empty')
})

test('computeQuality: 1 second → tooEarly', () => {
  assert.equal(computeQuality(1), 'tooEarly')
})

test('computeQuality: just below TOO_EARLY → tooEarly', () => {
  assert.equal(computeQuality(QUALITY_THRESHOLDS.TOO_EARLY_SECONDS - 1), 'tooEarly')
})

test('computeQuality: at TOO_EARLY threshold → partial', () => {
  assert.equal(computeQuality(QUALITY_THRESHOLDS.TOO_EARLY_SECONDS), 'partial')
})

test('computeQuality: just below PARTIAL → partial', () => {
  assert.equal(computeQuality(QUALITY_THRESHOLDS.PARTIAL_SECONDS - 1), 'partial')
})

test('computeQuality: at PARTIAL threshold → full', () => {
  assert.equal(computeQuality(QUALITY_THRESHOLDS.PARTIAL_SECONDS), 'full')
})

test('computeQuality: 8 hours → full', () => {
  assert.equal(computeQuality(8 * 3600), 'full')
})

// ─── classifyDomain ────────────────────────────────────────────────────────────

test('classifyDomain: github.com → codePlatform', () => {
  assert.equal(classifyDomain('github.com'), 'codePlatform')
})

test('classifyDomain: www.github.com strips www prefix', () => {
  assert.equal(classifyDomain('www.github.com'), 'codePlatform')
})

test('classifyDomain: GITHUB.COM normalizes to lowercase', () => {
  assert.equal(classifyDomain('GITHUB.COM'), 'codePlatform')
})

test('classifyDomain: youtube.com → video (not entertainment)', () => {
  assert.equal(classifyDomain('youtube.com'), 'video')
})

test('classifyDomain: netflix.com → entertainment', () => {
  assert.equal(classifyDomain('netflix.com'), 'entertainment')
})

test('classifyDomain: x.com → social', () => {
  assert.equal(classifyDomain('x.com'), 'social')
})

test('classifyDomain: twitter.com → social', () => {
  assert.equal(classifyDomain('twitter.com'), 'social')
})

test('classifyDomain: stackoverflow.com → devDocs', () => {
  assert.equal(classifyDomain('stackoverflow.com'), 'devDocs')
})

test('classifyDomain: claude.ai → aiTool', () => {
  assert.equal(classifyDomain('claude.ai'), 'aiTool')
})

test('classifyDomain: unknown domain → unknown', () => {
  assert.equal(classifyDomain('some-random-site.xyz'), 'unknown')
})

// ─── isDomainWorkRelevant ──────────────────────────────────────────────────────

test('isDomainWorkRelevant: devDocs → true', () => {
  assert.equal(isDomainWorkRelevant('devDocs'), true)
})

test('isDomainWorkRelevant: codePlatform → true', () => {
  assert.equal(isDomainWorkRelevant('codePlatform'), true)
})

test('isDomainWorkRelevant: aiTool → true', () => {
  assert.equal(isDomainWorkRelevant('aiTool'), true)
})

test('isDomainWorkRelevant: video → false', () => {
  assert.equal(isDomainWorkRelevant('video'), false)
})

test('isDomainWorkRelevant: entertainment → false', () => {
  assert.equal(isDomainWorkRelevant('entertainment'), false)
})

test('isDomainWorkRelevant: social → false', () => {
  assert.equal(isDomainWorkRelevant('social'), false)
})

test('isDomainWorkRelevant: unknown → false', () => {
  assert.equal(isDomainWorkRelevant('unknown'), false)
})

// ─── buildBrowserContext ───────────────────────────────────────────────────────

function makeSite(domain: string, totalSeconds: number): WebsiteSummary {
  return { domain, totalSeconds, visitCount: 1, topTitle: null, browserBundleId: null }
}

test('buildBrowserContext: empty websites → null', () => {
  assert.equal(buildBrowserContext([]), null)
})

test('buildBrowserContext: YouTube top domain → video classification', () => {
  const ctx = buildBrowserContext([makeSite('youtube.com', 3600), makeSite('github.com', 600)])
  assert.ok(ctx)
  assert.equal(ctx.topDomain, 'youtube.com')
  assert.equal(ctx.topDomainClass, 'video')
  assert.equal(ctx.isWorkRelevant, false)
  assert.match(ctx.interpretation, /youtube\.com/)
})

test('buildBrowserContext: github.com top domain → work relevant', () => {
  const ctx = buildBrowserContext([makeSite('github.com', 3600), makeSite('youtube.com', 600)])
  assert.ok(ctx)
  assert.equal(ctx.topDomain, 'github.com')
  assert.equal(ctx.topDomainClass, 'codePlatform')
  assert.equal(ctx.isWorkRelevant, true)
  assert.match(ctx.interpretation, /supported/)
})

test('buildBrowserContext: two work domains → mentions both', () => {
  const ctx = buildBrowserContext([makeSite('github.com', 3600), makeSite('stackoverflow.com', 1800)])
  assert.ok(ctx)
  assert.equal(ctx.isWorkRelevant, true)
  assert.match(ctx.interpretation, /github\.com/)
  assert.match(ctx.interpretation, /stackoverflow\.com/)
})

test('buildBrowserContext: ChatGPT lead plus meaningful YouTube reads as mixed', () => {
  const ctx = buildBrowserContext([makeSite('chatgpt.com', 65 * 60), makeSite('youtube.com', 31 * 60)])
  assert.ok(ctx)
  assert.equal(ctx.topDomain, 'chatgpt.com')
  assert.equal(ctx.isWorkRelevant, true)
  assert.equal(ctx.isMixed, true)
  assert.match(ctx.interpretation, /ChatGPT|chatgpt\.com/i)
  assert.match(ctx.interpretation, /youtube\.com/)
  assert.doesNotMatch(ctx.interpretation, /supported the work/i)
})

test('buildBrowserContext: YouTube-heavy browser day is not work relevant', () => {
  const ctx = buildBrowserContext([makeSite('youtube.com', 90 * 60), makeSite('chatgpt.com', 15 * 60)])
  assert.ok(ctx)
  assert.equal(ctx.topDomainClass, 'video')
  assert.equal(ctx.isWorkRelevant, false)
  assert.equal(ctx.isMixed, false)
  assert.doesNotMatch(ctx.interpretation, /supported the work/i)
})

test('buildBrowserContext: social media top domain → drifted copy', () => {
  const ctx = buildBrowserContext([makeSite('reddit.com', 7200)])
  assert.ok(ctx)
  assert.equal(ctx.topDomainClass, 'social')
  assert.equal(ctx.isWorkRelevant, false)
  assert.match(ctx.interpretation, /drifted/)
})

test('buildBrowserContext: sorts by totalSeconds descending', () => {
  const ctx = buildBrowserContext([
    makeSite('youtube.com', 600),
    makeSite('github.com', 3600),
  ])
  assert.ok(ctx)
  assert.equal(ctx.topDomain, 'github.com')
})

// ─── computeIdentityConfidence ─────────────────────────────────────────────────

test('computeIdentityConfidence: empty quality → none', () => {
  assert.equal(computeIdentityConfidence('empty', 0, 'development', 80, null), 'none')
})

test('computeIdentityConfidence: tooEarly quality → none', () => {
  assert.equal(computeIdentityConfidence('tooEarly', 120, 'development', 80, null), 'none')
})

test('computeIdentityConfidence: < 30 min tracked → none regardless of category pct', () => {
  assert.equal(computeIdentityConfidence('full', 20 * 60, 'development', 90, null), 'none')
})

test('computeIdentityConfidence: dominantCategoryPct < 25 → none', () => {
  assert.equal(computeIdentityConfidence('full', 4 * 3600, 'development', 20, null), 'none')
})

test('computeIdentityConfidence: development at 70% full quality → high', () => {
  assert.equal(computeIdentityConfidence('full', 4 * 3600, 'development', 70, null), 'high')
})

test('computeIdentityConfidence: development at 50% → medium', () => {
  assert.equal(computeIdentityConfidence('full', 4 * 3600, 'development', 50, null), 'medium')
})

test('computeIdentityConfidence: development at 30% → low', () => {
  assert.equal(computeIdentityConfidence('full', 4 * 3600, 'development', 30, null), 'low')
})

test('computeIdentityConfidence: browsing with no browser context → none', () => {
  assert.equal(computeIdentityConfidence('full', 4 * 3600, 'browsing', 60, null), 'none')
})

test('computeIdentityConfidence: browsing + YouTube (non-work) context → low', () => {
  const ctx = buildBrowserContext([makeSite('youtube.com', 7200)])!
  assert.equal(computeIdentityConfidence('full', 4 * 3600, 'browsing', 60, ctx), 'low')
})

test('computeIdentityConfidence: unknown and system never earn an identity', () => {
  assert.equal(computeIdentityConfidence('full', 4 * 3600, 'uncategorized', 80, null), 'none')
  assert.equal(computeIdentityConfidence('full', 4 * 3600, 'system', 80, null), 'none')
})

test('computeIdentityConfidence: mixed browser context stays low', () => {
  const ctx = buildBrowserContext([makeSite('chatgpt.com', 65 * 60), makeSite('youtube.com', 31 * 60)])!
  assert.equal(computeIdentityConfidence('full', 4 * 3600, 'browsing', 60, ctx), 'low')
})

test('computeIdentityConfidence: browsing + github context at high pct → medium', () => {
  const ctx = buildBrowserContext([makeSite('github.com', 7200)])!
  assert.equal(computeIdentityConfidence('full', 4 * 3600, 'browsing', 60, ctx), 'medium')
})

test('computeIdentityConfidence: browsing + github context at low pct → low', () => {
  const ctx = buildBrowserContext([makeSite('github.com', 7200)])!
  assert.equal(computeIdentityConfidence('full', 4 * 3600, 'browsing', 30, ctx), 'low')
})

// ─── computeFocusByPeriod ──────────────────────────────────────────────────────

function makeBlock(startHour: number, durationMinutes: number, category: 'development' | 'browsing') {
  const startTime = new Date(2026, 0, 15, startHour, 0, 0).getTime()
  const endTime = startTime + durationMinutes * 60 * 1000
  return { startTime, endTime, category }
}

test('computeFocusByPeriod: no blocks → null peakPeriod', () => {
  const result = computeFocusByPeriod([])
  assert.equal(result.peakPeriod, null)
  assert.equal(result.morning, 0)
  assert.equal(result.afternoon, 0)
  assert.equal(result.evening, 0)
})

test('computeFocusByPeriod: non-focus categories are ignored', () => {
  const result = computeFocusByPeriod([makeBlock(10, 60, 'browsing')])
  assert.equal(result.morning, 0)
  assert.equal(result.peakPeriod, null)
})

test('computeFocusByPeriod: morning focus block → morning peak', () => {
  const result = computeFocusByPeriod([makeBlock(9, 60, 'development')])
  assert.equal(result.morning, 60 * 60)
  assert.equal(result.afternoon, 0)
  assert.equal(result.peakPeriod, 'morning')
})

test('computeFocusByPeriod: afternoon focus block → afternoon peak', () => {
  const result = computeFocusByPeriod([makeBlock(14, 90, 'development')])
  assert.equal(result.afternoon, 90 * 60)
  assert.equal(result.peakPeriod, 'afternoon')
})

test('computeFocusByPeriod: evening focus block → evening peak', () => {
  const result = computeFocusByPeriod([makeBlock(19, 45, 'development')])
  assert.equal(result.evening, 45 * 60)
  assert.equal(result.peakPeriod, 'evening')
})

// ─── category breakdown ───────────────────────────────────────────────────────

test('largestRemainderPercentages: visible percentages sum to 100', () => {
  const result = largestRemainderPercentages([1, 1, 1])
  assert.equal(result.reduce((sum, pct) => sum + pct, 0), 100)
  assert.deepEqual(result, [34, 33, 33])
})

test('categoryBreakdownFromSources: prefers session categories over block categories', () => {
  const result = categoryBreakdownFromSources(
    [
      { category: 'aiTools', durationSeconds: 2 * 3600 },
      { category: 'development', durationSeconds: 3600 },
    ],
    [
      { dominantCategory: 'browsing', startTime: 0, endTime: 3 * 3600 * 1000 },
    ],
  )
  assert.equal(result.dominantCategory, 'aiTools')
  assert.equal(result.breakdown[0]?.category, 'aiTools')
  assert.equal(result.breakdown.reduce((sum, item) => sum + item.pct, 0), 100)
})

test('categoryBreakdownFromSources: supports sessions-without-blocks state', () => {
  const result = categoryBreakdownFromSources(
    [{ category: 'productivity', durationSeconds: 30 * 60 }],
    [],
  )
  assert.equal(result.dominantCategory, 'productivity')
  assert.equal(result.breakdown[0]?.pct, 100)
})

test('categoryBreakdownFromSources: system and uncategorized sessions are excluded', () => {
  const result = categoryBreakdownFromSources(
    [
      { category: 'uncategorized', durationSeconds: 7 * 3600 },
      { category: 'system', durationSeconds: 2 * 3600 },
      { category: 'development', durationSeconds: 90 * 60 },
      { category: 'aiTools', durationSeconds: 60 * 60 },
    ],
    [],
  )
  assert.equal(result.dominantCategory, 'development')
  assert.ok(!result.breakdown.some((item) => item.category === 'uncategorized'))
  assert.ok(!result.breakdown.some((item) => item.category === 'system'))
  assert.equal(result.breakdown.reduce((sum, item) => sum + item.pct, 0), 100)
})

// ─── peak block labels ────────────────────────────────────────────────────────

function makeWrappedBlock(
  label: string,
  category: AppCategory,
  durationMinutes: number,
  source: WorkContextBlock['label']['source'] = 'rule',
): WorkContextBlock {
  return {
    startTime: 0,
    endTime: durationMinutes * 60 * 1000,
    dominantCategory: category,
    label: {
      current: label,
      source,
      confidence: 0.7,
      narrative: null,
      ruleBased: label,
      aiSuggested: null,
      override: null,
    },
    confidence: 'medium',
  } as WorkContextBlock
}

test('artifact label sanitization removes raw LinkedIn and YouTube titles', () => {
  assert.equal(looksLikeRawArtifactLabel('Andersen in Rwanda: Company Page Admin | LinkedIn'), true)
  assert.equal(looksLikeRawArtifactLabel('Scott Galloway: AI CEO’s Are Lying - YouTube'), true)
  assert.equal(sanitizeWrappedLabel('Andersen in Rwanda: Company Page Admin | LinkedIn', 'browsing'), 'Work session')
  assert.equal(sanitizeWrappedLabel('Scott Galloway: AI CEO’s Are Lying - YouTube', 'productivity'), 'Admin work')
})

test('selectPeakBlock excludes random browsing artifact blocks', () => {
  const peak = selectPeakBlock([
    makeWrappedBlock('Andersen in Rwanda: Company Page Admin | LinkedIn', 'browsing', 60, 'artifact'),
    makeWrappedBlock('Building & Testing', 'development', 37, 'rule'),
  ])
  assert.ok(peak)
  assert.equal(peak.label, 'Building & Testing')
  assert.equal(peak.category, 'development')
})

test('selectPeakBlock does not show YouTube video titles as work labels', () => {
  const peak = selectPeakBlock([
    makeWrappedBlock('Scott Galloway: AI CEO’s Are Lying To You To Raise Billions! - YouTube', 'productivity', 60, 'artifact'),
    makeWrappedBlock('Code generation with AI assistance', 'aiTools', 18, 'ai'),
  ])
  assert.ok(peak)
  assert.equal(peak.label, 'Code generation with AI assistance')
})

test('selectPeakBlock returns null when no meaningful work block exists', () => {
  const peak = selectPeakBlock([
    makeWrappedBlock('Watch 2 Broke Girls Season 3 Episode 1', 'browsing', 60, 'artifact'),
  ])
  assert.equal(peak, null)
})

test('computeFocusByPeriod: morning > afternoon → morning peak', () => {
  const result = computeFocusByPeriod([
    makeBlock(9, 90, 'development'),
    makeBlock(14, 60, 'development'),
  ])
  assert.equal(result.peakPeriod, 'morning')
})

test('computeFocusByPeriod: afternoon > morning → afternoon peak', () => {
  const result = computeFocusByPeriod([
    makeBlock(9, 30, 'development'),
    makeBlock(14, 90, 'development'),
  ])
  assert.equal(result.peakPeriod, 'afternoon')
})

// ─── Additional edge cases from spec ──────────────────────────────────────────

test('classifyDomain: perplexity.ai → search', () => {
  assert.equal(classifyDomain('perplexity.ai'), 'search')
})

test('classifyDomain: notion.so → workTool', () => {
  assert.equal(classifyDomain('notion.so'), 'workTool')
})

test('classifyDomain: zoom.us → communication', () => {
  assert.equal(classifyDomain('zoom.us'), 'communication')
})

test('classifyDomain: netflix.com → entertainment (clearly leisure)', () => {
  assert.equal(classifyDomain('netflix.com'), 'entertainment')
})

test('isDomainWorkRelevant: search → true', () => {
  assert.equal(isDomainWorkRelevant('search'), true)
})

test('isDomainWorkRelevant: communication → false', () => {
  assert.equal(isDomainWorkRelevant('communication'), false)
})

test('isDomainWorkRelevant: learning → false', () => {
  assert.equal(isDomainWorkRelevant('learning'), false)
})

test('isDomainWorkRelevant: news → false', () => {
  assert.equal(isDomainWorkRelevant('news'), false)
})

test('buildBrowserContext: entertainment top domain → drifted copy', () => {
  const ctx = buildBrowserContext([makeSite('netflix.com', 5400)])
  assert.ok(ctx)
  assert.equal(ctx.topDomainClass, 'entertainment')
  assert.equal(ctx.isWorkRelevant, false)
  assert.match(ctx.interpretation, /drifted/)
})

test('buildBrowserContext: notion.so top domain (workTool) → work relevant', () => {
  const ctx = buildBrowserContext([makeSite('notion.so', 3600)])
  assert.ok(ctx)
  assert.equal(ctx.topDomainClass, 'workTool')
  assert.equal(ctx.isWorkRelevant, true)
})

test('buildBrowserContext: unknown domain → not work relevant', () => {
  const ctx = buildBrowserContext([makeSite('some-obscure-site.xyz', 3600)])
  assert.ok(ctx)
  assert.equal(ctx.topDomainClass, 'unknown')
  assert.equal(ctx.isWorkRelevant, false)
})

test('computeIdentityConfidence: research at 70% full quality → high', () => {
  assert.equal(computeIdentityConfidence('full', 4 * 3600, 'research', 70, null), 'high')
})

test('computeIdentityConfidence: meetings at 45% → medium', () => {
  assert.equal(computeIdentityConfidence('full', 4 * 3600, 'meetings', 45, null), 'medium')
})

test('computeIdentityConfidence: partial quality caps at medium for high pct', () => {
  // partial quality cannot produce 'high' confidence
  const result = computeIdentityConfidence('partial', 30 * 60 + 1, 'development', 90, null)
  assert.notEqual(result, 'high')
})

test('computeFocusByPeriod: aiTools counted as focus', () => {
  const start = new Date(2026, 0, 15, 14, 0, 0).getTime()
  const end   = start + 60 * 60 * 1000
  const result = computeFocusByPeriod([{ startTime: start, endTime: end, category: 'aiTools' }])
  assert.equal(result.afternoon, 3600)
  assert.equal(result.peakPeriod, 'afternoon')
})

test('computeFocusByPeriod: meetings are not counted as focus', () => {
  const start = new Date(2026, 0, 15, 9, 0, 0).getTime()
  const end   = start + 60 * 60 * 1000
  const result = computeFocusByPeriod([{ startTime: start, endTime: end, category: 'meetings' }])
  assert.equal(result.morning, 0)
  assert.equal(result.peakPeriod, null)
})

test('computeFocusByPeriod: social is not counted as focus', () => {
  const start = new Date(2026, 0, 15, 15, 0, 0).getTime()
  const end   = start + 30 * 60 * 1000
  const result = computeFocusByPeriod([{ startTime: start, endTime: end, category: 'social' }])
  assert.equal(result.afternoon, 0)
  assert.equal(result.peakPeriod, null)
})
