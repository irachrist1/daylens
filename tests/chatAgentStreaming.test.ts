import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import Database from 'better-sqlite3'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { runChatAgentTurn } from '../src/main/agent/chatAgent.ts'

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
}

function response(chunks: unknown[]) {
  return { stream: simulateReadableStream({ chunks }) }
}

test('publishes tool activity and only the grounded final answer', async () => {
  const db = createProductionTestDatabase()
  let call = 0
  const model = new MockLanguageModelV3({
    doStream: async () => {
      call += 1
      if (call === 1) {
        return response([
          { type: 'text-start', id: 'text-1' },
          { type: 'text-delta', id: 'text-1', delta: 'I need to inspect Monday using get_day_overview.' },
          { type: 'text-end', id: 'text-1' },
          { type: 'tool-call', toolCallId: 'call-1', toolName: 'get_day_overview', input: '{"date":"2026-07-06"}' },
          { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage },
        ] as never[])
      }
      if (call === 2) {
        return response([
          { type: 'text-start', id: 'text-2' },
          { type: 'text-delta', id: 'text-2', delta: 'Activity appeared at 9:37.' },
          { type: 'text-end', id: 'text-2' },
          { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
        ] as never[])
      }
      return response([
        { type: 'text-start', id: 'text-3' },
        { type: 'text-delta', id: 'text-3', delta: 'No activity was captured.' },
        { type: 'text-end', id: 'text-3' },
        { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
      ] as never[])
    },
  })
  const events: Array<{ delta: string; snapshot: string; status?: string }> = []

  try {
    const result = await runChatAgentTurn('What happened Monday?', [], {
      db,
      config: { provider: 'anthropic', apiKey: null, model: 'test' },
      model,
      onStreamEvent: (event) => { events.push(event) },
      askUser: async () => '',
      artifactDir: fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-agent-')),
      now: new Date(2026, 6, 12, 12),
    })

    assert.equal(result.text, 'No activity was captured.')
    assert.equal(result.groundingRetried, true)
    assert.deepEqual(events, [
      { delta: '', snapshot: '', status: 'Reading 2026-07-06' },
      { delta: 'No activity was captured.', snapshot: 'No activity was captured.' },
    ])
    assert.ok(events.every((event) => !event.snapshot.includes('get_day_overview')))
    assert.ok(events.every((event) => !event.snapshot.includes('9:37')))
  } finally {
    db.close()
  }
})

test('creates a requested spreadsheet when the model gathered rows but skipped the artifact call', async () => {
  const db = createProductionTestDatabase()
  const visitTime = new Date(2026, 6, 6, 9).getTime()
  db.prepare(`
    INSERT INTO website_visits (
      domain, page_title, url, visit_time, visit_time_us, duration_sec,
      browser_bundle_id, source
    ) VALUES ('media.example', 'Product review', 'https://media.example/watch?v=Abc_123-xyz', ?, ?, 120, 'browser', 'history')
  `).run(visitTime, visitTime * 1000)
  let call = 0
  const model = new MockLanguageModelV3({
    doStream: async () => {
      call += 1
      if (call === 1) {
        return response([
          { type: 'tool-call', toolCallId: 'call-pages', toolName: 'list_page_visits', input: '{"startDate":"2026-07-01","endDate":"2026-07-12"}' },
          { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage },
        ] as never[])
      }
      return response([
        { type: 'text-start', id: 'text-export' },
        { type: 'text-delta', id: 'text-export', delta: 'Your spreadsheet is ready.' },
        { type: 'text-end', id: 'text-export' },
        { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
      ] as never[])
    },
  })
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-agent-export-'))

  try {
    const result = await runChatAgentTurn('Give me an Excel of my page activity this month.', [], {
      db,
      config: { provider: 'anthropic', apiKey: null, model: 'test' },
      model,
      askUser: async () => '',
      artifactDir,
      now: new Date(2026, 6, 12, 12),
    })
    assert.equal(result.artifacts.length, 1)
    assert.equal(result.artifacts[0].format, 'xlsx')
    assert.ok(fs.existsSync(result.artifacts[0].path))
  } finally {
    db.close()
    fs.rmSync(artifactDir, { recursive: true, force: true })
  }
})
