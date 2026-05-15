import test from 'node:test'
import assert from 'node:assert/strict'
import {
  policyForHost,
  isAdultHost,
  isHostBlockedForLabel,
  isHostBlockedForAppsRail,
  isHostFilteredFromArtifacts,
} from '../src/shared/domainPolicy.ts'

// Each test below exists because it represents a class of failure that was
// observed (or that we KNOW the labeler will mishandle if the policy is
// removed). Tests are statements of user-observable invariants, not
// statements about the regex corpus.

test('exact-host adult sites are policy=adult', () => {
  assert.equal(policyForHost('pornhub.com'), 'adult')
  assert.equal(policyForHost('www.pornhub.com'), 'adult')
  assert.equal(policyForHost('xvideos.com'), 'adult')
})

test('subdomain adult sites are policy=adult', () => {
  assert.equal(policyForHost('de.pornhub.com'), 'adult')
  assert.equal(policyForHost('m.xvideos.com'), 'adult')
})

test('adult TLDs hit the suffix rule', () => {
  assert.equal(policyForHost('something.xxx'), 'adult')
  assert.equal(policyForHost('a.b.porn'), 'adult')
})

test('adult stem patterns match anchored to dot/dash', () => {
  assert.equal(policyForHost('free-porn-tube.com'), 'adult')
  assert.equal(policyForHost('nsfw-archive.com'), 'adult')
})

test('innocent hosts containing adult substrings are NOT flagged', () => {
  // "essex" contains "sex" — must NOT match.
  assert.equal(policyForHost('essex.gov.uk'), null)
  // "scunthorpe" — must NOT match.
  assert.equal(policyForHost('scunthorpe.example.com'), null)
})

test('social-feed hosts are policy=social_feed, not adult', () => {
  assert.equal(policyForHost('twitter.com'), 'social_feed')
  assert.equal(policyForHost('x.com'), 'social_feed')
  assert.equal(policyForHost('reddit.com'), 'social_feed')
  assert.equal(policyForHost('www.instagram.com'), 'social_feed')
})

test('work-relevant hosts (notion, github, slack) are NOT policy-blocked', () => {
  assert.equal(policyForHost('notion.so'), null)
  assert.equal(policyForHost('github.com'), null)
  assert.equal(policyForHost('app.slack.com'), null)
  assert.equal(policyForHost('docs.google.com'), null)
})

test('null / empty / non-string hosts return null safely', () => {
  assert.equal(policyForHost(null), null)
  assert.equal(policyForHost(undefined), null)
  assert.equal(policyForHost(''), null)
})

test('isHostBlockedForLabel is strict-adult-only', () => {
  assert.equal(isHostBlockedForLabel('pornhub.com'), true)
  // Social feeds can still label a browsing block — they're suppressed in
  // the apps rail but not in block labels (where "Twitter" is at least
  // accurate even if low-signal).
  assert.equal(isHostBlockedForLabel('twitter.com'), false)
  assert.equal(isHostBlockedForLabel('notion.so'), false)
})

test('isHostBlockedForAppsRail covers adult + social + entertainment', () => {
  assert.equal(isHostBlockedForAppsRail('pornhub.com'), true)
  assert.equal(isHostBlockedForAppsRail('twitter.com'), true)
  assert.equal(isHostBlockedForAppsRail('notion.so'), false)
})

test('isHostFilteredFromArtifacts is adult-only (source-side gate)', () => {
  assert.equal(isHostFilteredFromArtifacts('pornhub.com'), true)
  // Twitter visits still produce artifacts; they just don't surface in apps rail.
  assert.equal(isHostFilteredFromArtifacts('twitter.com'), false)
})

test('isAdultHost helper agrees with policy lookup', () => {
  assert.equal(isAdultHost('pornhub.com'), true)
  assert.equal(isAdultHost('twitter.com'), false)
  assert.equal(isAdultHost(null), false)
})
