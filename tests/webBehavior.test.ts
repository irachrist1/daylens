import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DaySnapshotV2 } from '@daylens/remote-contract'
import {
  buildSurfaceHref,
  getRangeBounds,
  listRangeDates,
  shiftRangeAnchor,
} from '../apps/web/app/lib/range.ts'
import {
  buildAppDetail,
  mergeDaySnapshots,
  sanitizeRecapSummary,
  topVisibleDomains,
} from '../apps/web/app/lib/presentation.ts'
import {
  MAX_MODEL_MESSAGE_CHARS,
  normalizeChatMessages,
  toModelMessages,
} from '../apps/web/app/lib/chat.ts'
import { getRemoteIssueCopy } from '../apps/web/app/lib/remoteUi.ts'
import { SyncBanner } from '../apps/web/app/components/SyncBanner.tsx'

function snapshot(
  date: string,
  options: { seconds?: number; privateFiltered?: boolean; blockId?: string } = {},
): DaySnapshotV2 {
  const seconds = options.seconds ?? 1800
  const blockId = options.blockId ?? 'block:1'
  return {
    schemaVersion: 2,
    deviceId: 'desktop:test',
    platform: 'macos',
    date,
    generatedAt: `${date}T17:00:00.000Z`,
    isPartialDay: false,
    focusScore: 80,
    focusSeconds: seconds,
    appSummaries: [
      {
        appKey: 'VSCode',
        displayName: 'VisualStudioCode.exe',
        category: 'development',
        totalSeconds: seconds,
        sessionCount: 1,
      },
      {
        appKey: 'Slack',
        displayName: 'Slack',
        category: 'communication',
        totalSeconds: 300,
        sessionCount: 1,
      },
    ],
    categoryTotals: [
      { category: 'development', totalSeconds: seconds },
      { category: 'communication', totalSeconds: 300 },
    ],
    timeline: [
      {
        appKey: 'VSCode',
        startAt: `${date}T09:00:00.000Z`,
        endAt: `${date}T09:30:00.000Z`,
      },
    ],
    topDomains: [
      {
        domain: 'github.com',
        seconds: 600,
        category: 'development',
        topPages: [
          { domain: 'github.com', label: 'Reviewing the sync pull request', seconds: 600 },
        ],
      },
      {
        domain: '/Users/person/private',
        seconds: 999,
        category: 'uncategorized',
        topPages: [],
      },
    ],
    categoryOverrides: {},
    aiSummary: null,
    focusSessions: [],
    focusScoreV2: {
      deepWorkPct: 80,
      longestStreakSeconds: seconds,
      switchCount: 1,
      deepWorkSessionCount: 1,
    },
    workBlocks: [
      {
        id: blockId,
        startAt: `${date}T09:00:00.000Z`,
        endAt: `${date}T09:30:00.000Z`,
        label: 'Implementing remote verification',
        labelSource: 'rule',
        dominantCategory: 'development',
        focusSeconds: seconds,
        switchCount: 1,
        confidence: 'high',
        topApps: [
          { appKey: 'VSCode', seconds },
          { appKey: 'Slack', seconds: 300 },
        ],
        topPages: [
          { domain: 'github.com', label: 'Reviewing the sync pull request', seconds: 600 },
        ],
        artifactIds: [],
      },
    ],
    recap: {
      day: {
        headline: 'A focused implementation session',
        chapters: [
          {
            id: 'headline',
            eyebrow: 'Timeline',
            title: 'Remote verification',
            body: 'Built deterministic coverage for the remote presentation path.',
          },
        ],
        metrics: [{ label: 'Focus time', value: '30m', detail: 'One block' }],
        changeSummary: '',
        promptChips: ['What changed in the remote path?'],
        hasData: true,
      },
      week: null,
      month: null,
    },
    coverage: {
      attributedPct: 100,
      untitledPct: 0,
      activeDayCount: 1,
      quietDayCount: 0,
      hasComparison: false,
      coverageNote: null,
    },
    topWorkstreams: [{ label: 'Remote verification', seconds, blockCount: 1, isUntitled: false }],
    standoutArtifacts: [],
    entities: [
      {
        id: 'project:daylens',
        label: 'Daylens',
        kind: 'project',
        secondsToday: seconds,
        blockCount: 1,
      },
    ],
    privacyFiltered: options.privateFiltered ?? false,
  }
}

