import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import { ensureSearchSchema } from '../src/main/db/migrations.ts'
import {
  formatMomentPageEvidence,
  resolveMomentPageEvidence,
  routeInsightsQuestion,
  shouldUseRouter,
  type TemporalContext,
} from '../src/main/lib/insightsQueryRouter.ts'

function setupDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  ensureSearchSchema(db)
  return db
}

function localMs(date: Date, hour: number, minute = 0, second = 0): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, second, 0).getTime()
}

function dateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function seedYoutubeAfternoon(db: Database.Database, day: Date): void {
  const start = localMs(day, 14, 14)
  const end = localMs(day, 15, 1)
  const evidence = {
    apps: [
      {
        bundleId: 'company.thebrowser.dia',
        canonicalAppId: 'dia',
        appName: 'Dia',
        category: 'browsing',
        totalSeconds: 2226,
        sessionCount: 8,
        isBrowser: true,
      },
    ],
    pages: [
      {
        id: 'art_grades',
        artifactType: 'page',
        canonicalKey: 'page:https://canvas.example/grades',
        displayTitle: 'Grades for Gentil Tonny Christian Iradukunda: Introduction to Machine Learning',
        subtitle: 'canvas.example',
        totalSeconds: 150,
        confidence: 0.85,
        domain: 'canvas.example',
        host: 'canvas.example',
        pageTitle: 'Grades for Gentil Tonny Christian Iradukunda: Introduction to Machine Learning',
        url: 'https://canvas.example/grades',
      },
      {
        id: 'art_yt_generic',
        artifactType: 'page',
        canonicalKey: 'page:https://www.youtube.com/',
        displayTitle: 'YouTube',
        subtitle: 'youtube.com',
        totalSeconds: 30,
        confidence: 0.85,
        domain: 'youtube.com',
        host: 'youtube.com',
        pageTitle: 'YouTube',
        url: 'https://www.youtube.com/',
      },
      {
        id: 'art_yt_smarthome',
        artifactType: 'page',
        canonicalKey: 'page:https://www.youtube.com/watch?v=smart',
        displayTitle: 'How I wasted $52,000 in my Dream Smart Home - YouTube',
        subtitle: 'youtube.com',
        totalSeconds: 205,
        confidence: 0.85,
        domain: 'youtube.com',
        host: 'youtube.com',
        pageTitle: 'How I wasted $52,000 in my Dream Smart Home - YouTube',
        url: 'https://www.youtube.com/watch?v=smart',
      },
      {
        id: 'art_yt_video',
        artifactType: 'page',
        canonicalKey: 'page:https://www.youtube.com/watch?v=DJ6yw3js7lI',
        displayTitle: 'I Found Out Why Chinese Performance Cars Are Taking Over - YouTube',
        subtitle: 'youtube.com',
        totalSeconds: 1200,
        confidence: 0.85,
        domain: 'youtube.com',
        host: 'youtube.com',
        pageTitle: 'I Found Out Why Chinese Performance Cars Are Taking Over - YouTube',
        url: 'https://www.youtube.com/watch?v=DJ6yw3js7lI',
      },
    ],
  }
  // heuristic must match TIMELINE_HEURISTIC_VERSION or the day is rebuilt
  // from sessions and pageRefs in evidence_summary_json are dropped.
  db.prepare(`
    INSERT INTO timeline_blocks (
      id, date, start_time, end_time, block_kind, dominant_category,
      category_distribution_json, switch_count, label_current, label_source,
      label_confidence, narrative_current, evidence_summary_json, is_live,
      heuristic_version, computed_at, invalidated_at
    ) VALUES (?, ?, ?, ?, 'work', 'entertainment', '{}', 0, ?, 'rule', 0.8, NULL, ?, 0, 'timeline-v10', ?, NULL)
  `).run(
    `blk_${dateStr(day)}_yt`,
    dateStr(day),
    start,
    end,
    'Watching YouTube',
    JSON.stringify(evidence),
    start,
  )
  db.prepare(`
    INSERT INTO app_sessions (
      bundle_id, app_name, start_time, end_time, duration_sec, category, is_focused,
      window_title, raw_app_name, canonical_app_id, capture_source, capture_version
    ) VALUES (?, ?, ?, ?, ?, 'browsing', 1, ?, ?, 'dia', 'test', 1)
  `).run(
    'company.thebrowser.dia',
    'Dia',
    start,
    end,
    Math.round((end - start) / 1000),
    'I Found Out Why Chinese Performance Cars Are Taking Over - YouTube',
    'Dia',
  )

  const insertVisit = db.prepare(`
    INSERT INTO website_visits (
      domain, page_title, url, visit_time, visit_time_us, duration_sec,
      browser_bundle_id, source
    ) VALUES (?, ?, ?, ?, ?, ?, 'company.thebrowser.dia', 'history')
  `)
  // Earlier videos in the same block — must NOT win a 3:00pm question.
  insertVisit.run(
    'youtube.com',
    'How I wasted $52,000 in my Dream Smart Home - YouTube',
    'https://www.youtube.com/watch?v=smart',
    localMs(day, 14, 15, 31),
    localMs(day, 14, 15, 31) * 1000,
    205,
  )
  insertVisit.run(
    'canvas.example',
    'Grades for Gentil Tonny Christian Iradukunda: Introduction to Machine Learning',
    'https://canvas.example/grades',
    localMs(day, 14, 50, 8),
    localMs(day, 14, 50, 8) * 1000,
    150,
  )
  // The visit actually covering 15:00.
  insertVisit.run(
    'youtube.com',
    'I Found Out Why Chinese Performance Cars Are Taking Over - YouTube',
    'https://www.youtube.com/watch?v=DJ6yw3js7lI',
    localMs(day, 14, 59, 43),
    localMs(day, 14, 59, 43) * 1000,
    65,
  )
}

