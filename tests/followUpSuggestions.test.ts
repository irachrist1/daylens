import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDeterministicFollowUpCandidates,
  buildFollowUpSuggestionPrompts,
  classifyQuestionShape,
  filterFollowUpCandidatesWithReport,
  parseFollowUpSuggestions,
} from '../src/main/lib/followUpSuggestions.ts'
import type { FollowUpSuggestion } from '../src/shared/types.ts'

const fallback: FollowUpSuggestion[] = [
  { text: 'What drove this result?', source: 'deterministic' },
  { text: 'How did the day break down?', source: 'deterministic' },
]

// ── Named-entity filter ────────────────────────────────────────────────────

test('accepts suggestions naming specific apps — returns model results', () => {
  // Needs >= 2 model suggestions to avoid falling back to deterministic
  const raw = JSON.stringify({ suggestions: ['How much time in Cursor?', 'Which Figma files appeared?'] })
  const result = parseFollowUpSuggestions(raw, fallback)
  assert.ok(result.some((s) => s.source === 'model'))
  assert.ok(result.some((s) => s.text.includes('Cursor') || s.text.includes('Figma')))
})

test('accepts suggestions naming specific files — returns model results', () => {
  const raw = JSON.stringify({ suggestions: ['What changed in index.ts?', 'How long editing schema.sql?'] })
  const result = parseFollowUpSuggestions(raw, fallback)
  assert.ok(result.some((s) => s.source === 'model'))
})

test('rejects entity-free "What stood out most?" — falls back to deterministic', () => {
  const raw = JSON.stringify({ suggestions: ['What stood out most?'] })
  const result = parseFollowUpSuggestions(raw, fallback)
  // Only 1 model suggestion filtered out → not enough → falls back
  assert.ok(result.every((s) => s.source === 'deterministic'))
})

test('rejects "Tell me more" as generic', () => {
  const raw = JSON.stringify({ suggestions: ['Tell me more', 'Go on'] })
  const result = parseFollowUpSuggestions(raw, fallback)
  assert.ok(result.every((s) => s.source === 'deterministic'))
})

test('rejects mix of entity-free suggestions, keeps only named-entity ones', () => {
  const raw = JSON.stringify({
    suggestions: [
      'Tell me more',
      'Which Notion pages appeared?',
      'Can you be more specific',
      'How long in Figma?',
    ],
  })
  const result = parseFollowUpSuggestions(raw, fallback)
  const modelResults = result.filter((s) => s.source === 'model')
  assert.ok(modelResults.length >= 2)
  assert.ok(modelResults.every((s) => /Notion|Figma/.test(s.text)))
})

// ── System prompt requirements ─────────────────────────────────────────────

test('system prompt instructs model to name a specific entity', () => {
  const { systemPrompt } = buildFollowUpSuggestionPrompts('test', 'test answer', null, fallback)
  assert.ok(
    systemPrompt.toLowerCase().includes('specific app') ||
    systemPrompt.toLowerCase().includes('named') ||
    systemPrompt.toLowerCase().includes('entity'),
  )
})

test('system prompt forbids entity-free suggestions', () => {
  const { systemPrompt } = buildFollowUpSuggestionPrompts('test', 'test answer', null, fallback)
  assert.ok(
    systemPrompt.includes('Tell me more') ||
    systemPrompt.includes('entity-free'),
  )
})

// ── Temporal stop-word filter ──────────────────────────────────────────────

test('rejects "What drove Today?" — temporal word in entity slot', () => {
  const raw = JSON.stringify({ suggestions: ['What drove Today?', 'Which windows mention Today?'] })
  const result = parseFollowUpSuggestions(raw, fallback)
  assert.ok(result.every((s) => s.source === 'deterministic'), 'temporal words must not pass as entities')
})

test('rejects "What overlapped with Yesterday?" — temporal word in entity slot', () => {
  const raw = JSON.stringify({ suggestions: ['What overlapped with Yesterday?', 'How long on Monday?'] })
  const result = parseFollowUpSuggestions(raw, fallback)
  assert.ok(result.every((s) => s.source === 'deterministic'), 'day-of-week must not pass as entities')
})

