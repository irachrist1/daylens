import test from 'node:test'
import assert from 'node:assert/strict'
import * as dayReportFallback from '../src/main/lib/dayReportFallback.ts'

const { isUserFacingReportMarkdown, parseGeneratedReportResult } = dayReportFallback

test('parseGeneratedReportResult accepts a well-formed model report', () => {
  const parsed = parseGeneratedReportResult(JSON.stringify({
    assistantResponse: 'Here is the report for 2026-05-04.',
    reportTitle: 'Day report 2026-05-04',
    reportMarkdown: [
      '# Day report 2026-05-04',
      '',
      'The morning went to Daylens development in the editor, with a long Building & Testing stretch before lunch and admin work in the afternoon.',
    ].join('\n'),
  }), 'Day report 2026-05-04')
  assert.ok(parsed)
  assert.equal(parsed.reportTitle, 'Day report 2026-05-04')
  assert.match(parsed.reportMarkdown, /Building & Testing/)
})

test('parseGeneratedReportResult rejects malformed raw evidence output', () => {
  const parsed = parseGeneratedReportResult(JSON.stringify({
    assistantResponse: 'I generated a report.',
    reportTitle: 'Day report 2026-05-04',
    reportMarkdown: '# Day report\n\n## Evidence Preview\n- start: 9:28 AM • end: 10:28 AM • block: Raw title • category: browsing',
  }), 'Day report 2026-05-04')
  assert.equal(parsed, null)
})

test('parseGeneratedReportResult rejects non-JSON output (the caller must surface an honest error)', () => {
  assert.equal(parseGeneratedReportResult('Sorry, something went wrong upstream', 'Day report'), null)
  assert.equal(parseGeneratedReportResult('', 'Day report'), null)
})

test('isUserFacingReportMarkdown accepts human report prose', () => {
  assert.equal(isUserFacingReportMarkdown([
    '# Day report',
    '',
    'Today was mixed, with development early and browser-heavy work later. ChatGPT carried part of the day, but YouTube also took a meaningful share.',
  ].join('\n')), true)
})

// No fake AI: the templated "report" that used to be presented as an AI
// answer when the model call failed must stay deleted. If someone reintroduces
// it, the chat report path is at risk of showing text no model produced.
test('the fake-AI fallback report template stays deleted', () => {
  assert.equal((dayReportFallback as Record<string, unknown>).fallbackGeneratedReportContent, undefined)
})
