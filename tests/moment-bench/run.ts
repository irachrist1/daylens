// Moment bench — terminal probe for moment-answer quality against the live DB.
//
// Runs the same deterministic router path the chat uses for "what was I
// watching at 3pm?" questions, plus the deterministic thread-title deriver.
// No provider calls, no chat UI, read-only DB.
//
//   npm run moment:bench
//   npm run moment:bench -- tuesday_3pm_youtube
//   npm run moment:bench -- --ask "What was I watching on Tuesday at 3pm?"

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import Database from 'better-sqlite3'
import { routeInsightsQuestion, shouldUseRouter } from '../../src/main/lib/insightsQueryRouter.ts'
import { deriveTitleFromMessage, isWeakThreadTitle } from '../../src/main/lib/threadTitles.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
}
const isTTY = process.stdout.isTTY
const c = (k: keyof typeof ANSI, s: string) => (isTTY ? `${ANSI[k]}${s}${ANSI.reset}` : s)

interface MomentCase {
  id: string
  question: string
  referenceNow?: string
  expectTitle?: string
  mustContain?: string[]
  mustNotContain?: string[]
}

function findLiveDbPath(): string {
  const home = os.homedir()
  const candidates: string[] = []
  if (process.platform === 'darwin') {
    candidates.push(
      path.join(home, 'Library', 'Application Support', 'DaylensWindows', 'daylens.sqlite'),
      path.join(home, 'Library', 'Application Support', 'Daylens', 'daylens.sqlite'),
    )
  } else if (process.platform === 'win32') {
    const roaming = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming')
    candidates.push(
      path.join(roaming, 'DaylensWindows', 'daylens.sqlite'),
      path.join(roaming, 'Daylens', 'daylens.sqlite'),
    )
  } else {
    const cfg = process.env.XDG_CONFIG_HOME ?? path.join(home, '.config')
    candidates.push(
      path.join(cfg, 'DaylensWindows', 'daylens.sqlite'),
      path.join(cfg, 'Daylens', 'daylens.sqlite'),
    )
  }
  const hit = candidates.find((p) => fs.existsSync(p))
  if (!hit) {
    throw new Error(
      `Live DB not found. Looked in:\n${candidates.map((p) => `  - ${p}`).join('\n')}\nOpen Daylens once, then re-run.`,
    )
  }
  return hit
}

function loadCases(): MomentCase[] {
  const doc = yaml.load(fs.readFileSync(path.join(HERE, 'cases.yaml'), 'utf8')) as { cases: MomentCase[] }
  return doc.cases ?? []
}

function parseReferenceNow(value: string | undefined): Date {
  if (!value) return new Date()
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Bad referenceNow: ${value}`)
  }
  return parsed
}

async function askOnce(
  db: Database.Database,
  question: string,
  referenceNow: Date,
): Promise<{ title: string; titleWeak: boolean; answer: string | null; kind: string }> {
  const title = deriveTitleFromMessage(question)
  const routed = await routeInsightsQuestion(question, referenceNow, null, db)
  if (!routed) {
    return { title, titleWeak: isWeakThreadTitle(title), answer: null, kind: 'null' }
  }
  if (routed.kind === 'answer') {
    return { title, titleWeak: isWeakThreadTitle(title), answer: routed.answer, kind: 'answer' }
  }
  return {
    title,
    titleWeak: isWeakThreadTitle(title),
    answer: JSON.stringify(routed),
    kind: routed.kind,
  }
}

function checkCase(
  momentCase: MomentCase,
  result: { title: string; titleWeak: boolean; answer: string | null; kind: string },
): string[] {
  const failures: string[] = []
  if (!shouldUseRouter(momentCase.question)) {
    failures.push('shouldUseRouter=false — UI would skip the router and go freeform LLM')
  }
  if (momentCase.expectTitle && result.title !== momentCase.expectTitle) {
    failures.push(`title: expected "${momentCase.expectTitle}", got "${result.title}"`)
  }
  if (result.titleWeak) {
    failures.push(`title is still weak: "${result.title}"`)
  }
  if (result.kind !== 'answer' || !result.answer) {
    failures.push(`router returned kind=${result.kind}, no answer`)
    return failures
  }
  for (const needle of momentCase.mustContain ?? []) {
    if (!result.answer.includes(needle)) {
      failures.push(`missing mustContain: ${JSON.stringify(needle)}`)
    }
  }
  for (const needle of momentCase.mustNotContain ?? []) {
    if (result.answer.includes(needle)) {
      failures.push(`hit mustNotContain: ${JSON.stringify(needle)}`)
    }
  }
  return failures
}

function printResult(
  label: string,
  question: string,
  result: { title: string; titleWeak: boolean; answer: string | null; kind: string },
  failures: string[],
): void {
  const status = failures.length === 0 ? c('green', 'PASS') : c('red', 'FAIL')
  console.log(`\n${c('bold', label)}  ${status}`)
  console.log(c('dim', `Q: ${question}`))
  console.log(`Title: ${result.title}${result.titleWeak ? c('yellow', ' (weak)') : ''}`)
  console.log(`Kind:  ${result.kind}`)
  console.log(`Answer:\n${result.answer ?? c('red', '(none)')}`)
  if (failures.length > 0) {
    console.log(c('red', 'Failures:'))
    for (const failure of failures) console.log(c('red', `  - ${failure}`))
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const askIdx = args.indexOf('--ask')
  const dbPath = findLiveDbPath()
  console.log(c('cyan', `Moment bench · live DB (read-only)`))
  console.log(c('dim', dbPath))

  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    if (askIdx !== -1) {
      const question = args.slice(askIdx + 1).join(' ').trim()
      if (!question) {
        console.error(c('red', 'Usage: npm run moment:bench -- --ask "your question"'))
        process.exit(2)
      }
      const result = await askOnce(db, question, new Date())
      printResult('ad-hoc', question, result, result.titleWeak || !result.answer ? ['see above'] : [])
      process.exit(result.answer && !result.titleWeak ? 0 : 1)
    }

    const filter = args.find((arg) => !arg.startsWith('--')) ?? null
    const cases = loadCases().filter((entry) => !filter || entry.id === filter)
    if (cases.length === 0) {
      console.error(c('red', filter ? `No case id "${filter}"` : 'No cases in cases.yaml'))
      process.exit(2)
    }

    let failed = 0
    for (const momentCase of cases) {
      const result = await askOnce(db, momentCase.question, parseReferenceNow(momentCase.referenceNow))
      const failures = checkCase(momentCase, result)
      printResult(momentCase.id, momentCase.question, result, failures)
      if (failures.length > 0) failed += 1
    }

    console.log(`\n${c('bold', 'Summary:')} ${cases.length - failed}/${cases.length} passed`)
    process.exit(failed === 0 ? 0 : 1)
  } finally {
    db.close()
  }
}

main().catch((error) => {
  console.error(c('red', error instanceof Error ? error.message : String(error)))
  process.exit(1)
})
