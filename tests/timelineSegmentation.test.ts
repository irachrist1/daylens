import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import type { AppSession } from '../src/shared/types.ts'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import { buildTimelineBlocksFromSessions } from '../src/main/services/workBlocks.ts'

// Local-time millis on a fixed day, so block boundaries are deterministic.
function at(hour: number, minute: number): number {
  return new Date(2026, 3, 12, hour, minute, 0, 0).getTime()
}

let nextId = 1
function session(opts: {
  bundleId: string
  appName?: string
  category: AppSession['category']
  startTime: number
  endTime: number
  windowTitle?: string | null
}): AppSession {
  return {
    id: nextId++,
    bundleId: opts.bundleId,
    appName: opts.appName ?? opts.bundleId,
    startTime: opts.startTime,
    endTime: opts.endTime,
    durationSeconds: Math.round((opts.endTime - opts.startTime) / 1000),
    category: opts.category,
    isFocused: opts.category === 'development' || opts.category === 'aiTools',
    windowTitle: opts.windowTitle ?? null,
    rawAppName: opts.appName ?? opts.bundleId,
    canonicalAppId: opts.bundleId,
    appInstanceId: opts.bundleId,
    captureSource: 'foreground_poll',
    endedReason: null,
    captureVersion: 2,
  }
}

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  return db
}

function seedActivityEvent(db: Database.Database, tsMs: number, type: string): void {
  db.prepare(`INSERT INTO activity_state_events (event_ts, event_type, source, metadata_json) VALUES (?, ?, 'system', '{}')`).run(tsMs, type)
}

function seedWebsiteVisit(db: Database.Database, opts: {
  domain: string
  pageTitle?: string | null
  url: string
  visitTime: number
  durationSec: number
  browserBundleId?: string | null
}): void {
  db.prepare(`
    INSERT INTO website_visits (
      domain,
      page_title,
      url,
      visit_time,
      visit_time_us,
      duration_sec,
      browser_bundle_id,
      canonical_browser_id,
      normalized_url,
      page_key,
      source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'test')
  `).run(
    opts.domain,
    opts.pageTitle ?? null,
    opts.url,
    opts.visitTime,
    opts.visitTime * 1000,
    opts.durationSec,
    opts.browserBundleId ?? null,
    opts.browserBundleId ?? null,
    opts.url,
    opts.url,
  )
}

function labels(db: Database.Database, sessions: AppSession[]): { count: number; spans: string[] } {
  const blocks = buildTimelineBlocksFromSessions(db, sessions)
  return {
    count: blocks.length,
    spans: blocks.map((b) => `${new Date(b.startTime).getHours()}:${String(new Date(b.startTime).getMinutes()).padStart(2, '0')}-${new Date(b.endTime).getHours()}:${String(new Date(b.endTime).getMinutes()).padStart(2, '0')}`),
  }
}

// FIX: an assisted-work pair (AI tool + the editor it's driving) separated by a
// short interruption inside one segment is ONE coding session. The 10-min gap is
// past the 5-min soft-merge threshold, so this does NOT merge via shouldSoftMerge
// (the once-hypothesised "widen the gap window to 15 min" was proven inert and
// reverted). It merges in the sub-30 absorption pass because aiTools + development
// is recognised as an assisted-work pair, hence `candidatesRelated`.
test('assisted-work pair across a 10-minute gap is one block', () => {
  const db = freshDb()
  const sessions = [
    session({ bundleId: 'com.openai.codex', appName: 'Codex', category: 'aiTools', startTime: at(10, 0), endTime: at(10, 22), windowTitle: 'codex · daylens' }),
    session({ bundleId: 'com.microsoft.VSCode', appName: 'Code', category: 'development', startTime: at(10, 32), endTime: at(10, 58), windowTitle: 'workBlocks.ts — daylens' }),
  ]
  const result = labels(db, sessions)
  assert.equal(result.count, 1, `expected one merged coding block, got ${result.count}: ${result.spans.join(', ')}`)
  db.close()
})

