// Behavioural harness — runs real scenarios against the real Daylens
// pipeline using a read-only copy of the user's actual DB plus the Anthropic
// key from keytar. Each scenario is graded by a second Claude call and
// printed live in the terminal so you can see, scenario by scenario:
//
//   - the question
//   - the assistant's verbatim answer
//   - the router/source path taken (deterministic vs LLM)
//   - the judge's verdict and reason
//
// Final results are written to .ai-behaviour/results-<stamp>.json for diff.
//
// Run with:
//   npm run test:behaviour
//
// This must run inside Electron (ELECTRON_RUN_AS_NODE=1) so getApiKey() can
// reach keytar and so getDb() can talk to better-sqlite3.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const HERE = path.dirname(fileURLToPath(import.meta.url))
import { stageReadOnlyCopyOfRealDb, cleanupRealDbCopy } from './realDb'
import type { ScenarioRecord } from './types'

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
}

function color(c: keyof typeof ANSI, s: string): string {
  return process.stdout.isTTY ? `${ANSI[c]}${s}${ANSI.reset}` : s
}

// Read the per-scenario trace JSON the trace recorder writes during
// sendMessage, and produce a compact text summary the judge can use as
// authoritative evidence. The judge needs to see every tool input/output
// so it does not flag real block labels as hallucinations.
function summarizeTraceForJudge(tracePath: string): string | undefined {
  if (!fs.existsSync(tracePath)) return undefined
  let raw: string
  try {
    raw = fs.readFileSync(tracePath, 'utf8')
  } catch {
    return undefined
  }
  let trace: { events?: Array<Record<string, unknown>> }
  try {
    trace = JSON.parse(raw) as { events?: Array<Record<string, unknown>> }
  } catch {
    return undefined
  }
  const events = trace.events ?? []
  const lines: string[] = []
  for (const event of events) {
    const kind = event.kind as string | undefined
    if (kind === 'tool_result') {
      const name = event.name as string
      const input = JSON.stringify(event.input ?? {})
      // Truncate output JSON to keep the judge prompt under control, but
      // preserve enough that block labels, durations, and domain strings
      // are visible.
      const outputStr = JSON.stringify(event.output ?? null)
      const outputPreview = outputStr.length > 1800 ? `${outputStr.slice(0, 1800)}…(truncated)` : outputStr
      lines.push(`TOOL ${name}(${input}) → ${outputPreview}`)
    } else if (kind === 'router') {
      lines.push(`ROUTER matched=${event.matched} reason=${event.reason}`)
    } else if (kind === 'router_decision') {
      // The deterministic router produced this verbatim structured answer.
      // The prose-pass rewrites it into natural language. Anything quoted
      // from this block — durations, app names, block labels — is grounded.
      const sa = ((event.structuredAnswer as string) ?? '').trim()
      const preview = sa.length > 1500 ? `${sa.slice(0, 1500)}…` : sa
      lines.push(`ROUTER_DECISION routedKind=${event.routedKind} hasTimeWindow=${event.hasTimeWindow}\nSTRUCTURED_ANSWER (authoritative — treat as tool output for grounding):\n${preview}`)
    } else if (kind === 'prose_pass') {
      // Shows the prose-pass rewrite and whether it was rejected (timestamp
      // drift, empty, error) — in which case the structured answer above
      // was returned to the user verbatim.
      const out = ((event.output as string) ?? '').trim()
      const fallback = event.fallback as string | undefined
      const preview = out.length > 600 ? `${out.slice(0, 600)}…` : out
      lines.push(`PROSE_PASS${fallback ? ` fallback=${fallback}` : ''} → ${preview}`)
    } else if (kind === 'turn') {
      const text = ((event.text as string) ?? '').trim()
      if (text) {
        const preview = text.length > 300 ? `${text.slice(0, 300)}…` : text
        lines.push(`MODEL_TURN_TEXT: ${preview}`)
      }
    }
  }
  if (lines.length === 0) return undefined
  // Cap the whole summary so the judge call stays within token budget.
  const joined = lines.join('\n')
  if (joined.length > 12000) {
    return `${joined.slice(0, 12000)}\n(trace truncated for judge)`
  }
  return joined
}

