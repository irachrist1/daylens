import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import { getTopPagesForDomains, getWebsiteSummariesForRange } from '../src/main/db/queries.ts'
import { getTimelineDayPayload, trimTimelineBlockSpan } from '../src/main/services/workBlocks.ts'
import { localDateString } from '../src/main/lib/localDate.ts'

// CHARACTERIZATION SUITE: these tests pin what the timeline engine actually
// does TODAY, bugs included. They exist to freeze current behavior so a later
// fix pass can flip them deliberately instead of discovering a silent
// behavior change by accident. Do not treat a passing test here as a
// blessing of the behavior — see the docs/specs/timeline.md references in
// each comment for what the spec actually promises.

const TEST_DATE = '2026-04-22'

function localMs(hour: number, minute = 0): number {
  return new Date(2026, 3, 22, hour, minute, 0, 0).getTime()
}

function localMsForDate(dateStr: string, hour: number, minute = 0): number {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

function createDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  return db
}

function insertSession(
  db: Database.Database,
  o: { bundleId: string; appName: string; start: number; end: number; category?: string; windowTitle?: string },
): void {
  db.prepare(`
    INSERT INTO app_sessions (
      bundle_id, app_name, start_time, end_time, duration_sec,
      category, is_focused, window_title, raw_app_name, canonical_app_id, capture_source, capture_version
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'test', 2)
  `).run(
    o.bundleId, o.appName, o.start, o.end, Math.round((o.end - o.start) / 1000),
    o.category ?? 'browsing', o.windowTitle ?? null, o.appName, o.bundleId,
  )
}

function insertVisit(
  db: Database.Database,
  o: { domain: string; visitMs: number; durationSec: number; browserBundleId: string },
): void {
  db.prepare(`
    INSERT INTO website_visits (
      domain, page_title, url, visit_time, visit_time_us, duration_sec,
      browser_bundle_id, canonical_browser_id, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'history')
  `).run(o.domain, `${o.domain} page`, `https://${o.domain}/`, o.visitMs, o.visitMs * 1000, o.durationSec, o.browserBundleId, o.browserBundleId)
}

function insertActivityEvent(db: Database.Database, eventType: string, ts: number, metadata: Record<string, unknown> = {}): void {
  db.prepare(`
    INSERT INTO activity_state_events (event_ts, event_type, source, metadata_json)
    VALUES (?, ?, 'test', ?)
  `).run(ts, eventType, JSON.stringify(metadata))
}

// ---------------------------------------------------------------------------
// Divergence #2 — cross-browser site attribution.
//
// A domain belongs to the browser that actually loaded it (spec:
// docs/specs/apps.md §3.3 "Domain attribution" and invariant 4; see also
// timeline.md §3.0 — "every browser's sites must reach the evidence"). When
// the same domain is genuinely visited from two different browsers in one
// range, getWebsiteSummariesForRange must return one summary row per browser,
// each carrying only that browser's own time — never merge the two into a
// single row credited to whichever visit was inserted first.
// ---------------------------------------------------------------------------
test('cross-browser site attribution: same domain from two browsers yields two summary rows, each correctly attributed', () => {
  const db = createDb()
  // Dia frontmost 10:00-10:30, Chrome frontmost 10:30-11:00 — two genuinely
  // separate browsers, each visiting the same domain during its own window.
  insertSession(db, { bundleId: 'company.thebrowser.dia', appName: 'Dia', start: localMs(10, 0), end: localMs(10, 30) })
  insertSession(db, { bundleId: 'com.google.Chrome', appName: 'Google Chrome', start: localMs(10, 30), end: localMs(11, 0) })

  // Dia's visit is inserted first (rowid 1), Chrome's second (rowid 2).
  insertVisit(db, { domain: 'example.com', visitMs: localMs(10, 0), durationSec: 1800, browserBundleId: 'company.thebrowser.dia' })
  insertVisit(db, { domain: 'example.com', visitMs: localMs(10, 30), durationSec: 1800, browserBundleId: 'com.google.Chrome' })

  const sites = getWebsiteSummariesForRange(db, localMs(10, 0), localMs(11, 0))
  const matches = sites.filter((s) => s.domain === 'example.com')

  // (a) two summary rows appear for the domain, one per browser that
  // genuinely visited it.
  assert.equal(matches.length, 2, `expected one summary row per browser, got ${matches.length}`)
  const byBrowser = new Map(matches.map((s) => [s.browserBundleId, s.totalSeconds]))
  // (b) each browser is credited with exactly its own 30 minutes — no
  // erasure, no misattribution.
  assert.equal(byBrowser.get('company.thebrowser.dia'), 1800, "Dia's own 30 minutes")
  assert.equal(byBrowser.get('com.google.Chrome'), 1800, "Chrome's own 30 minutes")
  // (c) the real total (60 minutes of browsing, split across two browsers)
  // is preserved across the two rows.
  const total = matches.reduce((sum, s) => sum + s.totalSeconds, 0)
  assert.equal(total, 3600, 'the real total time is preserved across the two per-browser rows')
  db.close()
})

