import test from 'node:test'
import assert from 'node:assert/strict'
import type {
  ArtifactRef,
  DayTimelinePayload,
  DocumentRef,
  PageRef,
  WebsiteSummary,
  WorkContextAppSummary,
  WorkContextBlock,
  WorkflowRef,
} from '../src/shared/types.ts'
import { buildRecapSummaries, getMonthStart, getWeekStart, recapDateWindow, shiftDate } from '../src/renderer/lib/recap.ts'

function makeArtifact(title: string, totalSeconds: number): ArtifactRef {
  return {
    id: `artifact:${title}`,
    artifactType: 'document',
    displayTitle: title,
    totalSeconds,
    confidence: 0.9,
    openTarget: { kind: 'unsupported', value: null },
  }
}

function makeDocumentRef(title: string, totalSeconds: number): DocumentRef {
  return {
    ...makeArtifact(title, totalSeconds),
    artifactType: 'document',
    sourceSessionIds: [],
  }
}

function makePage(title: string, domain: string, url: string, totalSeconds: number): PageRef {
  return {
    id: `page:${domain}:${title}`,
    artifactType: 'page',
    displayTitle: title,
    pageTitle: title,
    domain,
    totalSeconds,
    confidence: 0.9,
    openTarget: { kind: 'external_url', value: url },
    url,
    normalizedUrl: url,
  }
}

function makeWebsite(domain: string, totalSeconds: number, topTitle: string | null): WebsiteSummary {
  return {
    domain,
    totalSeconds,
    visitCount: 1,
    topTitle,
    browserBundleId: 'arc.bundle',
    canonicalBrowserId: 'arc',
  }
}

function makeApp(appName: string, category: WorkContextAppSummary['category'], totalSeconds: number, isBrowser = false): WorkContextAppSummary {
  return {
    bundleId: `${appName.toLowerCase()}.bundle`,
    appName,
    category,
    totalSeconds,
    sessionCount: 1,
    isBrowser,
  }
}

function makeWorkflow(label: string): WorkflowRef {
  return {
    id: `workflow:${label}`,
    signatureKey: label,
    label,
    confidence: 0.7,
    dominantCategory: 'development',
    canonicalApps: [],
    artifactKeys: [],
  }
}

function makeBlock(label: string, startTime: number, durationSeconds: number, options?: {
  dominantCategory?: WorkContextBlock['dominantCategory']
  switchCount?: number
  artifacts?: ArtifactRef[]
  topApps?: WorkContextAppSummary[]
  websites?: WebsiteSummary[]
  pageRefs?: PageRef[]
  documentRefs?: DocumentRef[]
  workflowRefs?: WorkflowRef[]
}): WorkContextBlock {
  return {
    id: `block:${label}:${startTime}`,
    startTime,
    endTime: startTime + durationSeconds * 1_000,
    dominantCategory: options?.dominantCategory ?? 'development',
    categoryDistribution: { [options?.dominantCategory ?? 'development']: durationSeconds },
    ruleBasedLabel: label,
    aiLabel: null,
    sessions: [],
    topApps: options?.topApps ?? [],
    websites: options?.websites ?? [],
    keyPages: [],
    pageRefs: options?.pageRefs ?? [],
    documentRefs: options?.documentRefs ?? [],
    topArtifacts: options?.artifacts ?? [],
    workflowRefs: options?.workflowRefs ?? [],
    label: {
      current: label,
      source: 'rule',
      confidence: 0.92,
      narrative: null,
      ruleBased: label,
      aiSuggested: null,
      override: null,
    },
    focusOverlap: {
      totalSeconds: durationSeconds,
      pct: 100,
      sessionIds: [],
    },
    evidenceSummary: {
      apps: [],
      pages: [],
      documents: [],
      domains: [],
    },
    heuristicVersion: 'test',
    computedAt: startTime,
    switchCount: options?.switchCount ?? 0,
    confidence: 'high',
    isLive: false,
  }
}

