import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fallbackGeneratedReportContent,
  isUserFacingReportMarkdown,
  parseGeneratedReportResult,
} from '../src/main/lib/dayReportFallback.ts'

function makeBundle() {
  return {
    title: 'Day report 2026-05-04',
    scopeLabel: '2026-05-04',
    assistantScaffold: '',
    reportMarkdownScaffold: '',
    tableColumns: ['start', 'end', 'block', 'category', 'apps', 'artifacts', 'duration'],
    tableRows: [
      { start: '7:18 AM', end: '7:56 AM', block: 'Building & Testing', category: 'development', apps: 'Ghostty', artifacts: 'n/a', duration: '37m' },
      { start: '9:28 AM', end: '10:28 AM', block: 'Andersen in Rwanda: Company Page Admin | LinkedIn', category: 'browsing', apps: 'Dia', artifacts: 'n/a', duration: '1h 0m' },
      { start: '3:56 PM', end: '4:56 PM', block: 'Scott Galloway: AI CEO’s Are Lying To You - YouTube', category: 'productivity', apps: 'Excel', artifacts: 'n/a', duration: '1h 0m' },
    ],
    chartRows: [
      { label: 'aiTools', value: 2.3 },
      { label: 'development', value: 1.4 },
      { label: 'browsing', value: 1.1 },
    ],
    chartValueLabel: 'hours',
  }
}

test('fallbackGeneratedReportContent creates a user-facing report, not raw evidence preview', () => {
  const report = fallbackGeneratedReportContent(makeBundle() as never)
  assert.match(report.assistantResponse, /grounded report/)
  assert.match(report.reportMarkdown, /## What happened/)
  assert.match(report.reportMarkdown, /## Evidence used/)
  assert.doesNotMatch(report.reportMarkdown, /Evidence Preview/)
  assert.doesNotMatch(report.reportMarkdown, /start: .*end: .*block:/i)
  assert.doesNotMatch(report.reportMarkdown, /Andersen in Rwanda: Company Page Admin \| LinkedIn/)
  assert.doesNotMatch(report.reportMarkdown, /Scott Galloway.*YouTube/)
})

test('fallbackGeneratedReportContent does not render literal "undefined" when tableRows lack start/end (B6)', () => {
  const weeklyBundle = {
    title: 'Week review 2026-05-13',
    scopeLabel: 'the past week',
    assistantScaffold: '',
    reportMarkdownScaffold: '',
    tableColumns: ['day', 'block', 'category', 'duration'],
    tableRows: [
      { day: '2026-05-11', block: 'Daylens AI rework', category: 'development', duration: '3h 12m' },
      { day: '2026-05-12', block: 'Apps view redesign', category: 'design', duration: '1h 40m' },
    ],
    chartRows: [
      { label: 'development', value: 8.4 },
      { label: 'design', value: 2.1 },
    ],
    chartValueLabel: 'hours',
  }
  const report = fallbackGeneratedReportContent(weeklyBundle as never)
  assert.doesNotMatch(report.reportMarkdown, /undefined/i)
  assert.match(report.reportMarkdown, /tracked activity over the past week/)
})

test('fallbackGeneratedReportContent keeps explicit window when start/end exist', () => {
  const dayBundle = {
    title: 'Day report 2026-05-04',
    scopeLabel: '2026-05-04',
    assistantScaffold: '',
    reportMarkdownScaffold: '',
    tableColumns: ['start', 'end', 'block', 'category', 'duration'],
    tableRows: [
      { start: '7:18 AM', end: '7:56 AM', block: 'Building & Testing', category: 'development', duration: '37m' },
      { start: '9:28 AM', end: '10:28 AM', block: 'Coursework reading', category: 'research', duration: '1h 0m' },
    ],
    chartRows: [{ label: 'development', value: 0.6 }],
    chartValueLabel: 'hours',
  }
  const report = fallbackGeneratedReportContent(dayBundle as never)
  assert.match(report.reportMarkdown, /tracked activity from 7:18 AM to 10:28 AM/)
})

test('parseGeneratedReportResult rejects malformed raw evidence output', () => {
  const parsed = parseGeneratedReportResult(JSON.stringify({
    assistantResponse: 'I generated a report.',
    reportTitle: 'Day report 2026-05-04',
    reportMarkdown: '# Day report\n\n## Evidence Preview\n- start: 9:28 AM • end: 10:28 AM • block: Raw title • category: browsing',
  }), 'Day report 2026-05-04')
  assert.equal(parsed, null)
})

test('isUserFacingReportMarkdown accepts human report prose', () => {
  assert.equal(isUserFacingReportMarkdown([
    '# Day report',
    '',
    'Today was mixed, with development early and browser-heavy work later. ChatGPT carried part of the day, but YouTube also took a meaningful share.',
  ].join('\n')), true)
})