test('formatMomentPageEvidence prefers real video titles over bare YouTube chrome', () => {
  const line = formatMomentPageEvidence([
    { pageTitle: 'YouTube', displayTitle: 'YouTube', host: 'youtube.com', domain: 'youtube.com', totalSeconds: 30 },
    {
      pageTitle: 'I Found Out Why Chinese Performance Cars Are Taking Over - YouTube',
      displayTitle: 'I Found Out Why Chinese Performance Cars Are Taking Over - YouTube',
      host: 'youtube.com',
      domain: 'youtube.com',
      totalSeconds: 1200,
    },
  ])
  assert.ok(line)
  assert.match(line!, /Chinese Performance Cars/)
  assert.doesNotMatch(line!, /^Pages: "YouTube"/)
})

test('formatMomentPageEvidence says no title when only site chrome exists', () => {
  const line = formatMomentPageEvidence([
    { pageTitle: '(26) YouTube', displayTitle: '(26) YouTube', host: 'youtube.com', domain: 'youtube.com' },
  ])
  assert.equal(line, 'Pages: youtube.com (no specific page title captured).')
})

test('resolveMomentPageEvidence prefers the visit covering the clock time over longer block pages', () => {
  const resolved = resolveMomentPageEvidence(
    [
      {
        pageTitle: 'How I wasted $52,000 in my Dream Smart Home - YouTube',
        displayTitle: 'How I wasted $52,000 in my Dream Smart Home - YouTube',
        host: 'youtube.com',
        domain: 'youtube.com',
        totalSeconds: 900,
      },
      {
        pageTitle: 'Grades for Gentil Tonny Christian Iradukunda: Introduction to Machine Learning',
        displayTitle: 'Grades for Gentil Tonny Christian Iradukunda: Introduction to Machine Learning',
        host: 'canvas.example',
        domain: 'canvas.example',
        totalSeconds: 150,
      },
    ],
    [
      {
        pageTitle: 'I Found Out Why Chinese Performance Cars Are Taking Over - YouTube',
        displayTitle: 'I Found Out Why Chinese Performance Cars Are Taking Over - YouTube',
        host: 'youtube.com',
        domain: 'youtube.com',
        url: 'https://www.youtube.com/watch?v=DJ6yw3js7lI',
        totalSeconds: 65,
        overlapMs: 65_000,
      },
    ],
  )
  assert.ok(resolved)
  assert.match(resolved!.title, /Chinese Performance Cars/)
  assert.equal(resolved!.verb, 'watching')
  assert.doesNotMatch(resolved!.title, /Grades|Smart Home/)
})

test('moment answer names the video active at 3pm, not every page in the block', async () => {
  const db = setupDb()
  // Past day so persisted blocks load instead of live provisional rebuild.
  const day = new Date(2026, 6, 7, 12, 0, 0, 0)
  seedYoutubeAfternoon(db, day)
  const routed = await routeInsightsQuestion(
    'What was I watching on Tuesday, July 7 at 3:00pm? Name the exact video title — not just YouTube or the browser.',
    new Date(2026, 6, 12, 14, 30),
    null,
    db,
  )
  assert.ok(routed)
  assert.equal(routed!.kind, 'answer')
  if (routed!.kind !== 'answer') throw new Error('unreachable')
  assert.match(routed.answer, /Chinese Performance Cars/)
  assert.match(routed.answer, /watching/i)
  assert.match(routed.answer, /Dia/)
  assert.doesNotMatch(routed.answer, /Grades for Gentil/)
  assert.doesNotMatch(routed.answer, /Smart Home/)
  assert.doesNotMatch(routed.answer, /Pages:/)
  assert.doesNotMatch(routed.answer, /Top apps in that block/)
  db.close()
})

test('Watching exactly what? reuses prior moment window and names the video', async () => {
  assert.equal(shouldUseRouter('Watching exactly what?'), true)

  const db = setupDb()
  const tuesday = new Date(2026, 6, 7, 12, 0, 0, 0)
  seedYoutubeAfternoon(db, tuesday)
  const previous: TemporalContext = {
    date: new Date(2026, 6, 7),
    timeWindow: {
      start: new Date(2026, 6, 7, 14, 50),
      end: new Date(2026, 6, 7, 15, 10),
    },
    weeklyBrief: null,
    entity: null,
  }
  const routed = await routeInsightsQuestion(
    'Watching exactly what?',
    new Date(2026, 6, 12, 14, 30),
    previous,
    db,
  )
  assert.ok(routed)
  assert.equal(routed!.kind, 'answer')
  if (routed!.kind !== 'answer') throw new Error('unreachable')
  assert.match(routed.answer, /Chinese Performance Cars/)
  assert.doesNotMatch(routed.answer, /Grades for Gentil/)
  assert.equal(routed.resolvedContext.date.getFullYear(), 2026)
  assert.equal(routed.resolvedContext.date.getMonth(), 6)
  assert.equal(routed.resolvedContext.date.getDate(), 7)
  assert.ok(routed.resolvedContext.timeWindow)
  db.close()
})
