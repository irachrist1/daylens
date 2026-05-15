// AI regression harness runner. Loads tests/ai-bench/corpus.yaml, executes
// each entry against the deterministic router, asserts the expected
// characteristics, and writes results to tests/ai-bench/.last-results.json
// for diff against the previous run.
//
// Live-provider mode (entries with mode: both, when AI_BENCH_LIVE=1 and a
// relevant API key is in env) is scaffolded but currently records as skipped;
// live evaluation will be wired in a follow-up so the harness shape stabilises
// first.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { GoogleGenAI } from '@google/genai'
import { setupFixture } from './fixtures'
import { routeInsightsQuestion } from '../../src/main/lib/insightsQueryRouter'
import { getAppSummariesForRange, getSessionsForRange, getWebsiteSummariesForRange } from '../../src/main/db/queries'

interface ExpectShape {
  router_kind?: 'answer' | 'weeklyBrief' | 'null' | 'any'
  must_include?: string[]
  must_not_include?: string[]
  must_cite_block?: boolean
  min_length?: number
  live_must_include?: string[]
  live_must_not_include?: string[]
  live_min_length?: number
}

interface CorpusEntry {
  id: string
  question: string
  fixture: string
  mode: 'router' | 'both'
  provider?: 'anthropic' | 'openai' | 'google'
  expect: ExpectShape
}

interface CorpusFile {
  questions: CorpusEntry[]
}

export interface EntryResult {
  id: string
  passed: boolean
  failures: string[]
  routerKind: 'answer' | 'weeklyBrief' | 'null'
  answer: string
  live: { ran: false; reason: string } | { ran: true; passed: boolean; failures: string[]; answer: string }
}

