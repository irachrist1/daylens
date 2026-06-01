import test from 'node:test'
import assert from 'node:assert/strict'
import {
  dedupeAndRankResults,
  isNaturalQuery,
  searchResultSourceKind,
  searchResultSubtitle,
  searchResultTitle,
} from '../src/renderer/lib/searchResults.ts'
import type { DaylensSearchResult } from '../src/preload/index.ts'

function browser(domain: string, pageTitle: string | null, startTime: number, url: string | null = null): DaylensSearchResult {
  return { type: 'browser', id: Math.round(startTime), domain, pageTitle, url, startTime, endTime: startTime + 1000, date: '2026-06-01', excerpt: '' }
}
function session(appName: string, windowTitle: string | null, startTime: number): DaylensSearchResult {
  return { type: 'session', id: Math.round(startTime), appName, windowTitle, startTime, endTime: startTime + 1000, date: '2026-06-01', excerpt: '' }
}

// FB2: search lives in ⌘K — short/literal queries are instant FTS, longer/
// question-shaped queries route to the natural-language interpreter.
test('isNaturalQuery: short literal queries are not natural', () => {
  assert.equal(isNaturalQuery('canvas'), false)
  assert.equal(isNaturalQuery('intro ml'), false)
  assert.equal(isNaturalQuery('the canvas link'), false)
})

test('isNaturalQuery: question-shaped or long queries are natural', () => {
  assert.equal(isNaturalQuery('the link for canvas?'), true)
  assert.equal(isNaturalQuery('intro to ml course deadline'), true)
  assert.equal(isNaturalQuery('what did I read about transformers'), true)
})

test('row metadata maps each result type to a source/title/subtitle', () => {
  assert.equal(searchResultSourceKind(browser('canvas.instructure.com', 'Canvas', 1)), 'web')
  assert.equal(searchResultSourceKind(session('Cursor', 'index.ts', 1)), 'app')
  assert.equal(searchResultTitle(browser('x.com', 'Home', 1)), 'Home')
  assert.equal(searchResultSubtitle(session('Cursor', null, 1)), 'Cursor')
})

test('dedupeAndRankResults collapses near-identical rows, keeping the most recent', () => {
  const results = [
    browser('canvas.instructure.com', 'Canvas Dashboard', 100),
    browser('canvas.instructure.com', 'Canvas Dashboard', 300),
    browser('canvas.instructure.com', 'Canvas Dashboard', 200),
  ]
  const ranked = dedupeAndRankResults(results, 'canvas')
  assert.equal(ranked.length, 1, 'three near-dupes collapse to one')
  assert.equal(ranked[0].startTime, 300, 'keeps the most recent')
})

test('dedupeAndRankResults ranks an exact domain/title match above a newer fuzzy match', () => {
  const results = [
    browser('notion.so', 'Some unrelated page', 999),
    browser('canvas.instructure.com', 'canvas', 100),
  ]
  const ranked = dedupeAndRankResults(results, 'canvas')
  assert.equal(searchResultTitle(ranked[0]), 'canvas', 'exact title match ranks first despite being older')
})