// ---------------------------------------------------------------------------
// Divergence #3b (fixed) — a fresh sitting under the 15-minute floor used to
// be dropped entirely when a real sitting already existed earlier in the day.
//
// buildProvisionalLiveBlocks (src/main/services/workBlocks.ts ~4670-4700)
// used to filter coarse sittings to those whose span or active time cleared
// the 15-minute block floor. The empty-fallback only triggered when NO
// segment cleared the floor for the whole day, so once one real sitting
// existed, any later short sitting that failed the floor on both span and
// active time was silently dropped — it produced no provisional block at
// all, not even a small one, including the sitting being lived in right now.
//
// docs/specs/timeline.md §4: "The day so far is one provisional block per
// continuous sitting … a new provisional block starts when activity
// resumes." The 15-minute block floor (§3.4) applies at Analyze/finalize,
// not to the live provisional view — a live sitting is exempt from it.
// ---------------------------------------------------------------------------
test('a fresh sitting under 15 minutes after an earlier real sitting gets its own provisional block (spec §4)', () => {
  const db = createDb()
  const today = localDateString()
  // A 2h sitting, well clear of the 15-minute floor.
  insertSession(db, { bundleId: 'com.todesktop.cursor', appName: 'Cursor', category: 'development', start: localMsForDate(today, 9, 0), end: localMsForDate(today, 11, 0), windowTitle: 'router.ts - daylens - Cursor' })
  // A 20-minute gap (>= the 15-minute session break) …
  // … then a fresh 5-minute sitting: both its span and active time are under
  // the 15-minute floor, but it's still its own continuous sitting.
  insertSession(db, { bundleId: 'com.google.Chrome', appName: 'Google Chrome', category: 'browsing', start: localMsForDate(today, 11, 20), end: localMsForDate(today, 11, 25), windowTitle: 'Inbox - Gmail - Google Chrome' })

  const payload = getTimelineDayPayload(db, today, null, { materialize: false })

  assert.equal(payload.blocks.length, 2, `the fresh 5-minute sitting should get its own provisional block; got ${payload.blocks.length} block(s)`)
  const [earlier, active] = payload.blocks.sort((a, b) => a.startTime - b.startTime)
  assert.equal(earlier.endTime, localMsForDate(today, 11, 0), 'the earlier 2h sitting survives as its own provisional block')
  assert.equal(active.startTime, localMsForDate(today, 11, 20), 'the fresh 5-minute sitting starts its own provisional block')
  assert.equal(active.endTime, localMsForDate(today, 11, 25))
  db.close()
})

// Control case: a fresh sitting of 15+ minutes after an earlier real sitting
// also gets its own provisional block — same rule, longer sitting.
test('a fresh sitting of 15+ minutes after an earlier real sitting DOES get its own provisional block', () => {
  const db = createDb()
  const today = localDateString()
  insertSession(db, { bundleId: 'com.todesktop.cursor', appName: 'Cursor', category: 'development', start: localMsForDate(today, 9, 0), end: localMsForDate(today, 11, 0), windowTitle: 'router.ts - daylens - Cursor' })
  // Same 20-minute gap, but this sitting clears the floor on both span and
  // active time (20 minutes).
  insertSession(db, { bundleId: 'com.google.Chrome', appName: 'Google Chrome', category: 'browsing', start: localMsForDate(today, 11, 20), end: localMsForDate(today, 11, 40), windowTitle: 'Inbox - Gmail - Google Chrome' })

  const payload = getTimelineDayPayload(db, today, null, { materialize: false })

  assert.equal(payload.blocks.length, 2, `a 20-minute fresh sitting should get its own provisional block; got ${payload.blocks.length}`)
  db.close()
})