function makeDay(date: string, options: {
  totalSeconds: number
  focusSeconds?: number
  blocks?: WorkContextBlock[]
  focusSessionCount?: number
}): DayTimelinePayload {
  return {
    date,
    sessions: [],
    websites: [],
    blocks: options.blocks ?? [],
    segments: [],
    focusSessions: Array.from({ length: options.focusSessionCount ?? 0 }, (_, index) => ({
      id: index + 1,
      startTime: new Date(`${date}T09:00:00`).getTime(),
      endTime: new Date(`${date}T09:30:00`).getTime(),
      durationSeconds: 30 * 60,
      label: 'Focus',
      targetMinutes: 30,
      plannedApps: [],
    })),
    computedAt: Date.now(),
    version: 'test',
    totalSeconds: options.totalSeconds,
    focusSeconds: options.focusSeconds ?? options.totalSeconds,
    focusPct: options.totalSeconds > 0 ? Math.round(((options.focusSeconds ?? options.totalSeconds) / options.totalSeconds) * 100) : 0,
    appCount: 0,
    siteCount: 0,
  }
}

test('daily recap highlights the main thread, deep stretch, and artifacts', () => {
  const today = '2026-04-19'
  const buildSpec = makeBlock(
    'Launch polish',
    new Date('2026-04-19T09:00:00').getTime(),
    2 * 3600,
    {
      switchCount: 2,
      artifacts: [makeArtifact('build/dmg-background.svg', 2 * 3600)],
    },
  )
  const validateSpec = makeBlock(
    'Provider validation',
    new Date('2026-04-19T12:00:00').getTime(),
    75 * 60,
    {
      switchCount: 1,
      artifacts: [makeArtifact('src/renderer/views/Insights.tsx', 75 * 60)],
    },
  )

  const recap = buildRecapSummaries([
    makeDay(today, {
      totalSeconds: 3 * 3600 + 15 * 60,
      focusSeconds: 2 * 3600 + 30 * 60,
      focusSessionCount: 2,
      blocks: [buildSpec, validateSpec],
    }),
    makeDay(shiftDate(today, -1), { totalSeconds: 90 * 60, focusSeconds: 45 * 60 }),
  ], today)

  assert.equal(recap.day.hasData, true)
  assert.match(recap.day.summary, /Launch polish/)
  assert.match(recap.day.summary, /build\/dmg-background\.svg/)
  assert.equal(recap.day.metrics[0]?.label, 'Tracked')
  assert.equal(recap.day.topWorkstreams[0]?.label, 'Launch polish')
})

test('weekly recap compares against the same point last week', () => {
  const today = '2026-04-16'
  const weekStart = getWeekStart(today)
  const previousWeekStart = shiftDate(weekStart, -7)

  const payloads = [
    makeDay(weekStart, {
      totalSeconds: 2 * 3600,
      focusSeconds: 90 * 60,
      blocks: [makeBlock('Recap work', new Date(`${weekStart}T09:00:00`).getTime(), 2 * 3600)],
    }),
    makeDay(shiftDate(weekStart, 1), {
      totalSeconds: 3 * 3600,
      focusSeconds: 2 * 3600,
      blocks: [makeBlock('Recap work', new Date(`${shiftDate(weekStart, 1)}T10:00:00`).getTime(), 3 * 3600)],
    }),
    makeDay(previousWeekStart, {
      totalSeconds: 60 * 60,
      focusSeconds: 30 * 60,
      blocks: [makeBlock('Older thread', new Date(`${previousWeekStart}T09:00:00`).getTime(), 60 * 60)],
    }),
    makeDay(shiftDate(previousWeekStart, 1), {
      totalSeconds: 90 * 60,
      focusSeconds: 45 * 60,
      blocks: [makeBlock('Older thread', new Date(`${shiftDate(previousWeekStart, 1)}T09:00:00`).getTime(), 90 * 60)],
    }),
  ]

  const recap = buildRecapSummaries(payloads, today)

  assert.equal(recap.week.trend.length, 4)
  assert.match(recap.week.changeSummary, /the same point last week/)
  assert.match(recap.week.changeSummary, /rose|improved|shifted/)
  assert.equal(recap.week.topWorkstreams[0]?.label, 'Recap work')
})