// GUARD (distinct topics): two different browsing topics in the same browser are
// two different things. They share a top app and the browsing category, so the
// topic-sensitive content-context check (different window titles) is the only
// thing keeping them apart — in both shouldSoftMerge and candidatesRelated. Do
// not loosen it.
test('two distinct browsing topics stay separate', () => {
  const db = freshDb()
  const sessions = [
    session({ bundleId: 'com.apple.Safari', appName: 'Safari', category: 'browsing', startTime: at(11, 0), endTime: at(11, 26), windowTitle: 'pull requests · github' }),
    session({ bundleId: 'com.apple.Safari', appName: 'Safari', category: 'browsing', startTime: at(11, 34), endTime: at(12, 0), windowTitle: 'cooking pasta · youtube' }),
  ]
  const result = labels(db, sessions)
  assert.equal(result.count, 2, `distinct browsing topics must not merge, got ${result.count}: ${result.spans.join(', ')}`)
  db.close()
})

// GUARD (runaway watching, R4): the same video activity split by a real >15-min
// gap (machine locked) stays two blocks. Distant same-intent spans must NOT
// bridge into one runaway "watching" block.
test('entertainment across a real >15-minute gap stays separate', () => {
  const db = freshDb()
  seedActivityEvent(db, at(14, 50), 'lock')
  seedActivityEvent(db, at(15, 8), 'unlock')
  const sessions = [
    session({ bundleId: 'com.apple.Safari', appName: 'Safari', category: 'entertainment', startTime: at(14, 0), endTime: at(14, 40), windowTitle: 'documentary · youtube' }),
    session({ bundleId: 'com.apple.Safari', appName: 'Safari', category: 'entertainment', startTime: at(15, 10), endTime: at(15, 50), windowTitle: 'documentary · youtube' }),
  ]
  const result = labels(db, sessions)
  assert.equal(result.count, 2, `entertainment across a real gap must stay separate, got ${result.count}: ${result.spans.join(', ')}`)
  db.close()
})

// FIX (contentless sliver): a sub-30-min Safari fragment with no window titles
// and no page artifacts sits between two stretches of architecture-review work.
// It carries no independent meaning, so it folds into a neighbour even though
// browsing ≠ development/aiTools. Without this, the sliver stands alone as a
// third block.
test('contentless browsing sliver between work stretches is absorbed', () => {
  const db = freshDb()
  const sessions = [
    session({ bundleId: 'com.microsoft.VSCode', appName: 'Code', category: 'development', startTime: at(9, 0), endTime: at(9, 8), windowTitle: 'PERF-COHERENCE-MAP.md — daylens' }),
    session({ bundleId: 'com.apple.Safari', appName: 'Safari', category: 'browsing', startTime: at(9, 9), endTime: at(9, 21), windowTitle: null }),
    session({ bundleId: 'com.openai.codex', appName: 'Codex', category: 'aiTools', startTime: at(9, 22), endTime: at(10, 5), windowTitle: 'codex · daylens architecture' }),
  ]
  const result = labels(db, sessions)
  assert.equal(result.count, 1, `contentless sliver should fold into the work stretch, got ${result.count}: ${result.spans.join(', ')}`)
  db.close()
})

// GUARD (nearest neighbour): contentless slivers do not use the normal
// same-category preference. They attach to the nearest non-meeting neighbour.
test('contentless browsing sliver chooses the nearest neighbour', () => {
  const db = freshDb()
  const sessions = [
    session({ bundleId: 'com.microsoft.VSCode', appName: 'Code', category: 'development', startTime: at(9, 0), endTime: at(9, 30), windowTitle: 'PERF-COHERENCE-MAP.md — daylens' }),
    session({ bundleId: 'com.apple.Safari', appName: 'Safari', category: 'browsing', startTime: at(9, 35), endTime: at(9, 45), windowTitle: null }),
    session({ bundleId: 'com.openai.codex', appName: 'Codex', category: 'aiTools', startTime: at(9, 46), endTime: at(10, 15), windowTitle: 'codex · daylens architecture' }),
  ]
  const result = labels(db, sessions)
  assert.deepEqual(result.spans, ['9:00-9:30', '9:35-10:15'], `sliver should attach right by nearest gap, got ${result.spans.join(', ')}`)
  db.close()
})

