// Pretty-print a behavioural-harness trace JSON. Mirrors show-timeline in
// spirit: a tiny inspector you can point at a single scenario and read end
// to end without paging through 4kb of structured data.
//
// Usage:
//   npx tsx tests/ai-behaviour/show-trace.ts <pathToTraceJson>
//   npx tsx tests/ai-behaviour/show-trace.ts <traceDir> <scenarioId>

import fs from 'node:fs'
import path from 'node:path'

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

function resolveTracePath(args: string[]): string {
  if (args.length === 0) {
    console.error('usage: show-trace.ts <path-to-trace.json> | <traceDir> <scenarioId>')
    process.exit(2)
  }
  const first = args[0]
  if (args.length >= 2) {
    return path.join(first, `${args[1]}.json`)
  }
  return first
}

function shortJson(value: unknown, max = 400): string {
  const s = JSON.stringify(value)
  if (!s) return ''
  return s.length > max ? `${s.slice(0, max)}…` : s
}

function main(): void {
  const tracePath = resolveTracePath(process.argv.slice(2))
  if (!fs.existsSync(tracePath)) {
    console.error(`No trace at ${tracePath}`)
    process.exit(1)
  }
  const trace = JSON.parse(fs.readFileSync(tracePath, 'utf8')) as {
    traceId: string
    scenarioId?: string | null
    provider?: string
    modelId?: string
    systemPrompt?: string
    userMessage?: string
    prior?: Array<{ role: string; content: string }>
    events: Array<Record<string, unknown>>
    totals: Record<string, number>
    phaseLatencyMs?: Record<string, number>
    finalText?: string
    error?: string
  }

  console.log(color('bold', `\n=== ${trace.scenarioId ?? trace.traceId} ===`))
  console.log(color('dim', `provider=${trace.provider ?? '?'} model=${trace.modelId ?? '?'}`))
  console.log(color('dim', `totals: ${JSON.stringify(trace.totals)}`))
  if (trace.phaseLatencyMs && Object.keys(trace.phaseLatencyMs).length > 0) {
    console.log(color('dim', `phases: ${JSON.stringify(trace.phaseLatencyMs)}`))
  }

  console.log(color('blue', '\n--- system prompt ---'))
  console.log(trace.systemPrompt ?? '(none)')

  if (trace.prior?.length) {
    console.log(color('blue', '\n--- prior history ---'))
    for (const m of trace.prior) {
      console.log(color('dim', `${m.role}: `) + m.content)
    }
  }

  console.log(color('blue', '\n--- user message ---'))
  console.log(trace.userMessage ?? '(none)')

  console.log(color('blue', '\n--- events ---'))
  for (const event of trace.events) {
    const kind = event.kind as string
    if (kind === 'turn') {
      const text = event.text as string
      const tools = (event.toolUses as Array<{ name: string; input: unknown }> | undefined) ?? []
      console.log(color('cyan', `[turn] stop=${event.stopReason ?? ''} text="${text.slice(0, 200)}${text.length > 200 ? '…' : ''}"`))
      for (const t of tools) {
        console.log(color('yellow', `  └─ call ${t.name}(${shortJson(t.input)})`))
      }
    } else if (kind === 'tool_result') {
      console.log(color('green', `[tool_result] ${event.name} ${event.durationMs}ms`))
      console.log(color('dim', `  ${shortJson(event.output, 600)}`))
    } else if (kind === 'router') {
      console.log(color('magenta', `[router] matched=${event.matched} reason=${event.reason}`))
    } else if (kind === 'citation_check') {
      const ok = event.ok ? color('green', 'ok') : color('red', 'miss')
      console.log(`[citation] ${ok} missing=${shortJson(event.missing)} checked=${shortJson(event.checked)} retry=${event.retry ?? false}`)
    } else if (kind === 'final') {
      console.log(color('bold', `[final/${event.source}]`))
      console.log(event.text as string)
    } else if (kind === 'error') {
      console.log(color('red', `[error/${event.phase}] ${event.message}`))
    } else {
      console.log(color('dim', `[${kind}] ${shortJson(event)}`))
    }
  }

  if (trace.error) {
    console.log(color('red', `\nERROR: ${trace.error}`))
  } else {
    console.log(color('bold', '\n--- final text ---'))
    console.log(trace.finalText ?? '(none)')
  }
}

main()
