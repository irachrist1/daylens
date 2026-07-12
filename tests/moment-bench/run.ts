// Chat bench — the terminal IS the UI (ai.md §4.3, ADR 0003).
//
// Drives the exact same `sendMessage` entrypoint the AI tab's IPC handler
// calls, against a read-only copy of the live DB, with the real Settings
// provider + keys from keytar. A PASS here is the answer the UI streams for
// the same question on the same data — same code path, same model, same
// tools. This costs real provider calls; run it deliberately.
//
//   npm run moment:bench                      # all cases
//   npm run moment:bench -- tuesday_3pm       # one case
//   npm run moment:bench -- --ask "question"  # ad-hoc single turn
//
// Case schema (cases.yaml):
//   id: string
//   turns: [string, ...]        # sequential messages in ONE thread (follow-ups)
//   mustContain: [..]           # substrings the FINAL turn's answer must include
//   mustNotContain: [..]        # substrings it must not include (any turn)
//   minDistinctTimes: number    # final answer must cite >= N distinct HH:MM clock times
//   expectArtifactFormat: xlsx|csv|markdown   # final turn must attach a real file
//   userAnswer: string          # scripted reply if the agent asks a clarifying question
//   dataDependent: true         # live-data case: hard guards only + print for eyeballing

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { stageReadOnlyCopyOfRealDb, cleanupRealDbCopy, type RealDbContext } from '../ai-behaviour/realDb'

const HERE = path.dirname(fileURLToPath(import.meta.url))

const ANSI = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
}
const isTTY = process.stdout.isTTY
const c = (k: keyof typeof ANSI, s: string) => (isTTY ? `${ANSI[k]}${s}${ANSI.reset}` : s)

interface BenchCase {
  id: string
  turns: string[]
  mustContain?: string[]
  mustNotContain?: string[]
  minDistinctTimes?: number
  expectArtifactFormat?: string
  userAnswer?: string
  dataDependent?: boolean
}

// Phrases the voice contract bans outright — any of these in ANY answer is an
// automatic FAIL regardless of the case (ai.md §3, voice.md §2).
const GLOBAL_MUST_NOT = [
  "I don't have the tool results",
  'could you share',
  "I don't have access",
  'I apologize',
  "I'm sorry",
  'based on the available data',
  'it appears that',
]

function loadCases(): BenchCase[] {
  const doc = yaml.load(fs.readFileSync(path.join(HERE, 'cases.yaml'), 'utf8')) as { cases: BenchCase[] }
  return (doc.cases ?? []).map((entry) => ({
    ...entry,
    turns: entry.turns ?? [],
  }))
}

function distinctClockTimes(text: string): number {
  const found = new Set<string>()
  const pattern = /\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    let hour = Number(match[1])
    const meridiem = match[3]?.toLowerCase()
    if (meridiem === 'pm' && hour < 12) hour += 12
    if (meridiem === 'am' && hour === 12) hour = 0
    if (hour > 23 || Number(match[2]) > 59) continue
    found.add(`${hour}:${match[2]}`)
  }
  return found.size
}

interface TurnOutcome {
  answer: string
  threadId: number | null
  artifacts: Array<{ format: string; path: string; title: string }>
  toolTrace: Array<{ tool: string }>
  providerCallCount: number | null
  title: string | null
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const askIdx = args.indexOf('--ask')

  console.log(c('cyan', 'Chat bench · live-DB copy · REAL provider calls (same path as the UI)'))
  const ctx: RealDbContext = stageReadOnlyCopyOfRealDb()
  console.log(c('dim', `DB copy: ${ctx.copiedDbPath}`))

  // Import AFTER staging so getDb() opens the copy, never the live file.
  const { initDb } = await import('../../src/main/services/database')
  initDb()
  const { sendMessage } = await import('../../src/main/jobs/aiService')
  const { getThread } = await import('../../src/main/services/artifacts')
  const { isWeakThreadTitle } = await import('../../src/main/lib/threadTitles')

  async function runTurn(message: string, threadId: number | null, userAnswer?: string): Promise<TurnOutcome> {
    let streamed = ''
    const result = await sendMessage(
      { message, threadId, clientRequestId: `bench-${Date.now()}` },
      {
        onStreamEvent: (event) => {
          streamed = event.snapshot
          if (event.status && process.env.BENCH_VERBOSE) console.log(c('dim', `  · ${event.status}…`))
        },
        onAgentQuestion: async (question) => {
          console.log(c('yellow', `  ? agent asked: ${question.question} [${question.options.join(' / ')}]`))
          return userAnswer ?? '(No answer available — pick the most defensible reading, answer, and say what you assumed.)'
        },
      },
    )
    const thread = result.threadId != null ? getThread(result.threadId) : null
    // The UI renders the persisted message; assert against that, with the
    // streamed snapshot as a consistency check. Artifacts and the tool trace
    // are read off the same top-level message fields MessageList renders.
    const answer = result.assistantMessage.content
    if (streamed && !answer.startsWith(streamed.slice(0, 40)) && process.env.BENCH_VERBOSE) {
      console.log(c('yellow', '  ! streamed snapshot and persisted answer diverge in their first 40 chars'))
    }
    return {
      answer,
      threadId: result.threadId,
      artifacts: (result.assistantMessage.artifacts ?? []).map(({ format, path, title }) => ({ format, path, title })),
      toolTrace: result.assistantMessage.agent?.toolTrace ?? [],
      providerCallCount: result.providerCallCount ?? null,
      title: thread?.title ?? null,
    }
  }

