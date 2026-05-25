import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldUseRouter } from '../src/main/lib/insightsQueryRouter.ts'

// ── Five that SHOULD use the router (pure numeric lookups) ─────────────────

test('routes "how long on Figma today?"', () => {
  assert.equal(shouldUseRouter('How long on Figma today?'), true)
})

test('routes "how much time on Cursor this week?"', () => {
  assert.equal(shouldUseRouter('How much time on Cursor this week?'), true)
})

test('routes "what\'s my focus score today?"', () => {
  assert.equal(shouldUseRouter("What's my focus score today?"), true)
})

test('routes "how many hours did I work today?"', () => {
  assert.equal(shouldUseRouter('How many hours did I work today?'), true)
})

test('routes "how many sessions in Slack this week?"', () => {
  assert.equal(shouldUseRouter('How many sessions in Slack this week?'), true)
})

// ── Five that should NOT use the router (open-ended synthesis) ─────────────

test('does not route "what did I do today?"', () => {
  assert.equal(shouldUseRouter('What did I do today?'), false)
})

// ── Regression coverage for two real-world failures ────────────────────────
// Time-at-moment and client-list prompts used to fall through to the LLM,
// which has no `getBlockAtTime` or `listClients` tool and would hallucinate
// a limitation. Both now route deterministically.

test('routes "what did I do today at 4 p.m., exactly?" (time-at-moment)', () => {
  assert.equal(shouldUseRouter('What did I do today at 4 p.m., exactly?'), true)
})

test('routes "what was I doing at 10:30am?" (time-at-moment, 24h-ish)', () => {
  assert.equal(shouldUseRouter('What was I doing at 10:30am?'), true)
})

test('routes "what happened yesterday at 3pm?" (time-at-moment on prior day)', () => {
  assert.equal(shouldUseRouter('What happened yesterday at 3pm?'), true)
})

test('routes "who are my clients" (client-list)', () => {
  assert.equal(shouldUseRouter('who are my clients'), true)
})

test('routes "list all my clients this month" (client-list with time modifier)', () => {
  assert.equal(shouldUseRouter('list all my clients this month'), true)
})

test('routes "which files did I touch this morning?" to local evidence lookup', () => {
  assert.equal(shouldUseRouter('Which files did I touch this morning?'), true)
})

test('does not route "summarize my Monday"', () => {
  assert.equal(shouldUseRouter('Summarize my Monday.'), false)
})

test('does not route "compare my coding time this week vs last week"', () => {
  assert.equal(shouldUseRouter('Compare my coding time this week vs last week.'), false)
})

test('does not route "how did my focus go this afternoon?"', () => {
  assert.equal(shouldUseRouter('How did my focus go this afternoon?'), false)
})