test('monthly recap handles empty data honestly', () => {
  const today = '2026-04-19'
  const recap = buildRecapSummaries([], today)

  assert.equal(recap.month.hasData, false)
  assert.match(recap.month.summary, /No tracked activity yet this month/)
  assert.match(recap.month.changeSummary, /Last month/)
})

test('recap date window covers the previous month through today', () => {
  const today = '2026-04-19'
  const dates = recapDateWindow(today)

  assert.equal(dates[0], '2026-03-01')
  assert.equal(dates.at(-1), today)
  assert.equal(dates.includes(getMonthStart(today)), true)
})

test('daily recap chapters tell a paced story with focus and artifacts', () => {
  const today = '2026-04-19'
  const buildSpec = makeBlock(
    'Launch polish',
    new Date('2026-04-19T09:00:00').getTime(),
    2 * 3600,
    {
      switchCount: 5,
      artifacts: [makeArtifact('build/dmg-background.svg', 2 * 3600)],
    },
  )

  const recap = buildRecapSummaries([
    makeDay(today, {
      totalSeconds: 2 * 3600,
      focusSeconds: 90 * 60,
      focusSessionCount: 1,
      blocks: [buildSpec],
    }),
  ], today)

  const chapterIds = recap.day.chapters.map((chapter) => chapter.id)
  assert.ok(chapterIds.includes('headline'))
  assert.ok(chapterIds.includes('focus'))
  assert.ok(chapterIds.includes('artifacts'))
  const focusChapter = recap.day.chapters.find((chapter) => chapter.id === 'focus')
  assert.ok(focusChapter && /handoff/.test(focusChapter.body))
  assert.match(recap.day.headline, /Launch polish/)
  const promptsJoined = recap.day.promptChips.join(' | ')
  assert.match(promptsJoined, /Launch polish/)
})

test('recap coverage honestly reports when most time is in unnamed blocks', () => {
  const today = '2026-04-19'
  const blocks: ReturnType<typeof makeBlock>[] = [
    makeBlock('', new Date('2026-04-19T09:00:00').getTime(), 90 * 60),
    makeBlock('', new Date('2026-04-19T11:00:00').getTime(), 60 * 60),
    makeBlock('Deep work', new Date('2026-04-19T13:00:00').getTime(), 30 * 60),
  ]

  const recap = buildRecapSummaries([
    makeDay(today, {
      totalSeconds: 3 * 3600,
      focusSeconds: 2 * 3600,
      blocks,
    }),
  ], today)

  assert.ok(recap.day.coverage.untitledPct >= 50)
  assert.ok(recap.day.coverage.coverageNote && /unnamed|generic context/.test(recap.day.coverage.coverageNote))
  assert.match(recap.day.headline, /unlabeled|partial/)
})

test('weekly recap surfaces rhythm chapter with peak day and quiet days', () => {
  const today = '2026-04-19'
  const weekStart = getWeekStart(today)

  const payloads = [
    makeDay(weekStart, {
      totalSeconds: 4 * 3600,
      focusSeconds: 3 * 3600,
      blocks: [makeBlock('Deep thread', new Date(`${weekStart}T09:00:00`).getTime(), 4 * 3600)],
    }),
    makeDay(shiftDate(weekStart, 1), { totalSeconds: 0 }),
    makeDay(shiftDate(weekStart, 2), {
      totalSeconds: 2 * 3600,
      focusSeconds: 60 * 60,
      blocks: [makeBlock('Deep thread', new Date(`${shiftDate(weekStart, 2)}T09:00:00`).getTime(), 2 * 3600)],
    }),
  ]

  const recap = buildRecapSummaries(payloads, shiftDate(weekStart, 2))
  const rhythm = recap.week.chapters.find((chapter) => chapter.id === 'rhythm')
  assert.ok(rhythm, 'week recap should include a rhythm chapter')
  assert.match(rhythm!.body, /Busiest day/)
  assert.match(rhythm!.body, /no captured activity|had no captured/)
})

