// LLM judge — second Claude call that grades the assistant's answer against
// a gold_answer_shape (primary) and a rubric (secondary), with the full tool
// trace as authoritative evidence. Returns a structured verdict, never crashes
// the run on a soft fail; treats network errors as `error`.

import Anthropic from '@anthropic-ai/sdk'
import type { ScenarioRubric, ScenarioRecord } from './types'

export interface JudgeVerdict {
  scenarioId: string
  grade: 'good' | 'bad' | 'worse' | 'error'
  reason: string
  citationsFound: boolean
  hallucinationDetected: boolean
  voiceOk: boolean
  matchesGoldShape: boolean
  rawJudgeOutput: string
}

const JUDGE_SYSTEM = `You are a strict QA judge for the Daylens activity-tracker AI.

You will be given:
- A user question
- A "gold_answer_shape" describing what a colleague who had been watching the user work all week would say in 2-4 sentences when asked the same question — this is the PRIMARY grading bar
- The assistant's verbatim answer
- A structured rubric of must-haves (secondary signal — useful guardrails)
- A compact summary of the relevant DB ground truth (what we know exists)
- The full tool-call trace: every tool the model called, with its INPUT and OUTPUT, in order

CRITICAL — what counts as evidence:
The TRACE is authoritative. If a number, block label, app name, page title, or domain appears in any tool OUTPUT, the model was entitled to cite it — that is NOT a hallucination, even if the ground-truth summary doesn't list it (ground truth is a compact summary and may omit things the tools returned). Treat ground truth as supplementary. A claim is a hallucination ONLY if the cited value appears in neither the trace nor ground truth.

CRITICAL — what makes an answer good:
The bar is NOT "the answer matches the DB." The bar is: would a colleague who watched the user work this week answer it the same way? A factually correct answer that fails to reveal understanding is a FAIL. "3h in Cursor" when the truth is "3h finishing the chat refactor in Cursor" — FAIL. App totals as the headline — FAIL. The answer must name the ACTIVITY, not just the app.

Grade the answer on these axes, in priority order:

1. **Matches the gold_answer_shape** — does the answer reveal the same understanding a colleague would? Does it name the activity, connect the dots, pinpoint the moment, surface the closest signal? This is the primary bar.

2. **Activity, not app** — the answer must name what the user was DOING (refactor, debug, course reading, meeting), not just which apps were open. App totals are evidence, never the headline.

3. **Minute-level precision** — if the user asked about a moment, day, or block, time ranges and durations must match the tool output to the minute. "09:09–10:08" if that's what the tool returned. Inventing sub-block durations not in tool output is a fail.

4. **Time awareness** — future-moment questions ("today at 4pm" when it's 11:37) must acknowledge the moment hasn't happened. Pre-tracking dates must name the tracking start date and offer the closest available data. Never bare-refuse.

5. **Faithfulness vs trace** — every concrete claim (number, label, domain, person, file, time range) must appear in the tool trace or ground truth. Quoting a block label that appears in tool output verbatim is grounded, even if the label looks unusual.

6. **Voice** — banned phrases include: "great work", "you crushed it", "let's dive in", "dive into", "elevate", "seamless", "navigate the landscape", "in today's fast-paced world", "harness the power", "you've got this", "fascinating perspective". Exclamation marks fail. Motivational filler fails. Generic openers fail. Bare refusals ("I don't know", "I can't see that") fail — surface the closest captured signal instead.

The rubric flags are secondary signal — useful guardrails for specific failure modes, but they do not override the gold_answer_shape. An answer can pass every rubric flag and still be a fail if it doesn't reveal understanding the way the gold shape describes.

Output STRICT JSON with this exact shape, no markdown, no code fence:

{"grade":"good"|"bad"|"worse","reason":"one sentence pointing at the worst flaw, or what made it good","citations_found":true|false,"hallucination_detected":true|false,"voice_ok":true|false,"matches_gold_shape":true|false}

- good = matches the gold_answer_shape, names activity not just app, hits minute precision, clean voice, cited evidence
- bad = partial: shape mostly right but vague; voice slips; app-totals leak in; paraphrased timestamps; no outright fabrication
- worse = misses the shape entirely; fabrication (value appears in neither trace nor ground truth); bare refusal when data exists; broken output; motivational filler`

export async function judgeAnswer(
  scenario: ScenarioRecord,
  assistantText: string,
  groundTruthSummary: string,
  apiKey: string,
  traceSummary?: string,
): Promise<JudgeVerdict> {
  const userPrompt = [
    `Question: ${scenario.question}`,
    '',
    'Gold answer shape (PRIMARY bar — what a colleague who watched the user work would say):',
    scenario.gold_answer_shape?.trim() || '(no gold shape provided — grade against the rubric only)',
    '',
    'Rubric flags (secondary — specific guardrails the engineer wants enforced):',
    JSON.stringify(scenario.rubric, null, 2),
    '',
    'Compact DB ground-truth summary:',
    groundTruthSummary,
    '',
    traceSummary ? 'Tool-call trace (what the model actually saw — authoritative):' : null,
    traceSummary ?? null,
    traceSummary ? '' : null,
    'Assistant answer (verbatim):',
    assistantText,
    '',
    'Return the JSON verdict only.',
  ].filter((line): line is string => line !== null).join('\n')

  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      system: JUDGE_SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const raw = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()

    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return {
        scenarioId: scenario.id,
        grade: 'error',
        reason: `judge returned non-JSON: ${raw.slice(0, 120)}`,
        citationsFound: false,
        hallucinationDetected: false,
        voiceOk: false,
        matchesGoldShape: false,
        rawJudgeOutput: raw,
      }
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      grade?: 'good' | 'bad' | 'worse'
      reason?: string
      citations_found?: boolean
      hallucination_detected?: boolean
      voice_ok?: boolean
      matches_gold_shape?: boolean
    }

    return {
      scenarioId: scenario.id,
      grade: parsed.grade ?? 'error',
      reason: parsed.reason ?? '(no reason given)',
      citationsFound: Boolean(parsed.citations_found),
      hallucinationDetected: Boolean(parsed.hallucination_detected),
      voiceOk: Boolean(parsed.voice_ok),
      matchesGoldShape: Boolean(parsed.matches_gold_shape),
      rawJudgeOutput: raw,
    }
  } catch (error) {
    return {
      scenarioId: scenario.id,
      grade: 'error',
      reason: error instanceof Error ? error.message : String(error),
      citationsFound: false,
      hallucinationDetected: false,
      voiceOk: false,
      matchesGoldShape: false,
      rawJudgeOutput: '',
    }
  }
}

// Local helper type re-exports so the runner only needs to import one module.
export type { ScenarioRubric, ScenarioRecord } from './types'
