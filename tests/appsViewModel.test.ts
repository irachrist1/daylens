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
  const brief = summary('brief', 'development', 119, 3)
  const singleShort = summary('single-short', 'development', 299, 1)
  const singleLong = summary('single-long', 'development', 300, 1)
  const repeated = summary('repeated', 'development', 240, 2)

  const split = splitAppSummaries([brief, singleShort, singleLong, repeated], null)
  assert.deepEqual(split.fleeting.map((app) => app.bundleId), ['brief', 'single-short'])
  assert.deepEqual(split.primary.map((app) => app.bundleId), ['single-long', 'repeated'])
  assert.equal(splitAppSummaries([brief], 'development').primary[0], brief)
})
