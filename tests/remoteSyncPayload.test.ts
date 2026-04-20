import test from 'node:test'
import assert from 'node:assert/strict'
import type { DaySnapshotV2 } from '../src/shared/snapshot.ts'
import { buildRemoteSyncPayloadFromSnapshot } from '../src/main/services/remoteSync.ts'

function makeSnapshot(): DaySnapshotV2 {
  return {
    schemaVersion: 2,
    deviceId: 'desktop-1',
    platform: 'macos',
    date: '2026-04-20',
    generatedAt: '2026-04-20T10:30:00.000Z',
    isPartialDay: true,
    focusScore: 72,
    focusSeconds: 7_200,
    appSummaries: [],
    categoryTotals: [],
    timeline: [],
    topDomains: [],
    categoryOverrides: {},
    aiSummary: null,
    focusSessions: [],
    focusScoreV2: {
      score: 72,
      coherence: 0.7,
      deepWorkDensity: 0.6,
      artifactProgress: 0.4,
      switchPenalty: 0.2,
    },
    workBlocks: [
      {
        id: 'blk_1',
        startAt: '2026-04-20T09:00:00.000Z',
        endAt: '2026-04-20T10:00:00.000Z',
        label: 'Client launch fixes',
        labelSource: 'rule',
        dominantCategory: 'development',
        focusSeconds: 3_300,
        switchCount: 2,
        confidence: 'high',
        topApps: [{ appKey: 'code', seconds: 2_400 }],
        topPages: [{ domain: 'github.com', label: 'Pull request review', seconds: 900 }],
        artifactIds: ['art_private_window'],
      },
    ],
    recap: {
      day: {
        headline: 'Reviewed a private pull request and drafted rollout notes.',
        chapters: [],
        metrics: [],
        changeSummary: '',
        promptChips: [],
        hasData: true,
      },
      week: null,
      month: null,
    },
    coverage: {
      attributedPct: 0.8,
      untitledPct: 0.2,
      activeDayCount: 1,
      quietDayCount: 0,
      hasComparison: false,
      coverageNote: null,
    },
    topWorkstreams: [
      { label: 'Client launch fixes', seconds: 3_600, blockCount: 1, isUntitled: false },
    ],
    standoutArtifacts: [
      {
        id: 'artifact:private-window-title',
        kind: 'report',
        title: 'Very Private Window Title',
        byteSize: 123,
        generatedAt: '2026-04-20T10:00:00.000Z',
        threadId: null,
      },
    ],
    entities: [
      { id: 'project:launch', label: 'Launch', kind: 'project', secondsToday: 3_600, blockCount: 1 },
    ],
    privacyFiltered: false,
  }
}

test('remote sync payload strips block artifact refs and only keeps approved synced artifacts', () => {
  const payload = buildRemoteSyncPayloadFromSnapshot(makeSnapshot(), 'desktop-1', {
    artifacts: [
      {
        id: 'ai_artifact_9',
        kind: 'report',
        title: 'Launch status report',
        byteSize: 2048,
        generatedAt: '2026-04-20T10:05:00.000Z',
        threadId: 'wth_safe',
      },
    ],
  })

  assert.deepEqual(payload.workBlocks[0]?.artifactIds, [])
  assert.deepEqual(payload.artifacts.map((artifact) => artifact.title), ['Launch status report'])
  assert.equal(payload.daySummary.artifactCount, 1)
  assert.equal(payload.daySummary.privacyFiltered, true)
})

test('remote sync payload uses privacy-safe recap copy instead of local raw recap text', () => {
  const payload = buildRemoteSyncPayloadFromSnapshot(makeSnapshot(), 'desktop-1', { artifacts: [] })

  assert.match(payload.daySummary.recap.day.headline, /synced work blocks/i)
  assert.doesNotMatch(payload.daySummary.recap.day.headline, /private pull request/i)
  assert.equal(payload.daySummary.recap.week, null)
  assert.equal(payload.daySummary.recap.month, null)
  assert.equal(payload.workBlocks[0]?.topPages[0]?.label, 'github.com')
})
