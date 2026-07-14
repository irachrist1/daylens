import test from 'node:test'
import assert from 'node:assert/strict'
import { categoryForDomain } from '../src/shared/domainCategories.ts'

// The site → category half of the weighted block distribution:
// a browser session's seconds split across what actually happened inside it.

test('work surfaces map to their own activity category', () => {
  assert.equal(categoryForDomain('canva.com'), 'design')
  assert.equal(categoryForDomain('www.figma.com'), 'design')
  assert.equal(categoryForDomain('claude.ai'), 'aiTools')
  assert.equal(categoryForDomain('chatgpt.com'), 'aiTools')
  assert.equal(categoryForDomain('github.com'), 'research')
  assert.equal(categoryForDomain('gitlab.com'), 'development')
  assert.equal(categoryForDomain('localhost'), 'development')
  assert.equal(categoryForDomain('docs.google.com'), 'writing')
  assert.equal(categoryForDomain('app.notion.com'), 'productivity')
  assert.equal(categoryForDomain('mail.google.com'), 'email')
  assert.equal(categoryForDomain('meet.google.com'), 'meetings')
})

test('subdomains inherit the parent host category', () => {
  assert.equal(categoryForDomain('gist.github.com'), 'research')
  assert.equal(categoryForDomain('acme.atlassian.net'), 'productivity')
  assert.equal(categoryForDomain('en.wikipedia.org'), 'research')
})

test('leisure sinks follow domainPolicy so the two files cannot disagree', () => {
  assert.equal(categoryForDomain('youtube.com'), 'entertainment')
  assert.equal(categoryForDomain('m.youtube.com'), 'entertainment')
  assert.equal(categoryForDomain('netflix.com'), 'entertainment')
  assert.equal(categoryForDomain('x.com'), 'social')
  assert.equal(categoryForDomain('reddit.com'), 'social')
})

test('unknown hosts carry no signal and stay plain browsing (null)', () => {
  assert.equal(categoryForDomain('acetforafrica.org'), null)
  assert.equal(categoryForDomain('spcstech.com'), null)
  assert.equal(categoryForDomain(''), null)
  assert.equal(categoryForDomain(null), null)
})
