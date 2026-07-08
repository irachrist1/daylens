import test from 'node:test'
import assert from 'node:assert/strict'
import { friendlyDomain } from '../src/shared/humanize.ts'

// Regression for the "App" chart bar (2026-07-07 audit): app.intercom.com,
// app.notion.com, and app.weavy.ai all collapsed into one slice literally
// named "App", and us.posthog.com became "Us". Generic hosting labels say
// where a product lives, never what it is.

test('generic subdomain labels never become the site name', () => {
  assert.equal(friendlyDomain('app.intercom.com'), 'Intercom')
  assert.equal(friendlyDomain('app.weavy.ai'), 'Weavy')
  assert.equal(friendlyDomain('us.posthog.com'), 'PostHog')
  assert.equal(friendlyDomain('dashboard.stripe.com'), 'Stripe')
})

test('known brands and meaningful first labels are preserved', () => {
  assert.equal(friendlyDomain('youtube.com'), 'YouTube')
  assert.equal(friendlyDomain('www.canva.com'), 'Canva')
  assert.equal(friendlyDomain('alueducation.instructure.com'), 'Alueducation')
  assert.equal(friendlyDomain('localhost'), 'Local dev server')
})