export interface RunSummary {
  total: number
  passed: number
  failed: number
  liveRan: number
  liveFailed: number
  results: EntryResult[]
  generatedAt: string
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CORPUS_PATH = path.join(HERE, 'corpus.yaml')
const RESULTS_PATH = path.join(HERE, '.last-results.json')
const LIVE_RESULTS_PATH = path.join(HERE, '.last-live-results.json')

const BLOCK_SHAPED = /\b(\d{1,2}:\d{2}|\d+\s*m(?:in)?|\d+\s*hours?|\d+h(?:\s*\d+m)?|from\s+\d{1,2})/i

export function loadCorpus(): CorpusEntry[] {
  const raw = fs.readFileSync(CORPUS_PATH, 'utf8')
  const parsed = yaml.load(raw) as CorpusFile | undefined
  if (!parsed || !Array.isArray(parsed.questions)) {
    throw new Error('corpus.yaml: missing or malformed `questions` array')
  }
  return parsed.questions
}

function checkExpectations(
  answer: string,
  routerKind: 'answer' | 'weeklyBrief' | 'null',
  expect: ExpectShape,
  scope: 'router' | 'live',
): string[] {
  const failures: string[] = []
  const expectedKind = expect.router_kind ?? 'any'

  if (scope === 'router' && expectedKind !== 'any' && expectedKind !== routerKind) {
    failures.push(`expected router_kind=${expectedKind}, got ${routerKind}`)
  }

  const haystack = answer.toLowerCase()
  const includes = scope === 'live' ? expect.live_must_include : expect.must_include
  const excludes = scope === 'live' ? expect.live_must_not_include : expect.must_not_include
  const minLen = scope === 'live' ? expect.live_min_length : expect.min_length

  if (includes) {
    for (const needle of includes) {
      if (!haystack.includes(needle.toLowerCase())) {
        failures.push(`${scope}: missing required substring "${needle}"`)
      }
    }
  }
  if (excludes) {
    for (const needle of excludes) {
      if (haystack.includes(needle.toLowerCase())) {
        failures.push(`${scope}: contains forbidden substring "${needle}"`)
      }
    }
  }
  if (minLen != null && answer.trim().length < minLen) {
    failures.push(`${scope}: answer length ${answer.trim().length} < min ${minLen}`)
  }
  if (scope === 'router' && expect.must_cite_block && !BLOCK_SHAPED.test(answer)) {
    failures.push('expected block-shaped citation (time or duration), found none')
  }
  return failures
}

function dayBounds(date: Date): [number, number] {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return [start.getTime(), end.getTime()]
}

function liveEvidenceContext(db: Parameters<typeof getAppSummariesForRange>[0], today: Date, routerAnswer: string): string {
  const [fromMs, toMs] = dayBounds(today)
  const apps = getAppSummariesForRange(db, fromMs, toMs)
  const sites = getWebsiteSummariesForRange(db, fromMs, toMs)
  const sessions = getSessionsForRange(db, fromMs, toMs)
  return JSON.stringify({
    routerAnswer,
    apps: apps.slice(0, 8).map((app) => ({
      appName: app.appName,
      category: app.category,
      totalSeconds: app.totalSeconds,
    })),
    sites: sites.slice(0, 8).map((site) => ({
      domain: site.domain,
      title: site.topTitle,
      totalSeconds: site.totalSeconds,
    })),
    sessions: sessions.slice(0, 16).map((session) => ({
      appName: session.appName,
      title: session.windowTitle,
      startTime: new Date(session.startTime).toISOString(),
      durationSeconds: session.durationSeconds,
      category: session.category,
    })),
  }, null, 2)
}

async function runLiveProvider(entry: CorpusEntry, evidence: string): Promise<string> {
  const provider = entry.provider ?? 'anthropic'
  const systemPrompt = [
    'You are Daylens, answering an AI benchmark question from captured local activity evidence.',
    'Use only the evidence in the JSON payload. If the evidence does not support the answer, say so plainly.',
    'Keep the answer short, specific, and evidence-led. Do not use motivational filler or emoji.',
  ].join('\n')
  const userPrompt = JSON.stringify({
    question: entry.question,
    evidence,
  })

  if (provider === 'openai') {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const response = await client.chat.completions.create({
      model: process.env.AI_BENCH_OPENAI_MODEL ?? 'gpt-4.1-mini',
      max_tokens: 600,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    })
    return response.choices[0]?.message.content ?? ''
  }

  if (provider === 'google') {
    const client = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY })
    const response = await client.models.generateContent({
      model: process.env.AI_BENCH_GOOGLE_MODEL ?? 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      config: { systemInstruction: systemPrompt, maxOutputTokens: 600 },
    })
    return response.text ?? ''
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const response = await client.messages.create({
    model: process.env.AI_BENCH_ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    max_tokens: 600,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

async function runEntry(entry: CorpusEntry): Promise<EntryResult> {
  const { db, today } = setupFixture(entry.fixture)
  const result = await routeInsightsQuestion(entry.question, today, null, db)

  const routerKind: 'answer' | 'weeklyBrief' | 'null' =
    result == null ? 'null' : result.kind
  const answer = result?.kind === 'answer' ? result.answer : ''

  const routerFailures = checkExpectations(answer, routerKind, entry.expect, 'router')

  const liveEnabled = process.env.AI_BENCH_LIVE === '1'
  const liveProvider = entry.provider ?? 'anthropic'
  const liveKeyEnv =
    liveProvider === 'google' ? 'GOOGLE_API_KEY'
    : liveProvider === 'openai' ? 'OPENAI_API_KEY'
    : 'ANTHROPIC_API_KEY'
  const liveKeyMissing = !process.env[liveKeyEnv]
  const live: EntryResult['live'] =
    entry.mode !== 'both' ? { ran: false, reason: 'router-only entry' }
    : !liveEnabled ? { ran: false, reason: 'AI_BENCH_LIVE=1 not set' }
    : liveKeyMissing ? { ran: false, reason: `${liveKeyEnv} not set` }
    : await (async () => {
      try {
        const liveAnswer = await runLiveProvider(entry, liveEvidenceContext(db, today, answer))
        const liveFailures = checkExpectations(liveAnswer, routerKind, entry.expect, 'live')
        return { ran: true as const, passed: liveFailures.length === 0, failures: liveFailures, answer: liveAnswer }
      } catch (error) {
        return {
          ran: true as const,
          passed: false,
          failures: [`live: ${error instanceof Error ? error.message : String(error)}`],
          answer: '',
        }
      }
    })()
  db.close()

  const failures = [
    ...routerFailures,
    ...(live.ran && !live.passed ? live.failures : []),
  ]

  return {
    id: entry.id,
    passed: failures.length === 0,
    failures,
    routerKind,
    answer,
    live,
  }
}

export async function runAll(): Promise<RunSummary> {
  const corpus = loadCorpus()
  const results: EntryResult[] = []
  for (const entry of corpus) {
    results.push(await runEntry(entry))
  }

  const summary: RunSummary = {
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    liveRan: results.filter((r) => r.live.ran).length,
    liveFailed: results.filter((r) => r.live.ran && !r.live.passed).length,
    results,
    generatedAt: new Date().toISOString(),
  }
  return summary
}

export function writeResults(summary: RunSummary): void {
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(summary, null, 2))
  if (summary.liveRan > 0) {
    fs.writeFileSync(
      LIVE_RESULTS_PATH,
      JSON.stringify({
        generatedAt: summary.generatedAt,
        liveRan: summary.liveRan,
        liveFailed: summary.liveFailed,
        results: summary.results
          .filter((result) => result.live.ran)
          .map((result) => ({ id: result.id, live: result.live })),
      }, null, 2),
    )
  }
}

export function readPreviousResults(): RunSummary | null {
  try {
    return JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8')) as RunSummary
  } catch {
    return null
  }
}

export function diffSummaries(prev: RunSummary | null, curr: RunSummary): string[] {
  if (!prev) return []
  const lines: string[] = []
  const prevById = new Map(prev.results.map((r) => [r.id, r]))
  for (const next of curr.results) {
    const before = prevById.get(next.id)
    if (!before) {
      lines.push(`+ ${next.id} (new entry, ${next.passed ? 'pass' : 'fail'})`)
      continue
    }
    if (before.passed && !next.passed) {
      lines.push(`! REGRESSION ${next.id}: ${next.failures.join('; ')}`)
    } else if (!before.passed && next.passed) {
      lines.push(`✓ RECOVERED ${next.id}`)
    }
  }
  const currIds = new Set(curr.results.map((r) => r.id))
  for (const before of prev.results) {
    if (!currIds.has(before.id)) lines.push(`- ${before.id} (removed)`)
  }
  return lines
}