// ---------------------------------------------------------------------------
// Divergence #6 (fixed) — gap reason classification used to pick the kind
// with the most coverage, not the highest-priority real-absence signal.
//
// classifyGapRange (src/main/services/workBlocks.ts ~4894-4927) used to walk
// GAP_KIND_PRIORITY in order but only replace `best` when a kind's coverage
// strictly exceeded the current `bestMs`. Priority only broke an exact tie;
// whichever kind covered more of the gap won outright, even a lower-priority
// one.
//
// docs/specs/timeline.md §3.1: "When several causes covered parts of one gap,
// the strongest real-absence signal names it (asleep > locked > paused >
// passive > idle)" — priority order, not coverage share. Separately,
// "Untracked — no signal covered at least half the gap" is unaffected by this
// fix: that rule still runs first, on total coverage.
// ---------------------------------------------------------------------------
test('a gap covered 60% idle and 40% asleep classifies as Asleep — priority outranks coverage share (spec §3.1)', () => {
  const db = createDb()
  insertSession(db, { bundleId: 'com.todesktop.cursor', appName: 'Cursor', category: 'development', start: localMs(9, 0), end: localMs(9, 30), windowTitle: 'a.ts - Cursor' })
  insertSession(db, { bundleId: 'com.todesktop.cursor', appName: 'Cursor', category: 'development', start: localMs(11, 10), end: localMs(11, 40), windowTitle: 'b.ts - Cursor' })
  // The 100-minute gap (9:30-11:10): 40 minutes (40%) genuinely asleep,
  // 60 minutes (60%) genuinely idle — asleep outranks idle in
  // GAP_KIND_PRIORITY even though idle covers more of the gap.
  insertActivityEvent(db, 'suspend', localMs(9, 30))
  insertActivityEvent(db, 'resume', localMs(10, 10))
  insertActivityEvent(db, 'idle_start', localMs(10, 10), { idleSeconds: 0 })
  insertActivityEvent(db, 'idle_end', localMs(11, 10))

  const gaps = getTimelineDayPayload(db, TEST_DATE).segments.filter((segment) => segment.kind !== 'work_block')
  const bigGap = gaps.find((gap) => gap.startTime === localMs(9, 30) && gap.endTime === localMs(11, 10))

  assert.ok(bigGap, `expected the 100-minute gap to be visible: ${JSON.stringify(gaps)}`)
  assert.equal(bigGap?.kind, 'asleep', `spec says asleep should outrank idle regardless of coverage; engine actually picked ${bigGap?.kind}`)
  db.close()
})

// ---------------------------------------------------------------------------
// Divergence #5c — trimming a block's edges outward is silently clamped to
// the block's original span rather than rejected.
//
// trimTimelineBlockSpan (src/main/services/workBlocks.ts ~1608-1628) computes
// `newStart = Math.max(block.startTime, Math.min(startMs, block.endTime))`
// and `newEnd = Math.min(block.endTime, Math.max(endMs, block.startTime))`.
// Any requested edge outside [block.startTime, block.endTime] is clamped back
// onto the original boundary instead of throwing — the spec says the time
// inputs are "trim-only: edges move inward, never outward" but does not say
// what should happen to an out-of-range request; the current code neither
// rejects it nor reports it, it just quietly no-ops that edge.
// ---------------------------------------------------------------------------
// CHARACTERIZATION: current behavior, diverges from docs/specs/timeline.md
// §3.4 rule 5 (edges "move inward, never outward" — an outward request is
// silently absorbed rather than surfaced as an error) — will be flipped when
// fixed (divergence #5c)
test('trimming both edges outward is a silent no-op, not a rejection', () => {
  const db = createDb()
  insertSession(db, { bundleId: 'com.todesktop.cursor', appName: 'Cursor', category: 'development', start: localMs(9, 0), end: localMs(10, 40), windowTitle: 'work.ts - daylens - Cursor' })

  const block = getTimelineDayPayload(db, TEST_DATE).blocks[0]
  assert.ok(block)

  // Ask to extend an hour earlier and an hour later — both outward.
  const result = trimTimelineBlockSpan(db, TEST_DATE, block, block.startTime - 60 * 60_000, block.endTime + 60 * 60_000)

  assert.equal(result.changed, false, 'an all-outward request should not throw, but also should not change anything')
  const after = getTimelineDayPayload(db, TEST_DATE).blocks
  assert.equal(after.length, 1, 'the block is neither split nor extended')
  assert.equal(after[0].startTime, block.startTime, 'start is clamped back to the original, not extended earlier')
  assert.equal(after[0].endTime, block.endTime, 'end is clamped back to the original, not extended later')
  db.close()
})

