// Q6 — structural guardrail for the answer-quality eval program. Hermetic and
// free (no provider calls): it locks in that the eval set stays well-formed and
// keeps covering every question family the spec + AI-PRODUCT-DIRECTION require,
// so a future edit can't silently drop "files", "meta", or the follow-up guard.
//
// The live, graded run is `npm run test:behaviour` (bills the API; per provider
// via DAYLENS_EVAL_PROVIDER) — that part is intentionally not in CI.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { JUDGE_SYSTEM } from './ai-behaviour/judge.ts'
import type { ScenarioRecord } from './ai-behaviour/types.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))

function loadScenarios(): ScenarioRecord[] {
  const doc = yaml.load(fs.readFileSync(path.join(HERE, 'ai-behaviour', 'scenarios.yaml'), 'utf8')) as {
    scenarios: ScenarioRecord[]
  }
  return doc.scenarios
}

// Question families the program must always cover (Q6 lists: today / this-week /
// by-project / by-app / by-client / files / focus / who-are-my-clients / meta,
// plus consistency and a hallucination trap).
const REQUIRED_FAMILIES = [
  'client_attribution', // who are my clients
  'time_at_moment',     // today at 4pm
  'specific_work',      // by project (e.g. Daylens this week)
  'time_and_duration',  // focus / by app / this week
  'generative',         // reports, status updates
  'reflective',         // deep-work pattern
  'hallucination_trap', // fabrication guard
  'files',              // Q2 — files != pages
  'meta',               // Q3 — identity + follow-ups
  'consistency',        // Q1 — one grounded number
]

test('eval set is well-formed (id/question/family/gold/rubric, unique ids)', () => {
  const scenarios = loadScenarios()
  assert.ok(scenarios.length >= 10, 'expected a substantive eval set')
  const ids = new Set<string>()
  for (const s of scenarios) {
    assert.ok(s.id, 'scenario missing id')
    assert.ok(!ids.has(s.id), `duplicate scenario id: ${s.id}`)
    ids.add(s.id)
    assert.ok(s.question?.trim(), `${s.id}: missing question`)
    assert.ok(s.family?.trim(), `${s.id}: missing family`)
    assert.ok((s.gold_answer_shape ?? '').trim().length > 20, `${s.id}: gold_answer_shape too thin`)
    assert.ok(s.rubric && Object.keys(s.rubric).length > 0, `${s.id}: empty rubric`)
  }
})

test('eval set covers every required question family', () => {
  const families = new Set(loadScenarios().map((s) => s.family))
  for (const fam of REQUIRED_FAMILIES) {
    assert.ok(families.has(fam), `eval set is missing a scenario for family: ${fam}`)
  }
})

test('the meta scenario guards templated follow-ups (Q3)', () => {
  const meta = loadScenarios().find((s) => s.family === 'meta')
  assert.ok(meta, 'no meta scenario in the eval set')
  assert.equal(meta?.rubric.follow_ups_must_not_template_meta_entity, true)
})

test('judge rubric documents the gold-answer-bar axes', () => {
  for (const axis of ['Activity, not app', 'Minute-level precision', 'Follow-up suggestion', 'gold_answer_shape']) {
    assert.ok(JUDGE_SYSTEM.includes(axis), `judge system prompt is missing the "${axis}" axis`)
  }
})
