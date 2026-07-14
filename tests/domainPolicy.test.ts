import test from 'node:test'
import assert from 'node:assert/strict'
import {
  policyForHost,
  isHostBlockedForLabel,
  isHostBlockedForAppsRail,
  isHostFilteredFromArtifacts,
} from '../src/shared/domainPolicy.ts'

test('social-feed hosts are policy=social_feed', () => {
  assert.equal(policyForHost('twitter.com'), 'social_feed')
  assert.equal(policyForHost('x.com'), 'social_feed')
  assert.equal(policyForHost('reddit.com'), 'social_feed')
  assert.equal(policyForHost('www.instagram.com'), 'social_feed')
})

test('entertainment hosts are policy=entertainment, including subdomains', () => {
  assert.equal(policyForHost('youtube.com'), 'entertainment')
  assert.equal(policyForHost('m.youtube.com'), 'entertainment')
  assert.equal(policyForHost('netflix.com'), 'entertainment')
})

test('work-relevant hosts (notion, github, slack) are NOT policy-listed', () => {
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

test('display policy: no host is hard-blocked from labels or artifacts', () => {
  assert.equal(isHostBlockedForLabel('twitter.com'), false)
  assert.equal(isHostBlockedForLabel('notion.so'), false)
  assert.equal(isHostFilteredFromArtifacts('twitter.com'), false)
  assert.equal(isHostFilteredFromArtifacts('youtube.com'), false)
})

test('isHostBlockedForAppsRail covers social + entertainment', () => {
  assert.equal(isHostBlockedForAppsRail('twitter.com'), true)
  assert.equal(isHostBlockedForAppsRail('youtube.com'), true)
  assert.equal(isHostBlockedForAppsRail('notion.so'), false)
})