test('monthly recap clips long months to a truthful matched window', () => {
  const today = '2026-05-31'
  const monthStart = getMonthStart(today)
  const previousMonthStart = shiftDate(monthStart, -30)

  const payloads = [
    ...Array.from({ length: 31 }, (_, index) => {
      const date = shiftDate(monthStart, index)
      return makeDay(date, {
        totalSeconds: 60 * 60,
        focusSeconds: 45 * 60,
        blocks: [makeBlock('Monthly recap work', new Date(`${date}T09:00:00`).getTime(), 60 * 60)],
      })
    }),
    ...Array.from({ length: 30 }, (_, index) => {
      const date = shiftDate(previousMonthStart, index)
      return makeDay(date, {
        totalSeconds: 30 * 60,
        focusSeconds: 15 * 60,
        blocks: [makeBlock('Previous month work', new Date(`${date}T09:00:00`).getTime(), 30 * 60)],
      })
    }),
  ]

  const recap = buildRecapSummaries(payloads, today)

  assert.equal(recap.month.subtitle, 'First 30 days of this month')
  assert.match(recap.month.changeSummary, /the first 30 days of last month/)
  assert.equal(recap.month.trend.length, 30)
  assert.equal(recap.month.trend.at(-1)?.date, '2026-05-30')
})

test('workstream list keeps dominant unnamed work visible when it belongs in the top three', () => {
  const today = '2026-04-19'
  const blocks = [
    makeBlock('Client A', new Date('2026-04-19T09:00:00').getTime(), 120 * 60),
    makeBlock('', new Date('2026-04-19T11:30:00').getTime(), 110 * 60),
    makeBlock('Client B', new Date('2026-04-19T13:30:00').getTime(), 100 * 60),
    makeBlock('Client C', new Date('2026-04-19T15:30:00').getTime(), 90 * 60),
  ]

  const recap = buildRecapSummaries([
    makeDay(today, {
      totalSeconds: 420 * 60,
      focusSeconds: 300 * 60,
      blocks,
    }),
  ], today)

  const labels = recap.day.topWorkstreams.map((item) => item.label)
  assert.deepEqual(labels, ['Client A', 'Unnamed work blocks', 'Client B'])
})

test('daily recap de-prioritizes generic X feed loops when a clearer execution thread exists', () => {
  const today = '2026-04-19'
  const base = new Date(`${today}T09:00:00`).getTime()
  const ambientX = makePage('X (Twitter)', 'x.com', 'https://x.com/home', 4 * 3600)
  const executionDoc = makeDocumentRef('src/renderer/views/Insights.tsx', 90 * 60)

  const recap = buildRecapSummaries([
    makeDay(today, {
      totalSeconds: 6 * 3600,
      focusSeconds: 2 * 3600,
      blocks: [
        makeBlock('X (Twitter)', base, 4 * 3600, {
          dominantCategory: 'browsing',
          topApps: [makeApp('Arc', 'browsing', 4 * 3600, true)],
          websites: [makeWebsite('x.com', 4 * 3600, 'X (Twitter)')],
          pageRefs: [ambientX],
          artifacts: [ambientX],
          switchCount: 8,
        }),
        makeBlock('Daylens', base + 4 * 3600_000 + 60_000, 90 * 60, {
          dominantCategory: 'development',
          topApps: [makeApp('Code', 'development', 90 * 60)],
          documentRefs: [executionDoc],
          artifacts: [executionDoc],
          switchCount: 2,
        }),
      ],
    }),
  ], today)

  assert.doesNotMatch(recap.day.headline, /Today leaned on X \(Twitter\)/)
  assert.match(recap.day.headline, /mixed context|Insights\.tsx|Execution work/i)
  const focusChapter = recap.day.chapters.find((chapter) => chapter.id === 'focus')
  assert.ok(focusChapter)
  assert.doesNotMatch(focusChapter!.body, /Deepest stretch: .*X \(Twitter\)/)
  const artifactChapter = recap.day.chapters.find((chapter) => chapter.id === 'artifacts')
  assert.ok(artifactChapter)
  assert.match(artifactChapter!.body, /Insights\.tsx/)
  assert.doesNotMatch(artifactChapter!.body, /X \(Twitter\)/)
})