// CHARACTERIZATION: current behavior, diverges from docs/specs/timeline.md
// §3.4 rule 5 — will be flipped when fixed (divergence #5c, mixed case)
test('trimming one edge outward and the other inward: the outward edge silently clamps, only the inward edge actually cuts', () => {
  const db = createDb()
  insertSession(db, { bundleId: 'com.todesktop.cursor', appName: 'Cursor', category: 'development', start: localMs(9, 0), end: localMs(10, 40), windowTitle: 'work.ts - daylens - Cursor' })

  const block = getTimelineDayPayload(db, TEST_DATE).blocks[0]
  assert.ok(block)
  assert.equal(block.startTime, localMs(9, 0))
  assert.equal(block.endTime, localMs(10, 40))

  // Requested start is 30 minutes BEFORE the block's real start (outward);
  // requested end is a genuine inward cut to 10:00.
  const result = trimTimelineBlockSpan(db, TEST_DATE, block, block.startTime - 30 * 60_000, localMs(10, 0))
  assert.equal(result.changed, true, 'the legitimate inward end-cut still registers as a change')

  const rebuilt = getTimelineDayPayload(db, TEST_DATE).blocks.sort((a, b) => a.startTime - b.startTime)
  assert.equal(rebuilt.length, 2, `the inward cut should split the block: ${JSON.stringify(rebuilt.map((b) => [b.startTime, b.endTime]))}`)
  // The outward start request had no effect: the first piece starts exactly
  // where the original block did, never 30 minutes earlier.
  assert.equal(rebuilt[0].startTime, localMs(9, 0), 'the outward start request is silently clamped to the original start')
  assert.equal(rebuilt[0].endTime, localMs(10, 0), 'the inward end cut takes effect exactly at the requested time')
  assert.equal(rebuilt[1].startTime, localMs(10, 0))
  assert.equal(rebuilt[1].endTime, localMs(10, 40), 'the trailing piece keeps the original end — nothing was extended')
  db.close()
})

// ---------------------------------------------------------------------------
// Divergence #4 (fixed) — page-level evidence used to sum raw
// website_visits.duration_sec instead of reconciling against the visiting
// browser's actual foreground time, the way domain-level summaries already
// do (getWebsiteSummariesForRange, ~queries.ts:2338). Chromium-family
// history rows accrue in the background and while the browser is not the
// foreground app at all, so the unreconciled top-pages path
// (getTopPagesForDomains, ~queries.ts:2424) and the block-evidence page
// candidates (buildPageCandidates, workBlocks.ts ~1895) could both inflate
// page minutes and surface pages the user never actually looked at during
// that span.
//
// Fix: both paths now read from the same per-visit reconciliation ledger
// (reconcileWebsiteVisits, queries.ts) that getWebsiteSummariesForRange
// already used — a page's credited time is bounded by (a) its own browser's
// foreground overlap in the requested span and (b) an exclusive claim
// against every other visit sharing that browser's time pool, so a
// domain's page times can never sum to more than the domain's own
// reconciled total (spec: timeline.md §3.0 "evidence object", invariant 6
// "every number on screen comes from the same blocks"; apps.md's
// reconciliation rule).
// ---------------------------------------------------------------------------
test('page-level evidence reconciles like domain-level: a background-accrued visit contributes 0 and never appears as a page (divergence #4)', () => {
  const db = createDb()
  // Warp is frontmost the whole hour; the browser that actually loaded the
  // page (Dia) never is.
  insertSession(db, { bundleId: 'dev.warp.Warp-Stable', appName: 'Warp', category: 'development', start: localMs(9, 0), end: localMs(10, 0) })
  // A Dia history row keeps accruing for the full hour behind Warp — a pure
  // background tab, never actually seen in this span.
  insertVisit(db, { domain: 'github.com', visitMs: localMs(9, 0), durationSec: 3600, browserBundleId: 'company.thebrowser.dia' })

  // Domain level already reconciles this to zero (divergence #2 coverage);
  // page level must agree exactly, not just approximately.
  const sites = getWebsiteSummariesForRange(db, localMs(9, 0), localMs(10, 0))
  assert.equal(sites.find((s) => s.domain === 'github.com'), undefined, 'sanity: the domain itself is background noise')

  const pages = getTopPagesForDomains(db, localMs(9, 0), localMs(10, 0), ['github.com'], 5)
  assert.equal(pages['github.com'], undefined, 'a background-accrued visit must not appear as page evidence either')
  db.close()
})