test('rejects "What happened this Morning?" — time-of-day in entity slot', () => {
  const raw = JSON.stringify({ suggestions: ['What happened this Morning?', 'What happened this Evening?'] })
  const result = parseFollowUpSuggestions(raw, fallback)
  assert.ok(result.every((s) => s.source === 'deterministic'), 'time-of-day words must not pass as entities')
})

test('deterministic fallback suggestions name an answer entity', () => {
  const result = buildDeterministicFollowUpCandidates(
    'deterministic_stats',
    null,
    'From your app sessions today, Cursor accounted for 2h 10m.',
  )
  assert.ok(result.length >= 2)
  assert.ok(result.every((suggestion) => suggestion.text.includes('Cursor')))
})

// ── Two-stage P0 filter ───────────────────────────────────────────────────

test('filter rejects temporal words', () => {
  const report = filterFollowUpCandidatesWithReport('Cursor accounted for 2h.', [
    { text: 'Compare Cursor with yesterday', source: 'deterministic' },
  ], 'time')
  assert.equal(report.suggestions.length, 0)
  assert.equal(report.rejectedByRule.temporal, 1)
})

test('filter rejects generic verbs', () => {
  const report = filterFollowUpCandidatesWithReport('Cursor accounted for 2h.', [
    { text: 'Tell me more', source: 'model' },
  ], 'time')
  assert.equal(report.suggestions.length, 0)
  assert.equal(report.rejectedByRule.invalid + report.rejectedByRule.generic, 1)
})

test('filter requires a named entity from the answer', () => {
  const report = filterFollowUpCandidatesWithReport('Cursor accounted for 2h.', [
    { text: 'Which Notion pages appeared?', source: 'model' },
  ], 'time')
  assert.equal(report.suggestions.length, 0)
  assert.equal(report.rejectedByRule.entity, 1)
})

test('filter accepts an entity-backed different-shape chip', () => {
  const report = filterFollowUpCandidatesWithReport('Cursor accounted for 2h in daylens.', [
    { text: 'Which windows mention Cursor?', source: 'deterministic' },
  ], 'time')
  assert.deepEqual(report.suggestions.map((item) => item.text), ['Which windows mention Cursor?'])
})

test('filter suppresses the just-answered shape', () => {
  const report = filterFollowUpCandidatesWithReport('Cursor accounted for 2h.', [
    { text: 'How long in Cursor?', source: 'model' },
  ], 'time')
  assert.equal(report.suggestions.length, 0)
  assert.equal(report.rejectedByRule.shape, 1)
})

test('filter allows empty suggestions when every chip is rejected', () => {
  const report = filterFollowUpCandidatesWithReport('No named evidence here.', [
    { text: 'Tell me more', source: 'model' },
    { text: 'Compare that with yesterday', source: 'deterministic' },
  ], 'reflective')
  assert.deepEqual(report.suggestions, [])
})

test('filter keeps at most one chip per shape', () => {
  const report = filterFollowUpCandidatesWithReport('Cursor and GitHub appeared in the answer.', [
    { text: 'Which windows mention Cursor?', source: 'model' },
    { text: 'Which pages mention GitHub?', source: 'model' },
  ], 'time')
  assert.equal(report.suggestions.length, 1)
  assert.equal(report.rejectedByRule.shape, 1)
})

test('question shape classifier covers the five taxonomy families', () => {
  assert.equal(classifyQuestionShape('How long was I in Cursor?'), 'time')
  assert.equal(classifyQuestionShape('Show me every block where I touched Daylens.'), 'specific_work')
  assert.equal(classifyQuestionShape('Which projects are losing momentum?'), 'cross_cutting')
  assert.equal(classifyQuestionShape('Was Tuesday a deep day?'), 'reflective')
  assert.equal(classifyQuestionShape('Draft a short status update.'), 'generative')
})