// GUARD (page artifacts): a titleless browser fragment that has page evidence is
// not contentless, so it must not be swallowed across unrelated categories.
test('browser sliver with a page artifact stays separate', () => {
  const db = freshDb()
  seedWebsiteVisit(db, {
    domain: 'example.com',
    pageTitle: 'Architecture review notes',
    url: 'https://example.com/architecture',
    visitTime: at(9, 10),
    durationSec: 8 * 60,
    browserBundleId: 'com.apple.Safari',
  })
  const sessions = [
    session({ bundleId: 'com.microsoft.VSCode', appName: 'Code', category: 'development', startTime: at(9, 0), endTime: at(9, 8), windowTitle: 'PERF-COHERENCE-MAP.md — daylens' }),
    session({ bundleId: 'com.apple.Safari', appName: 'Safari', category: 'browsing', startTime: at(9, 9), endTime: at(9, 21), windowTitle: null }),
    session({ bundleId: 'com.openai.codex', appName: 'Codex', category: 'aiTools', startTime: at(9, 22), endTime: at(10, 5), windowTitle: 'codex · daylens architecture' }),
  ]
  const result = labels(db, sessions)
  assert.equal(result.count, 3, `page-backed browser sliver must remain separate, got ${result.count}: ${result.spans.join(', ')}`)
  db.close()
})

// GUARD (scope): the special bypass is for titleless browser slivers. A
// titleless non-browser activity may still be meaningful and must not disappear
// merely because it lacks a captured title.
test('titleless non-browser short activity is not contentless sliver absorption', () => {
  const db = freshDb()
  const sessions = [
    session({ bundleId: 'com.microsoft.VSCode', appName: 'Code', category: 'development', startTime: at(9, 0), endTime: at(9, 8), windowTitle: 'PERF-COHERENCE-MAP.md — daylens' }),
    session({ bundleId: 'com.apple.mail', appName: 'Mail', category: 'email', startTime: at(9, 9), endTime: at(9, 21), windowTitle: null }),
    session({ bundleId: 'com.openai.codex', appName: 'Codex', category: 'aiTools', startTime: at(9, 22), endTime: at(10, 5), windowTitle: 'codex · daylens architecture' }),
  ]
  const result = labels(db, sessions)
  assert.equal(result.count, 3, `titleless Mail activity must stay separate, got ${result.count}: ${result.spans.join(', ')}`)
  db.close()
})

// GUARD (true sliver): the special case is a fragment between other activity.
// A titleless browser block at the edge of a segment may be the user's actual
// activity and should not be erased just because it lacks a captured page title.
test('edge titleless browser activity is not absorbed as a sliver', () => {
  const db = freshDb()
  const sessions = [
    session({ bundleId: 'com.apple.Safari', appName: 'Safari', category: 'browsing', startTime: at(9, 0), endTime: at(9, 12), windowTitle: null }),
    session({ bundleId: 'com.openai.codex', appName: 'Codex', category: 'aiTools', startTime: at(9, 13), endTime: at(10, 0), windowTitle: 'codex · daylens architecture' }),
  ]
  const result = labels(db, sessions)
  assert.equal(result.count, 2, `edge browser activity must stay separate, got ${result.count}: ${result.spans.join(', ')}`)
  db.close()
})

// FIX (the YouTube-with-a-break case): the same video, a 2-minute detour, back
// to the same video — one continuous block, not three. Kept under the 2-hour
// span ceiling so this isolates detour-absorption from the (separate) ceiling
// split; a >2h single activity legitimately splits at TIMELINE_MAX_BLOCK_SPAN_MS.
test('same video with a short detour is one block', () => {
  const db = freshDb()
  const sessions = [
    session({ bundleId: 'com.apple.Safari', appName: 'Safari', category: 'entertainment', startTime: at(7, 0), endTime: at(7, 50), windowTitle: 'long lecture · youtube' }),
    session({ bundleId: 'com.google.Chrome', appName: 'Chrome', category: 'browsing', startTime: at(7, 50), endTime: at(7, 52), windowTitle: 'how long is a marathon · google' }),
    session({ bundleId: 'com.apple.Safari', appName: 'Safari', category: 'entertainment', startTime: at(7, 52), endTime: at(8, 35), windowTitle: 'long lecture · youtube' }),
  ]
  const result = labels(db, sessions)
  assert.equal(result.count, 1, `same video either side of a 2-min detour should be one block, got ${result.count}: ${result.spans.join(', ')}`)
  db.close()
})

