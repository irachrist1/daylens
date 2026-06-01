import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveTitleFromMessage, isWeakThreadTitle } from '../src/main/lib/threadTitles.ts'

// FB6: titles must be meaningful 2–5 word topic phrases — never a bare stopword,
// never a raw truncated sentence.

test('"What did I work on today?" becomes a topic phrase, not "today"', () => {
  const title = deriveTitleFromMessage('What did I work on today?')
  assert.notEqual(title.toLowerCase(), 'today')
  assert.match(title, /today/i)
  assert.match(title, /work/i)
})

test('"in detail tell me everything i did on this laptop" → "Everything I did"', () => {
  assert.equal(deriveTitleFromMessage('in detail tell me everything i did on this laptop'), 'Everything I did')
})

test('"Summarize my last 7 days by project." stays a clean topic phrase', () => {
  const title = deriveTitleFromMessage('Summarize my last 7 days by project.')
  assert.match(title, /last 7 days by project/i)
  assert.ok(!title.startsWith('my'), 'leading "my" should be stripped')
})

test('a bare timeframe message never titles the thread with the bare word', () => {
  assert.equal(deriveTitleFromMessage('today'), 'New chat')
  assert.equal(deriveTitleFromMessage('this week'), 'New chat')
})

test('"What did I do yesterday?" → yesterday work phrase', () => {
  assert.match(deriveTitleFromMessage('What did I do yesterday?'), /yesterday/i)
})

test('a focus question yields a focus phrase, not a clipped clause', () => {
  const title = deriveTitleFromMessage('When was I most focused this week?')
  assert.ok(!title.endsWith('…'), 'should not be a truncated sentence')
  assert.match(title, /focus/i)
})

test('isWeakThreadTitle flags bare stopwords/timeframes and ellipsis', () => {
  assert.equal(isWeakThreadTitle('today'), true)
  assert.equal(isWeakThreadTitle('the week'), true)
  assert.equal(isWeakThreadTitle('in detail tell me evrything i did o…'), true)
  assert.equal(isWeakThreadTitle("Today's work"), false)
  assert.equal(isWeakThreadTitle('Day report 2026-05-31'), false)
})

test('a possessive title is not double-capitalized after the apostrophe', () => {
  const title = deriveTitleFromMessage('What did I work on today?')
  assert.ok(!/'S\b/.test(title), `apostrophe-s should stay lowercase, got: ${title}`)
})