function loadScenarios(): ScenarioRecord[] {
  const yamlPath = path.join(HERE, 'scenarios.yaml')
  const doc = yaml.load(fs.readFileSync(yamlPath, 'utf8')) as { scenarios: ScenarioRecord[] }
  return doc.scenarios
}

async function main(): Promise<void> {
  console.log(color('bold', '\n=== Daylens AI behavioural harness ===\n'))

  // Wire full traces. sendMessage will write per-scenario trace JSON files
  // into this directory so the engineer can see exactly what the model saw.
  const runStamp = new Date().toISOString().replace(/[:.]/g, '-')
  const traceDir = path.join(process.cwd(), '.ai-behaviour', `traces-${runStamp}`)
  fs.mkdirSync(traceDir, { recursive: true })
  process.env.DAYLENS_AI_TRACE_DIR = traceDir
  console.log(color('dim', `[setup] trace dir: ${traceDir}`))

  // 1. Stage read-only copy of the real DB BEFORE initDb runs. setPath()
  //    must be set before any module that calls app.getPath('userData').
  const dbCtx = stageReadOnlyCopyOfRealDb()
  console.log(color('dim', `[setup] real DB copy: ${dbCtx.copiedDbPath}`))

  // 2. Now we can import modules that touch the DB.
  const { initDb } = await import('../../src/main/services/database')
  initDb()
  console.log(color('dim', '[setup] DB initialised against the copy'))

  // 3. Load the Anthropic key from keytar (the same place Daylens stores it).
  const { getApiKey } = await import('../../src/main/services/settings')
  const apiKey = await getApiKey('anthropic')
  if (!apiKey) {
    console.error(color('red', '\n[fatal] No Anthropic API key in keytar.'))
    console.error('Open Daylens → Settings → AI and save your Anthropic key, then re-run.')
    cleanupRealDbCopy(dbCtx)
    process.exit(2)
  }
  process.env.ANTHROPIC_API_KEY = apiKey
  console.log(color('dim', '[setup] Anthropic key loaded from keytar'))

  // 4. Force the chat provider to anthropic so sendMessage routes there
  //    regardless of what the user has saved.
  const { setSettings } = await import('../../src/main/services/settings')
  try {
    await setSettings({ aiProvider: 'anthropic', aiChatProvider: 'anthropic' })
  } catch (e) {
    console.warn(color('yellow', `[setup] could not pin provider: ${e instanceof Error ? e.message : String(e)}`))
  }

  // 5. Gather ground truth once for the judge.
  const { gatherGroundTruth, renderGroundTruthForJudge } = await import('./groundTruth')
  const gt = gatherGroundTruth()
  const groundTruthBlob = renderGroundTruthForJudge(gt)
  console.log(color('dim', '[setup] ground truth gathered'))
  console.log(color('dim', '─── ground truth (compact) ────────────────────────────────'))
  console.log(color('dim', groundTruthBlob))
  console.log(color('dim', '────────────────────────────────────────────────────────────\n'))

  // 6. Pull the real send pipeline + the judge.
  const { sendMessage } = await import('../../src/main/jobs/aiService')
  const { judgeAnswer } = await import('./judge')

  let scenarios = loadScenarios()
  const filterArg = process.env.DAYLENS_AI_SCENARIO_FILTER || process.argv.slice(2).find((a) => !a.startsWith('-'))
  if (filterArg) {
    const wanted = new Set(filterArg.split(',').map((s) => s.trim()).filter(Boolean))
    scenarios = scenarios.filter((s) => wanted.has(s.id))
    console.log(color('yellow', `[filter] running ${scenarios.length} scenario(s): ${[...wanted].join(', ')}`))
  }
  const results: Array<{
    scenario: ScenarioRecord
    answer: string
    answerKind: string | null
    sourceKind: string | null
    durationMs: number
    judge: Awaited<ReturnType<typeof judgeAnswer>>
    artifactsEmitted: number
    tracePath?: string
    error?: string
  }> = []

  let idx = 0
  for (const scenario of scenarios) {
    idx += 1
    const header = `[${idx}/${scenarios.length}] ${scenario.id}`
    console.log(color('cyan', `\n${header}  (${scenario.family})`))
    console.log(color('bold', `  Q: ${scenario.question}`))

    const t0 = Date.now()
    try {
      const result = await sendMessage(
        { message: scenario.question, threadId: null },
        { traceScenarioId: scenario.id },
      )
      const assistant = result.assistantMessage
      const text = assistant.content
      const durationMs = Date.now() - t0
      const answerKind = assistant.answerKind ?? null
      const sourceKind = (assistant as any).sourceKind
        ?? (result.conversationState as any)?.sourceKind
        ?? null
      const artifactsEmitted = (assistant.artifacts ?? []).length

      console.log(color('dim', `  route: kind=${answerKind} source=${sourceKind} artifacts=${artifactsEmitted} ${durationMs}ms`))
      console.log(color('yellow', `  A: ${text.replace(/\n/g, '\n     ')}`))

      const traceSummary = summarizeTraceForJudge(path.join(traceDir, `${scenario.id}.json`))
      const verdict = await judgeAnswer(scenario, text, groundTruthBlob, apiKey, traceSummary)
      const gradeColor: keyof typeof ANSI =
        verdict.grade === 'good' ? 'green'
        : verdict.grade === 'bad' ? 'yellow'
        : verdict.grade === 'worse' ? 'red'
        : 'magenta'
      console.log(color(gradeColor, `  VERDICT: ${verdict.grade.toUpperCase()} — ${verdict.reason}`))
      console.log(color('dim', `  flags: gold_shape=${verdict.matchesGoldShape} citations=${verdict.citationsFound} hallucination=${verdict.hallucinationDetected} voice_ok=${verdict.voiceOk}`))

      results.push({
        scenario,
        answer: text,
        answerKind,
        sourceKind,
        durationMs,
        judge: verdict,
        artifactsEmitted,
        tracePath: path.join(traceDir, `${scenario.id}.json`),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.log(color('red', `  ERROR: ${message}`))
      results.push({
        scenario,
        answer: '',
        answerKind: null,
        sourceKind: null,
        durationMs: Date.now() - t0,
        judge: {
          scenarioId: scenario.id,
          grade: 'error',
          reason: message,
          citationsFound: false,
          hallucinationDetected: false,
          voiceOk: false,
          matchesGoldShape: false,
          rawJudgeOutput: '',
        },
        artifactsEmitted: 0,
        error: message,
      })
    }
  }

  // 7. Roll-up + persist.
  const tally = { good: 0, bad: 0, worse: 0, error: 0 }
  for (const r of results) tally[r.judge.grade] += 1

  console.log(color('bold', '\n=== Summary ==='))
  console.log(`  good:  ${color('green', String(tally.good))}`)
  console.log(`  bad:   ${color('yellow', String(tally.bad))}`)
  console.log(`  worse: ${color('red', String(tally.worse))}`)
  console.log(`  error: ${color('magenta', String(tally.error))}`)

  const outDir = path.join(process.cwd(), '.ai-behaviour')
  fs.mkdirSync(outDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outPath = path.join(outDir, `results-${stamp}.json`)
  fs.writeFileSync(outPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    tally,
    groundTruth: gt,
    results,
  }, null, 2))
  console.log(color('dim', `\nWrote ${outPath}`))

  cleanupRealDbCopy(dbCtx)

  // Non-zero exit only on errors; bad/worse are reported, not fatal — the
  // whole point of this harness is to surface them.
  if (tally.error > 0 || tally.worse > Math.ceil(results.length / 3)) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(color('red', `\n[fatal] ${err instanceof Error ? err.stack : String(err)}`))
  process.exit(1)
})
