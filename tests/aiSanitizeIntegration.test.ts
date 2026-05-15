import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import { executeTool } from '../src/main/services/aiTools.ts'
import { sanitizeForRender } from '../src/shared/aiSanitize.ts'

// Reproduces the v1 ship-blocker flow end-to-end on the layers we control:
// pollute the DB the way a real OAuth-callback window title does, exercise
// the tool path the model uses to answer "Which pages opened in Google
// Meet?", then run a model-shaped response through the renderer sanitizer.
// Both layers must scrub the secret.

const POLLUTED_TITLE = 'Sign in - https://login.live.com/oauth20_authorize.srf?code=1.ARMB-AbCdEf12345_GhIjKlMnOpQrStUvWxYz1234567890abcdEFGH&state=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function localMs(date: string, hour: number, minute = 0): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d, hour, minute, 0, 0).getTime()
}

function seedPollutedSession(db: Database.Database) {
  const date = todayKey()
  const start = localMs(date, 10, 0)
  const end = start + 5 * 60_000
  db.prepare(`
    INSERT INTO app_sessions (
      bundle_id, app_name, start_time, end_time, duration_sec,
      category, is_focused, window_title, raw_app_name,
      capture_source, capture_version
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 'test', 1)
  `).run(
    'com.google.Chrome',
    'Google Chrome',
    start,
    end,
    5 * 60,
    'browsing',
    POLLUTED_TITLE,
    'Google Chrome',
  )
}

test('integration: getAppUsage on polluted DB strips OAuth token before reaching the model', () => {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  seedPollutedSession(db)

  const result = executeTool(
    'getAppUsage',
    { appName: 'Google Chrome', startDate: todayKey(), endDate: todayKey() },
    db,
  ) as { recentWindowTitles: string[] }

  const flat = JSON.stringify(result)
  assert.ok(!flat.includes('1.ARMB-AbCdEf'), `OAuth code survived in tool result: ${flat}`)
  assert.ok(!flat.includes('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'), `JWT signature survived: ${flat}`)
  assert.ok(!flat.includes('?code='), `query string survived: ${flat}`)
  assert.ok(result.recentWindowTitles.length > 0, 'expected at least one row to confirm the title was returned at all')
  // The host should still be present so the model can still describe what
  // happened; only the secret-bearing tail is gone.
  assert.ok(flat.includes('login.live.com'))
  db.close()
})

test('integration: rendered text from a hypothetical model parrot is also scrubbed', () => {
  // Simulates what would happen if a future model regression bypassed 1B and
  // tried to write the polluted URL into its answer. 1C must still catch it.
  const modelOutput = `1. Daily standup - meet.google.com/abc-defg-hij\n2. ${POLLUTED_TITLE}\n3. Project sync`
  const { text, report } = sanitizeForRender(modelOutput)
  assert.ok(!text.includes('1.ARMB-AbCdEf'))
  assert.ok(!text.includes('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'))
  assert.ok(text.includes('[redacted]'))
  assert.ok(report.redactionCount >= 1)
})
