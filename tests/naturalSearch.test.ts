import test from 'node:test'
import assert from 'node:assert/strict'
import { deterministicTerms, isLiteralQuery, mergeByTermHits } from '../src/main/services/searchTerms.ts'

// S1: the deterministic core of natural-language search (the parts that run with
// no provider / offline). The live provider-interpretation path is covered by
// the behaviour harness, not here.

test('deterministicTerms keeps entities and drops stopwords + question words', () => {
  const terms = deterministicTerms('when did I last touch the autoencoders project?')
  assert.ok(terms.includes('autoencoders'), 'keeps the real entity')
  for (const stop of ['when', 'did', 'i', 'last', 'the']) {
    assert.ok(!terms.includes(stop), `drops stopword "${stop}"`)
  }
})

test('deterministicTerms reduces a vague NL query to its content word', () => {
  assert.deepEqual(deterministicTerms('show me everything about the migration'), ['migration'])
})

test('deterministicTerms dedupes and caps at 6', () => {
  const terms = deterministicTerms('alpha alpha beta gamma delta epsilon zeta eta theta')
  assert.equal(new Set(terms).size, terms.length)
  assert.ok(terms.length <= 6)
})

test('isLiteralQuery: short or no-question stays on the instant keyword path', () => {
  assert.equal(isLiteralQuery('cursor'), true)
  assert.equal(isLiteralQuery('cursor refactor today'), true)
  assert.equal(isLiteralQuery('what did I do today?'), false) // question mark
  assert.equal(isLiteralQuery('when was I most focused this week'), false) // 4+ tokens
})

test('mergeByTermHits ranks by term-hit count, then recency', () => {
  const r = (type: string, id: string | number, startTime: number) => ({ type, id, startTime }) as never
  const batchA = [r('session', 1, 100), r('block', 'b', 200)]
  const batchB = [r('session', 1, 100), r('browser', 9, 300)]
  const merged = mergeByTermHits([batchA, batchB], 10) as Array<{ type: string; id: string | number }>
  // session:1 matched both terms (hits=2) → first; then by recency browser(300) > block(200).
  assert.deepEqual(merged.map((m) => `${m.type}:${m.id}`), ['session:1', 'browser:9', 'block:b'])
})

test('mergeByTermHits respects the limit', () => {
  const r = (id: number) => ({ type: 'session', id, startTime: id }) as never
  const merged = mergeByTermHits([[r(1), r(2), r(3), r(4)]], 2)
  assert.equal(merged.length, 2)
})