test('daily recap avoids workflow app-pair labels and low-signal social or entertainment artifacts', () => {
  const today = '2026-04-19'
  const base = new Date(`${today}T09:00:00`).getTime()

  const recap = buildRecapSummaries([
    makeDay(today, {
      totalSeconds: 5 * 3600,
      focusSeconds: 90 * 60,
      blocks: [
        makeBlock('X (Twitter)', base, 2 * 3600, {
          dominantCategory: 'browsing',
          topApps: [
            makeApp('Dia', 'browsing', 2 * 3600, true),
            makeApp('Warp', 'development', 20 * 60),
          ],
          websites: [
            makeWebsite('x.com', 70 * 60, 'X (Twitter)'),
            makeWebsite('localhost', 20 * 60, 'Daylens — Searchable work history for your laptop'),
          ],
          pageRefs: [
            makePage('X (Twitter)', 'x.com', 'https://x.com/home', 70 * 60),
            makePage('Daylens — Searchable work history for your laptop', 'localhost', 'http://localhost:3000/daylens', 20 * 60),
            makePage('Garry Tan on X: "Something something" / X', 'x.com', 'https://x.com/post/1', 10 * 60),
          ],
          artifacts: [
            makePage('X (Twitter)', 'x.com', 'https://x.com/home', 70 * 60),
            makePage('Daylens — Searchable work history for your laptop', 'localhost', 'http://localhost:3000/daylens', 20 * 60),
            makePage('Garry Tan on X: "Something something" / X', 'x.com', 'https://x.com/post/1', 10 * 60),
          ],
          workflowRefs: [makeWorkflow('Dia + Warp')],
          switchCount: 5,
        }),
        makeBlock('Loading…', base + 2 * 3600_000 + 60_000, 75 * 60, {
          dominantCategory: 'browsing',
          topApps: [
            makeApp('Dia', 'browsing', 55 * 60, true),
            makeApp('Warp', 'development', 20 * 60),
          ],
          websites: [
            makeWebsite('app.raindrop.io', 30 * 60, 'Loading…'),
            makeWebsite('ww1.goojara.to', 20 * 60, 'Watch Inception (2010)'),
          ],
          pageRefs: [
            makePage('Loading…', 'app.raindrop.io', 'https://app.raindrop.io/my/0', 30 * 60),
            makePage('Watch Inception (2010)', 'ww1.goojara.to', 'https://ww1.goojara.to/mKZNZ7', 20 * 60),
          ],
          artifacts: [
            makePage('Loading…', 'app.raindrop.io', 'https://app.raindrop.io/my/0', 30 * 60),
            makePage('Watch Inception (2010)', 'ww1.goojara.to', 'https://ww1.goojara.to/mKZNZ7', 20 * 60),
          ],
          workflowRefs: [makeWorkflow('Dia + Warp')],
          switchCount: 4,
        }),
      ],
    }),
  ], today)

  assert.doesNotMatch(recap.day.headline, /Dia \+ Warp|Loading|X \(Twitter\)/)
  assert.match(recap.day.headline, /Daylens|Research|context/i)
  const artifactChapter = recap.day.chapters.find((chapter) => chapter.id === 'artifacts')
  assert.ok(artifactChapter)
  assert.match(artifactChapter!.body, /Daylens/)
  assert.doesNotMatch(artifactChapter!.body, /Watch Inception|Garry Tan on X|X \(Twitter\)|Loading/)
})