test('a 42-second leisure detour cannot split or recategorize surrounding coding', () => {
  const db = freshDb()
  const sessions = [
    session({ bundleId: 'com.microsoft.VSCode', appName: 'Code', category: 'development', startTime: at(9, 0), endTime: at(9, 30), windowTitle: 'timeline backend — daylens' }),
    session({ bundleId: 'com.apple.Safari', appName: 'Safari', category: 'entertainment', startTime: at(9, 30), endTime: at(9, 30) + 42_000, windowTitle: 'Netflix' }),
    session({ bundleId: 'com.microsoft.VSCode', appName: 'Code', category: 'development', startTime: at(9, 30) + 42_000, endTime: at(10, 0), windowTitle: 'timeline backend — daylens' }),
  ]

  const [block, ...rest] = buildTimelineBlocksFromSessions(db, sessions)
  assert.equal(rest.length, 0)
  assert.equal(block.dominantCategory, 'development')
  assert.doesNotMatch(block.label.current, /netflix/i)
  db.close()
})

test('a detour under ten minutes is absorbed but a ten-minute detour remains distinct', () => {
  const db = freshDb()
  const underTen = [
    session({ bundleId: 'com.microsoft.VSCode', appName: 'Code', category: 'development', startTime: at(10, 0), endTime: at(10, 25), windowTitle: 'timeline backend — daylens' }),
    session({ bundleId: 'com.apple.Safari', appName: 'Safari', category: 'social', startTime: at(10, 25), endTime: at(10, 34) + 59_000, windowTitle: 'X' }),
    session({ bundleId: 'com.microsoft.VSCode', appName: 'Code', category: 'development', startTime: at(10, 34) + 59_000, endTime: at(11, 0), windowTitle: 'timeline backend — daylens' }),
  ]
  assert.equal(buildTimelineBlocksFromSessions(db, underTen).length, 1)

  const sustained = [
    session({ bundleId: 'com.microsoft.VSCode', appName: 'Code', category: 'development', startTime: at(12, 0), endTime: at(12, 25), windowTitle: 'timeline backend — daylens' }),
    session({ bundleId: 'com.apple.Safari', appName: 'Safari', category: 'social', startTime: at(12, 25), endTime: at(12, 35), windowTitle: 'X' }),
    session({ bundleId: 'com.microsoft.VSCode', appName: 'Code', category: 'development', startTime: at(12, 35), endTime: at(13, 0), windowTitle: 'timeline backend — daylens' }),
  ]
  assert.equal(buildTimelineBlocksFromSessions(db, sustained).length, 3)
  db.close()
})

test('brief leisure evidence cannot relabel sustained native debugging work', () => {
  const db = freshDb()
  seedWebsiteVisit(db, {
    domain: 'netflix.com',
    pageTitle: 'Netflix',
    url: 'https://netflix.com/watch/example',
    visitTime: at(15, 30),
    durationSec: 8 * 60,
    browserBundleId: 'company.thebrowser.dia',
  })
  const sessions = [
    session({ bundleId: 'com.mitchellh.ghostty', appName: 'Ghostty', category: 'development', startTime: at(15, 0), endTime: at(15, 30), windowTitle: 'nextdns debug logs' }),
    session({ bundleId: 'company.thebrowser.dia', appName: 'Dia', category: 'aiTools', startTime: at(15, 30), endTime: at(15, 38), windowTitle: 'Starlink troubleshooting' }),
    session({ bundleId: 'com.openai.codex', appName: 'Codex', category: 'aiTools', startTime: at(15, 38), endTime: at(16, 10), windowTitle: 'NextDNS debugging' }),
  ]

  const blocks = buildTimelineBlocksFromSessions(db, sessions)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].kind, 'work')
  assert.notEqual(blocks[0].dominantCategory, 'entertainment')
  assert.ok(!blocks[0].websites.some((site) => site.domain === 'netflix.com'))
  db.close()
})