  function checkCase(benchCase: BenchCase, outcomes: TurnOutcome[]): string[] {
    const failures: string[] = []
    const final = outcomes[outcomes.length - 1]
    for (const outcome of outcomes) {
      for (const banned of [...GLOBAL_MUST_NOT, ...(benchCase.mustNotContain ?? [])]) {
        if (outcome.answer.toLowerCase().includes(banned.toLowerCase())) {
          failures.push(`answer contains banned phrase: ${JSON.stringify(banned)}`)
        }
      }
    }
    if (!benchCase.dataDependent) {
      for (const needle of benchCase.mustContain ?? []) {
        if (!final.answer.toLowerCase().includes(needle.toLowerCase())) {
          failures.push(`final answer missing mustContain: ${JSON.stringify(needle)}`)
        }
      }
    }
    if (benchCase.minDistinctTimes && distinctClockTimes(final.answer) < benchCase.minDistinctTimes) {
      failures.push(`final answer cites ${distinctClockTimes(final.answer)} distinct clock times; needs >= ${benchCase.minDistinctTimes}`)
    }
    if (benchCase.expectArtifactFormat) {
      const artifact = final.artifacts.find((entry) => entry.format === benchCase.expectArtifactFormat)
      if (!artifact) {
        failures.push(`no ${benchCase.expectArtifactFormat} artifact attached (got: ${final.artifacts.map((a) => a.format).join(', ') || 'none'})`)
      } else if (!fs.existsSync(artifact.path) || fs.statSync(artifact.path).size === 0) {
        failures.push(`artifact file missing or empty on disk: ${artifact.path}`)
      }
    }
    const firstTitle = outcomes[0].title
    if (firstTitle != null && isWeakThreadTitle(firstTitle)) {
      failures.push(`thread title is weak: ${JSON.stringify(firstTitle)}`)
    }
    return failures
  }

  try {
    if (askIdx !== -1) {
      const question = args.slice(askIdx + 1).join(' ').trim()
      if (!question) {
        console.error(c('red', 'Usage: npm run moment:bench -- --ask "your question"'))
        process.exit(2)
      }
      const outcome = await runTurn(question, null)
      console.log(`\n${c('bold', 'Title:')} ${outcome.title ?? '(none)'}`)
      console.log(`${c('bold', 'Tools:')} ${outcome.toolTrace.map((t) => t.tool).join(' → ') || '(none)'}`)
      console.log(`${c('bold', 'Provider calls:')} ${outcome.providerCallCount ?? '?'}`)
      console.log(`\n${outcome.answer}`)
      process.exit(0)
    }

    const filter = args.find((arg) => !arg.startsWith('--')) ?? null
    const cases = loadCases().filter((entry) => !filter || entry.id === filter)
    if (cases.length === 0) {
      console.error(c('red', filter ? `No case id "${filter}"` : 'No cases in cases.yaml'))
      process.exit(2)
    }

    let failed = 0
    for (const benchCase of cases) {
      console.log(`\n${c('bold', benchCase.id)}${benchCase.dataDependent ? c('yellow', ' (data-dependent: guards only)') : ''}`)
      const outcomes: TurnOutcome[] = []
      let threadId: number | null = null
      let errored = false
      for (const turn of benchCase.turns) {
        console.log(c('dim', `Q: ${turn}`))
        try {
          const outcome = await runTurn(turn, threadId, benchCase.userAnswer)
          threadId = outcome.threadId
          outcomes.push(outcome)
          console.log(c('dim', `  tools: ${outcome.toolTrace.map((t) => t.tool).join(' → ') || '(none)'} · calls: ${outcome.providerCallCount ?? '?'}`))
          console.log(outcome.answer.split('\n').map((line) => `  ${line}`).join('\n'))
        } catch (error) {
          errored = true
          console.log(c('red', `  turn failed: ${error instanceof Error ? error.message : String(error)}`))
          break
        }
      }
      const failures = errored ? ['turn threw — see above'] : checkCase(benchCase, outcomes)
      if (failures.length > 0) {
        failed += 1
        console.log(c('red', 'FAIL'))
        for (const failure of failures) console.log(c('red', `  - ${failure}`))
      } else {
        console.log(c('green', 'PASS'))
      }
    }

    console.log(`\n${c('bold', 'Summary:')} ${cases.length - failed}/${cases.length} passed`)
    process.exit(failed === 0 ? 0 : 1)
  } finally {
    cleanupRealDbCopy(ctx)
  }
}

main().catch((error) => {
  console.error(c('red', error instanceof Error ? error.stack ?? error.message : String(error)))
  process.exit(1)
})
