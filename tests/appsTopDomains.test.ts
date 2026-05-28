// Regression guard for the per-domain rollup inside AppDetailPayload.
// When the selected app is a browser, `getAppDetailPayload` must populate
// `topDomains` from `website_visits`, grouped by `canonical_browser_id` via
// `getDomainSummariesForBrowser`. When the selected app is a native app,
// `topDomains` must be omitted so the renderer can hide the section.
//
// Fixtures reuse the AI bench infra so the ground truth is the same as the
// rest of the harness.
import test from 'node:test'
import assert from 'node:assert/strict'
import { setupFixture } from './ai-bench/fixtures'
import { getAppDetailPayload } from '../src/main/services/workBlocks'

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function daysFromFixtureThroughToday(fixtureToday: Date): number {
  const fixtureDay = new Date(localDateKey(fixtureToday)).getTime()
  const today = new Date(localDateKey(new Date())).getTime()
  return Math.max(1, Math.floor((today - fixtureDay) / 86_400_000) + 1)
}

test('browser app detail includes per-domain time rollup', () => {
  const { db, today } = setupFixture('allDayChatGPT')
  // canonical id for Google Chrome in the appIdentity catalog is "chrome".
  const detail = getAppDetailPayload(db, 'chrome', daysFromFixtureThroughToday(today), null)
  assert.ok(Array.isArray(detail.topDomains), 'topDomains must be present for a browser app')
  const domains = detail.topDomains ?? []
  const domainNames = domains.map((d) => d.domain)
  assert.ok(domainNames.includes('chatgpt.com'), `expected chatgpt.com in ${JSON.stringify(domainNames)}`)
  assert.ok(domainNames.includes('claude.ai'), `expected claude.ai in ${JSON.stringify(domainNames)}`)
  const chatgpt = domains.find((d) => d.domain === 'chatgpt.com')
  assert.ok(chatgpt && chatgpt.totalSeconds > 0, 'chatgpt.com should have a non-zero total')
  db.close()
})

test('native app detail omits per-domain rollup', () => {
  const { db, today } = setupFixture('codingDay')
  const detail = getAppDetailPayload(db, 'cursor', daysFromFixtureThroughToday(today), null)
  assert.equal(detail.topDomains, undefined, 'non-browser apps must not carry topDomains')
  db.close()
})

test('domain rollup is ordered by duration desc', () => {
  const { db, today } = setupFixture('allDayChatGPT')
  const detail = getAppDetailPayload(db, 'chrome', daysFromFixtureThroughToday(today), null)
  const domains = detail.topDomains ?? []
  for (let i = 1; i < domains.length; i++) {
    assert.ok(
      domains[i - 1].totalSeconds >= domains[i].totalSeconds,
      `domains must be sorted by duration desc, but ${domains[i - 1].domain} (${domains[i - 1].totalSeconds}s) < ${domains[i].domain} (${domains[i].totalSeconds}s)`,
    )
  }
  db.close()
})