test("page times within a domain sum to no more than that domain's own reconciled total (divergence #4)", () => {
  const db = createDb()
  insertSession(db, { bundleId: 'company.thebrowser.dia', appName: 'Dia', category: 'browsing', start: localMs(10, 0), end: localMs(11, 0) })

  // History says one page on example.com spanned the whole hour; the
  // active-tab tracker saw a DIFFERENT page on the same domain for the
  // first 20 minutes. One browser, one active tab: the hour must split
  // 20/40 across the two pages, never read as 20+60.
  db.prepare(`
    INSERT INTO website_visits (
      domain, page_title, url, normalized_url, visit_time, visit_time_us, duration_sec,
      browser_bundle_id, canonical_browser_id, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active_browser_context')
  `).run('example.com', 'Inbox', 'https://example.com/inbox', 'https://example.com/inbox', localMs(10, 0), localMs(10, 0) * 1000, 1200, 'company.thebrowser.dia', 'company.thebrowser.dia')
  db.prepare(`
    INSERT INTO website_visits (
      domain, page_title, url, normalized_url, visit_time, visit_time_us, duration_sec,
      browser_bundle_id, canonical_browser_id, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'history')
  `).run('example.com', 'Archive', 'https://example.com/archive', 'https://example.com/archive', localMs(10, 0), localMs(10, 0) * 1000, 3600, 'company.thebrowser.dia', 'company.thebrowser.dia')

  const domainTotal = getWebsiteSummariesForRange(db, localMs(10, 0), localMs(11, 0)).find((s) => s.domain === 'example.com')
  assert.ok(domainTotal)
  assert.equal(domainTotal!.totalSeconds, 3600, 'the domain total is the full hour, whichever page it came from')

  const pages = getTopPagesForDomains(db, localMs(10, 0), localMs(11, 0), ['example.com'], 5)['example.com'] ?? []
  const byUrl = new Map(pages.map((p) => [p.url, p.totalSeconds]))
  assert.equal(byUrl.get('https://example.com/inbox'), 1200, 'the observed active tab keeps its own 20 minutes')
  assert.equal(byUrl.get('https://example.com/archive'), 2400, 'the history page only gets the minutes the active tab does not claim')

  const pageTotal = pages.reduce((sum, p) => sum + p.totalSeconds, 0)
  assert.ok(pageTotal <= domainTotal!.totalSeconds, `page breakdown (${pageTotal}s) must not exceed the domain's own reconciled total (${domainTotal!.totalSeconds}s)`)
  assert.equal(pageTotal, domainTotal!.totalSeconds, "by construction the two totals agree exactly, not just approximately — they're unions of the same underlying credited intervals")
  db.close()
})

test("a block's page evidence excludes a visit with zero foreground overlap in the block's own span (divergence #4)", () => {
  const db = createDb()
  const today = localDateString()
  // Cursor is frontmost the whole block; Chrome (the browser that loaded
  // the page) never is anywhere in this span.
  insertSession(db, { bundleId: 'com.todesktop.cursor', appName: 'Cursor', category: 'development', start: localMsForDate(today, 9, 0), end: localMsForDate(today, 10, 0), windowTitle: 'a.ts - Cursor' })
  insertVisit(db, { domain: 'youtube.com', visitMs: localMsForDate(today, 9, 0), durationSec: 3600, browserBundleId: 'com.google.Chrome' })

  const payload = getTimelineDayPayload(db, today, null, { materialize: true })
  assert.equal(payload.blocks.length, 1)
  const block = payload.blocks[0]

  assert.equal(
    block.pageRefs.find((page) => page.domain === 'youtube.com'),
    undefined,
    'a visit whose browser never reached the foreground in this block must not become a page artifact for it',
  )
  assert.equal(
    block.evidenceSummary.sites?.find((page) => page.domain === 'youtube.com'),
    undefined,
    'the same rule applies to the persisted evidence object every surface reads',
  )
  db.close()
})
