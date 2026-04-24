// Tool-use integration tests — real API calls, real DB.
// Skipped in default CI. Run with: npm run test:toolcalls
import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import { ensureSearchSchema } from '../src/main/db/migrations.ts'
import { anthropicTools, openaiTools, executeTool } from '../src/main/services/aiTools.ts'

// Use real tests only when the flag is set to avoid accidental API charges.
const it = process.env.RUN_TOOL_CALL_TESTS === '1' ? test : test.skip
const anthropicIt =
  process.env.RUN_TOOL_CALL_TESTS === '1' && process.env.ANTHROPIC_API_KEY ? test : test.skip
const openaiIt = process.env.RUN_TOOL_CALL_TESTS === '1' && process.env.OPENAI_API_KEY ? test : test.skip

function setupDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  ensureSearchSchema(db)
  // Seed one week of activity
  const now = Date.now()
  for (let d = 0; d < 7; d++) {
    const dayMs = now - d * 86_400_000
    const start = new Date(dayMs)
    start.setHours(9, 0, 0, 0)
    const startMs = start.getTime()
    db.prepare(`
      INSERT INTO app_sessions (bundle_id, app_name, start_time, end_time, duration_sec,
        category, is_focused, window_title, raw_app_name, capture_source, capture_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'test', 1)
    `).run(
      'com.microsoft.VSCode',
      'Code',
      startMs,
      startMs + 7200_000,
      7200,
      'coding',
      1,
      `Code - daylens/src/main/services/ai.ts`,
      'Code',
    )
    db.prepare(`
      INSERT INTO app_sessions (bundle_id, app_name, start_time, end_time, duration_sec,
        category, is_focused, window_title, raw_app_name, capture_source, capture_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'test', 1)
    `).run(
      'com.figma.Desktop',
      'Figma',
      startMs + 7200_000,
      startMs + 10800_000,
      3600,
      'design',
      1,
      `Figma - Daylens recall board`,
      'Figma',
    )
  }
  return db
}

// ---------------------------------------------------------------------------
// Schema tests — no API calls, always run
// ---------------------------------------------------------------------------

test('anthropicTools has 6 entries with required fields', () => {
  assert.equal(anthropicTools.length, 6)
  for (const tool of anthropicTools) {
    assert.ok(tool.name, 'tool has name')
    assert.ok(tool.description, 'tool has description')
    assert.ok(tool.input_schema, 'tool has input_schema')
  }
})

test('openaiTools mirrors anthropicTools length', () => {
  assert.equal(openaiTools.length, anthropicTools.length)
  for (const t of openaiTools) {
    assert.equal(t.type, 'function')
    assert.ok(t.function.name)
  }
})

test('executeTool: searchSessions returns hits array', () => {
  const db = setupDb()
  const result = executeTool('searchSessions', { query: 'Figma' }, db) as { hits: unknown[]; totalFound: number }
  assert.ok(Array.isArray(result.hits))
  assert.ok(result.hits.length > 0, 'expected at least one Figma session hit')
  db.close()
})

test('executeTool: getDaySummary returns date and topApps', () => {
  const db = setupDb()
  const today = new Date()
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const result = executeTool('getDaySummary', { date: dateStr }, db) as { date: string; topApps: unknown[] }
  assert.equal(result.date, dateStr)
  assert.ok(Array.isArray(result.topApps))
  db.close()
})

test('executeTool: getAppUsage returns totalSeconds for Code', () => {
  const db = setupDb()
  const result = executeTool('getAppUsage', { appName: 'Code' }, db) as { totalSeconds: number }
  assert.ok(result.totalSeconds > 0, 'expected tracked Code time')
  db.close()
})

test('executeTool: getWeekSummary returns dailyBreakdown with 7 entries', () => {
  const db = setupDb()
  // Find the Monday of this week
  const now = new Date()
  const dayOfWeek = now.getDay() // 0=Sun, 1=Mon...
  const daysFromMonday = (dayOfWeek + 6) % 7
  const monday = new Date(now.getTime() - daysFromMonday * 86_400_000)
  const weekStart = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`
  const result = executeTool('getWeekSummary', { weekStartDate: weekStart }, db) as { dailyBreakdown: unknown[] }
  assert.equal(result.dailyBreakdown.length, 7)
  db.close()
})

test('executeTool: getAttributionContext returns unknown for missing entity', () => {
  const db = setupDb()
  const result = executeTool('getAttributionContext', { entityName: 'NonexistentClient99' }, db) as { entityType: string }
  assert.equal(result.entityType, 'unknown')
  db.close()
})

// ---------------------------------------------------------------------------
// Live API tests — require RUN_TOOL_CALL_TESTS=1 and real keys
// ---------------------------------------------------------------------------

anthropicIt('anthropic tool loop: calls at least one tool for Figma question', async () => {
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const { anthropicTools: tools } = await import('../src/main/services/aiTools.ts')
  const apiKey = process.env.ANTHROPIC_API_KEY ?? ''
  const db = setupDb()

  const client = new Anthropic({ apiKey })
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    system: `You have tools to query a local work tracker. Use them to answer the user's question. Today is ${new Date().toISOString().slice(0, 10)}.`,
    tools,
    messages: [{ role: 'user', content: 'When did I last use Figma?' }],
  })

  const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use')
  assert.ok(toolUseBlocks.length > 0, 'model should call at least one tool')

  for (const tb of toolUseBlocks) {
    if (tb.type !== 'tool_use') continue
    const { executeTool: exec } = await import('../src/main/services/aiTools.ts')
    const result = exec(tb.name as Parameters<typeof executeTool>[0], tb.input as Record<string, unknown>, db)
    assert.ok(result !== null && result !== undefined, `tool ${tb.name} returned a result`)
  }
  db.close()
})

openaiIt('openai tool loop: calls at least one tool for VS Code question', async () => {
  const OpenAI = (await import('openai')).default
  const { openaiTools: tools } = await import('../src/main/services/aiTools.ts')
  const apiKey = process.env.OPENAI_API_KEY ?? ''
  const db = setupDb()

  const client = new OpenAI({ apiKey })
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 512,
    tools,
    messages: [
      {
        role: 'system',
        content: `You have tools to query a local work tracker. Use them to answer the user's question. Today is ${new Date().toISOString().slice(0, 10)}.`,
      },
      { role: 'user', content: 'How much time did I spend coding this week?' },
    ],
  })

  const toolCalls = response.choices[0]?.message.tool_calls ?? []
  assert.ok(toolCalls.length > 0, 'model should call at least one tool')

  for (const tc of toolCalls) {
    const args = JSON.parse(tc.function.arguments) as Record<string, unknown>
    const { executeTool: exec } = await import('../src/main/services/aiTools.ts')
    const result = exec(tc.function.name as Parameters<typeof executeTool>[0], args, db)
    assert.ok(result !== null && result !== undefined, `tool ${tc.function.name} returned a result`)
  }
  db.close()
})
