import assert from 'node:assert/strict'
import test from 'node:test'
import type { AppCategory, AppUsageSummary } from '../src/shared/types'
import {
  appSummaryId,
  filterAppSummariesByCategory,
  splitAppSummaries,
} from '../src/renderer/views/apps/appsViewModel'

function summary(
  bundleId: string,
  category: AppCategory,
  totalSeconds = 600,
  sessionCount = 2,
): AppUsageSummary {
  return {
    bundleId,
    canonicalAppId: null,
    appName: bundleId,
    category,
    totalSeconds,
    sessionCount,
    isFocused: false,
  }
}

test('Apps category filtering compares category identity, not display labels', () => {
  const apps = [summary('editor', 'development'), summary('browser', 'browsing')]
  assert.deepEqual(
    filterAppSummariesByCategory(apps, 'development').map((app) => app.bundleId),
    ['editor'],
  )
})

test('Apps summary identity consistently prefers canonical app id', () => {
  assert.equal(appSummaryId({ bundleId: 'raw.exe', canonicalAppId: 'canonical-app' }), 'canonical-app')
  assert.equal(appSummaryId({ bundleId: 'raw.exe', canonicalAppId: null }), 'raw.exe')
})

test('fleeting-app precedence is explicit and behavior preserving', () => {
  // Five substantial apps occupy the top-five guarantee, so the thresholds
  // decide the rest.
  const big = [1, 2, 3, 4, 5].map((n) => summary(`big-${n}`, 'development', 3600 + n, 3))
  const brief = summary('brief', 'development', 119, 3)
  const singleShort = summary('single-short', 'development', 299, 1)
  const singleLong = summary('single-long', 'development', 300, 1)
  const repeated = summary('repeated', 'development', 240, 2)

  const split = splitAppSummaries([...big, brief, singleShort, singleLong, repeated], null)
  assert.deepEqual(
    split.fleeting.map((app) => app.bundleId),
    ['brief', 'single-short'],
  )
  assert.deepEqual(
    split.primary.map((app) => app.bundleId),
    [...big.map((app) => app.bundleId), 'single-long', 'repeated'],
  )
  assert.equal(splitAppSummaries([brief], 'development').primary[0], brief)
})

test('a top-five application by time is never collapsed into the fleeting fold', () => {
  // A light day: every app sits under the fleeting thresholds, yet the five
  // largest must stay visibly present in the primary list.
  const apps = [1, 2, 3, 4, 5, 6].map((n) => summary(`app-${n}`, 'development', 115 - n, 1))
  const split = splitAppSummaries(apps, null)
  assert.deepEqual(
    split.primary.map((app) => app.bundleId),
    ['app-1', 'app-2', 'app-3', 'app-4', 'app-5'],
  )
  assert.deepEqual(split.fleeting.map((app) => app.bundleId), ['app-6'])
})