test('web day, week, and month navigation uses calendar boundaries across year and leap-day edges', () => {
  assert.deepEqual(getRangeBounds('2026-01-01', 'week'), {
    from: '2025-12-29',
    to: '2026-01-04',
  })
  assert.deepEqual(getRangeBounds('2024-02-29', 'month'), {
    from: '2024-02-01',
    to: '2024-02-29',
  })
  assert.equal(listRangeDates('2024-02-29', 'month').length, 29)
  assert.equal(shiftRangeAnchor('2026-12-15', 'month', 1), '2027-01-15')
  assert.equal(buildSurfaceHref('/apps', '2026-07-14', 'week'), '/apps?date=2026-07-14&range=week')
})

test('web range presentation aggregates facts without colliding same-day block ids', () => {
  const first = snapshot('2026-07-13', { seconds: 1200, blockId: 'block:1' })
  const second = snapshot('2026-07-14', {
    seconds: 2400,
    privateFiltered: true,
    blockId: 'block:1',
  })
  const merged = mergeDaySnapshots([second, first], '2026-07-14')

  assert.equal(merged.focusSeconds, 3600)
  assert.equal(merged.appSummaries.find((app) => app.appKey === 'VSCode')?.totalSeconds, 3600)
  assert.deepEqual(
    merged.workBlocks.map((block) => block.id),
    ['2026-07-13:block:1', '2026-07-14:block:1'],
  )
  assert.equal(merged.entities[0]?.secondsToday, 3600)
  assert.equal(merged.privacyFiltered, true)
})

test('web Apps detail and recap expose useful labels while hiding raw paths and low-value evidence', () => {
  const day = snapshot('2026-07-14')
  const vscode = day.appSummaries[0]
  assert.ok(vscode)
  const detail = buildAppDetail(day, vscode)

  assert.deepEqual(detail.headlineLabels, ['Implementing remote verification'])
  assert.equal(detail.alongsideApps[0]?.displayName, 'Slack')
  assert.deepEqual(detail.relatedSites, [
    { label: 'Reviewing the sync pull request', domain: 'github.com', seconds: 600 },
  ])
  assert.deepEqual(topVisibleDomains(day.topDomains), [
    { label: 'Reviewing the sync pull request', domain: 'github.com', seconds: 600 },
  ])
  assert.equal(sanitizeRecapSummary(day.recap.day)?.headline, 'A focused implementation session')

  const unsafe = structuredClone(day.recap.day)
  unsafe.headline = '/Users/person/private/client-plan.md'
  assert.equal(sanitizeRecapSummary(unsafe), null)
})

test('web chat rejects invalid records and sends only bounded recent conversation text', () => {
  const input = [
    { role: 'system', content: 'secret system text' },
    { role: 'user', content: 'oldest valid message' },
    ...Array.from({ length: 21 }, (_, index) => ({
      role: index % 2 === 0 ? 'assistant' : 'user',
      content: index === 20 ? 'x'.repeat(MAX_MODEL_MESSAGE_CHARS + 500) : `message ${index}`,
      toolsUsed: index === 1 ? ['timeline', 42] : undefined,
    })),
    null,
  ]
  const normalized = normalizeChatMessages(input)
  assert.equal(
    normalized.some((message) => message.content.includes('system text')),
    false,
  )

  const modelMessages = toModelMessages(normalized)
  assert.equal(modelMessages.length, 20)
  assert.equal(
    modelMessages.some((message) => message.content === 'oldest valid message'),
    false,
  )
  assert.equal(modelMessages.at(-1)?.content.endsWith('[message truncated]'), true)
  assert.ok((modelMessages.at(-1)?.content.length ?? 0) <= MAX_MODEL_MESSAGE_CHARS)
})

test('web sync status gives actionable pending, failed, stale, and deployment-mismatch states', () => {
  const pending = renderToStaticMarkup(
    createElement(SyncBanner, {
      status: { health: 'pending_first_sync' },
    }),
  )
  assert.match(pending, /no synced day has landed yet/i)

  const failed = renderToStaticMarkup(
    createElement(SyncBanner, {
      status: {
        health: 'failed',
        lastHeartbeatAt: Date.now() - 5_000,
        latestFailure: { reason: 'invalid_payload' },
      },
    }),
  )
  assert.match(failed, /Sync failed: invalid_payload/)
  assert.match(failed, /Heartbeat is still arriving/)

  const stale = renderToStaticMarkup(
    createElement(SyncBanner, {
      status: { health: 'stale', lastSuccessfulSyncAt: Date.now() - 120_000 },
    }),
  )
  assert.match(stale, /Open Daylens on your laptop/)

  const mismatch = getRemoteIssueCopy('Could not find public function listTimelineSummaries', {
    title: 'Could not load',
    detail: 'Try again.',
  })
  assert.equal(mismatch.title, 'Cloud update still in progress')
  assert.match(mismatch.detail, /backend update/i)
})
