import test from 'node:test'
import assert from 'node:assert/strict'
import {
  detectRequestedFormats,
  formatDisplayName,
  looksLikeBareFormatRequest,
} from '../src/main/lib/reportFormats.ts'

test('detects the named document format', () => {
  assert.deepEqual(detectRequestedFormats('in word please?'), ['docx'])
  assert.deepEqual(detectRequestedFormats('can I get that as a pdf'), ['pdf'])
  assert.deepEqual(detectRequestedFormats('markdown version'), ['markdown'])
  assert.deepEqual(detectRequestedFormats('export it as html'), ['html'])
  assert.deepEqual(detectRequestedFormats('a .docx would be great'), ['docx'])
})

test('detects multiple formats and de-dupes', () => {
  assert.deepEqual(detectRequestedFormats('give me word and pdf'), ['pdf', 'docx'])
  assert.deepEqual(detectRequestedFormats('word doc, a Word file'), ['docx'])
})

test('names no format when the user names none', () => {
  assert.deepEqual(detectRequestedFormats('what did I work on today?'), [])
  assert.deepEqual(detectRequestedFormats('turn into a report'), [])
})

test('a bare format ask is a re-export of the last answer', () => {
  // The exact screenshot case that used to dead-end with "no Word export".
  assert.equal(looksLikeBareFormatRequest('in word please?'), true)
  assert.equal(looksLikeBareFormatRequest('pdf version'), true)
  assert.equal(looksLikeBareFormatRequest('as markdown'), true)
  assert.equal(looksLikeBareFormatRequest('can I get that in word'), true)
  assert.equal(looksLikeBareFormatRequest('word doc please'), true)
})

test('a fresh report request (names a time period) is NOT a re-export', () => {
  assert.equal(looksLikeBareFormatRequest('make me a word report of last week'), false)
  assert.equal(looksLikeBareFormatRequest('pdf of today'), false)
  assert.equal(looksLikeBareFormatRequest('a word doc of my day'), false)
})

test('a message that names no format is never a re-export', () => {
  assert.equal(looksLikeBareFormatRequest('what did I do today?'), false)
  assert.equal(looksLikeBareFormatRequest('summarize my week'), false)
})

test('format display names read naturally for the chat line', () => {
  assert.equal(formatDisplayName('docx'), 'a Word doc')
  assert.equal(formatDisplayName('pdf'), 'a PDF')
  assert.equal(formatDisplayName('markdown'), 'a Markdown file')
  assert.equal(formatDisplayName('html'), 'an HTML page')
})
