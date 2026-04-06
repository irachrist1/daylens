import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { insertAppSession, insertWebsiteVisit } from '../src/main/db/queries'
import { SCHEMA_SQL } from '../src/main/db/schema'
import { routeInsightsQuestion, type TemporalContext } from '../src/main/lib/insightsQueryRouter'
import type { AppCategory, AppSession } from '../src/shared/types'

interface BenchmarkCase {
  name: string
  question: string
  assertResult: (answer: string) => void
}

const ANCHOR_DATE = new Date('2026-04-06T15:30:00')

function timestamp(time: string): number {
  return new Date(`2026-04-06T${time}:00`).getTime()
}

function insertSession(
  db: Database.Database,
  params: {
    bundleId: string
    appName: string
    title: string
    category: AppCategory
    start: string
    end: string
  },
): void {
  const startTime = timestamp(params.start)
  const endTime = timestamp(params.end)
  const session: Omit<AppSession, 'id'> = {
    bundleId: params.bundleId,
    appName: params.appName,
    windowTitle: params.title,
    startTime,
    endTime,
    durationSeconds: Math.round((endTime - startTime) / 1000),
    category: params.category,
    isFocused: params.category === 'development' || params.category === 'research' || params.category === 'writing',
  }
  insertAppSession(db, session)
}

function seedBenchmarkData(db: Database.Database): void {
  db.exec(SCHEMA_SQL)

  insertSession(db, {
    bundleId: 'Code.exe',
    appName: 'Visual Studio Code',
    title: 'ASYV onboarding export - Visual Studio Code',
    category: 'development',
    start: '09:00',
    end: '09:50',
  })
  insertSession(db, {
    bundleId: 'OUTLOOK.EXE',
    appName: 'Microsoft Outlook',
    title: 'ASYV kickoff notes - Outlook',
    category: 'email',
    start: '09:50',
    end: '10:05',
  })
  insertSession(db, {
    bundleId: 'EXCEL.EXE',
    appName: 'Microsoft Excel',
    title: 'ASYV budget model.xlsx - Excel',
    category: 'productivity',
    start: '10:05',
    end: '10:35',
  })
  insertSession(db, {
    bundleId: 'WindowsTerminal.exe',
    appName: 'Windows Terminal',
    title: 'pnpm test --filter asyv-export',
    category: 'development',
    start: '10:35',
    end: '10:50',
  })
  insertSession(db, {
    bundleId: 'chrome.exe',
    appName: 'Google Chrome',
    title: 'ASYV dashboard localhost - Google Chrome',
    category: 'browsing',
    start: '10:50',
    end: '11:10',
  })
  insertSession(db, {
    bundleId: 'chrome.exe',
    appName: 'Google Chrome',
    title: 'Reddit - Google Chrome',
    category: 'entertainment',
    start: '13:00',
    end: '13:30',
  })
  insertSession(db, {
    bundleId: 'Code.exe',
    appName: 'Visual Studio Code',
    title: 'Internal tooling cleanup - Visual Studio Code',
    category: 'development',
    start: '14:00',
    end: '14:40',
  })

  insertWebsiteVisit(db, {
    domain: 'asyv.example.com',
    pageTitle: 'ASYV dashboard',
    url: 'https://asyv.example.com/dashboard',
    visitTime: timestamp('10:52'),
    visitTimeUs: BigInt(timestamp('10:52')) * 1000n,
    durationSec: 8 * 60,
    browserBundleId: 'chrome.exe',
    source: 'history',
  })
  insertWebsiteVisit(db, {
    domain: 'localhost:3000',
    pageTitle: 'ASYV export preview',
    url: 'http://localhost:3000/asyv-export',
    visitTime: timestamp('11:00'),
    visitTimeUs: BigInt(timestamp('11:00')) * 1000n,
    durationSec: 10 * 60,
    browserBundleId: 'chrome.exe',
    source: 'history',
  })
  insertWebsiteVisit(db, {
    domain: 'reddit.com',
    pageTitle: 'r/programming',
    url: 'https://reddit.com/r/programming',
    visitTime: timestamp('13:05'),
    visitTimeUs: BigInt(timestamp('13:05')) * 1000n,
    durationSec: 15 * 60,
    browserBundleId: 'chrome.exe',
    source: 'history',
  })
}

async function ask(
  db: Database.Database,
  question: string,
  previousContext: TemporalContext | null,
): Promise<{ answer: string; resolvedContext: TemporalContext }> {
  const result = await routeInsightsQuestion(question, ANCHOR_DATE, previousContext, db)
  assert.ok(result, `Expected a routed answer for: ${question}`)
  return { answer: result!.answer, resolvedContext: result!.resolvedContext }
}

async function main(): Promise<void> {
  const db = new Database(':memory:')
  seedBenchmarkData(db)

  const checks: BenchmarkCase[] = [
    {
      name: 'Client-level cumulative attribution',
      question: 'How many hours have I spent on ASYV today?',
      assertResult: (answer) => {
        assert.match(answer, /2h 10m/i)
        assert.match(answer, /outlook|excel|localhost|terminal|vs code/i)
      },
    },
    {
      name: 'Title evidence enumeration',
      question: 'Which ASYV titles matched today?',
      assertResult: (answer) => {
        assert.match(answer, /ASYV kickoff notes/i)
        assert.match(answer, /ASYV budget model\.xlsx/i)
        assert.match(answer, /ASYV dashboard/i)
      },
    },
    {
      name: 'App breakdown follow-up',
      question: 'Break ASYV down by app today.',
      assertResult: (answer) => {
        assert.match(answer, /ASYV by app/i)
        assert.match(answer, /Visual Studio Code|VS Code/i)
        assert.match(answer, /Outlook/i)
        assert.match(answer, /Excel/i)
        assert.match(answer, /Chrome/i)
      },
    },
    {
      name: 'Scoped native-app attribution',
      question: 'How much ASYV time was in Outlook today?',
      assertResult: (answer) => {
        assert.match(answer, /15m/i)
        assert.match(answer, /ASYV/i)
      },
    },
    {
      name: 'Exact time lookup for workspace chat follow-up',
      question: 'What was I doing today at 10:58 am?',
      assertResult: (answer) => {
        assert.match(answer, /10:58/i)
        assert.match(answer, /asyv\.example\.com|localhost:3000|google chrome/i)
      },
    },
  ]

  let previousContext: TemporalContext | null = null
  for (const check of checks) {
    const { answer, resolvedContext } = await ask(db, check.question, previousContext)
    check.assertResult(answer)
    previousContext = resolvedContext
    console.log(`PASS ${check.name}`)
    console.log(answer)
    console.log('')
  }

  console.log(`PASS ${checks.length} AI workspace benchmark checks`)
}

void main().catch((error) => {
  console.error('FAIL benchmark run')
  console.error(error instanceof Error ? error.stack : error)
  process.exitCode = 1
})
