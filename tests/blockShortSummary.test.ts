import test from 'node:test'
import assert from 'node:assert/strict'
import type { AppCategory, WorkContextBlock } from '../src/shared/types.ts'
import { blockShortSummary } from '../src/renderer/lib/timelineText.ts'

// DEV-266: a block summary once read "Spent 37m spent on ChatGPT" — the
// default category verb was "spent on", doubling the template's own "Spent".
// These tests pin every category's sentence to a single clean reading.

const ALL_CATEGORIES: AppCategory[] = [
  'development', 'design', 'writing', 'research', 'aiTools', 'email',
  'communication', 'meetings', 'browsing', 'productivity', 'entertainment',
  'social', 'system', 'uncategorized',
]

function makeBlock(overrides: Partial<{
  category: AppCategory
  appName: string | null
  artifactTitle: string | null
  domain: string | null
}>): WorkContextBlock {
  const startTime = Date.UTC(2026, 3, 23, 9, 0, 0)
  const endTime = startTime + 37 * 60_000
  const apps = overrides.appName
    ? [{
        bundleId: 'com.test.app',
        appName: overrides.appName,
        category: overrides.category ?? 'aiTools',
        totalSeconds: 37 * 60,
        sessionCount: 1,
        isBrowser: false,
        isFocused: true,
      }]
    : []
  return {
    id: 'blk_test',
    startTime,
    endTime,
    isLive: false,
    provisional: false,
    dominantCategory: overrides.category ?? 'aiTools',
    categoryDistribution: {},
    switchCount: 2,
    sessions: [{ id: 1, startTime, endTime, durationSeconds: 37 * 60 }],
    topApps: apps,
    websites: overrides.domain
      ? [{ domain: overrides.domain, totalSeconds: 600, pageCount: 3 }]
      : [],
    keyPages: [],
    pageRefs: [],
    documentRefs: [],
    topArtifacts: overrides.artifactTitle
      ? [{
          displayTitle: overrides.artifactTitle,
          artifactType: 'page',
          totalSeconds: 600,
          ownerBundleId: null,
        }]
      : [],
    workflowRefs: [],
    label: { current: 'ChatGPT', override: null },
  } as unknown as WorkContextBlock
}

test('no summary ever doubles its verb ("Spent Xm spent on…")', () => {
  for (const category of ALL_CATEGORIES) {
    const variants = [
      makeBlock({ category }),
      makeBlock({ category, appName: 'ChatGPT' }),
      makeBlock({ category, appName: 'ChatGPT', domain: 'chatgpt.com' }),
      makeBlock({ category, appName: 'ChatGPT', artifactTitle: 'ChatGPT' }),
    ]
    for (const block of variants) {
      const summary = blockShortSummary(block)
      assert.doesNotMatch(
        summary,
        /\bspent\b[^.]*\bspent\b/i,
        `category "${category}" produced a doubled verb: "${summary}"`,
      )
      assert.match(summary, /^Spent 37m /, `category "${category}" must open with the duration once: "${summary}"`)
    }
  }
})

test('the ChatGPT shape reads as one clean sentence', () => {
  const summary = blockShortSummary(makeBlock({ category: 'aiTools', appName: 'ChatGPT', artifactTitle: 'ChatGPT' }))
  assert.equal(summary, 'Spent 37m working with ChatGPT, mostly in ChatGPT.')
})
