import type { RemoteSyncPayload, WorkspaceLivePresence } from '@daylens/remote-contract'

export const FIXTURE_WORKSPACE_ID = 'workspaces:test'
export const FIXTURE_DEVICE_ID = 'desktop:test'
export const FIXTURE_LOCAL_DATE = '2026-07-14'
export const FIXTURE_GENERATED_AT = '2026-07-14T16:00:00.000Z'

/**
 * Intentionally dirty day-sync payload used by server sanitizer roundtrip tests.
 * Paths, unrestricted page titles, and local-file artifact ids must fail the
 * client sync allowlist; the Convex sanitizer strips them after receipt.
 */
export function makeDirtyRemoteSyncPayload(
  overrides: Partial<RemoteSyncPayload> = {},
): RemoteSyncPayload {
  const payload: RemoteSyncPayload = {
    contractVersion: '2026-04-20-r2',
    deviceId: FIXTURE_DEVICE_ID,
    localDate: FIXTURE_LOCAL_DATE,
    generatedAt: FIXTURE_GENERATED_AT,
    daySummary: {
      contractVersion: '2026-04-20-r2',
      deviceId: FIXTURE_DEVICE_ID,
      localDate: FIXTURE_LOCAL_DATE,
      generatedAt: FIXTURE_GENERATED_AT,
      isPartialDay: false,
      focusScore: 82,
      focusSeconds: 3600,
      focusScoreV2: {
        deepWorkPct: 82,
        longestStreakSeconds: 3600,
        switchCount: 2,
        deepWorkSessionCount: 1,
      },
      recap: {
        day: {
          headline: 'A deliberately untrusted desktop recap',
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
        attributedPct: 100,
        untitledPct: 0,
        activeDayCount: 1,
        quietDayCount: 0,
        hasComparison: false,
        coverageNote: null,
      },
      topWorkstreams: [],
      latestWorkBlockId: 'block:1',
      workBlockCount: 1,
      entityCount: 1,
      artifactCount: 1,
      privacyFiltered: true,
    },
    workBlocks: [
      {
        id: 'block:1',
        startAt: '2026-07-14T14:00:00.000Z',
        endAt: '2026-07-14T15:00:00.000Z',
        label: '/Users/person/private/client-plan.md',
        labelSource: 'rule',
        dominantCategory: 'development',
        focusSeconds: 3600,
        switchCount: 2,
        confidence: 'high',
        topApps: [
          { appKey: 'com.microsoft.VSCode', seconds: 3300 },
          { appKey: 'unknown-123', seconds: 300 },
        ],
        topPages: [{ domain: 'github.com', label: 'Secret Client · GitHub', seconds: 900 }],
        artifactIds: ['local-file:/Users/person/private/client-plan.md'],
      },
    ],
    entities: [
      {
        id: 'project:daylens',
        label: 'Daylens',
        kind: 'project',
        secondsToday: 3600,
        blockCount: 1,
      },
    ],
    artifacts: [
      {
        id: 'artifact:1',
        kind: 'report',
        title: 'Daily report',
        byteSize: 1024,
        generatedAt: FIXTURE_GENERATED_AT,
        threadId: null,
      },
    ],
  }
  return { ...payload, ...overrides }
}

/**
 * Post-boundary clean shape: what remains after privacy sanitization.
 * Must pass the sync allowlist unchanged.
 */
export function makeCleanRemoteSyncPayload(
  overrides: Partial<RemoteSyncPayload> = {},
): RemoteSyncPayload {
  const payload: RemoteSyncPayload = {
    contractVersion: '2026-04-20-r2',
    deviceId: FIXTURE_DEVICE_ID,
    localDate: FIXTURE_LOCAL_DATE,
    generatedAt: FIXTURE_GENERATED_AT,
    daySummary: {
      contractVersion: '2026-04-20-r2',
      deviceId: FIXTURE_DEVICE_ID,
      localDate: FIXTURE_LOCAL_DATE,
      generatedAt: FIXTURE_GENERATED_AT,
      isPartialDay: false,
      focusScore: 82,
      focusSeconds: 3600,
      focusScoreV2: {
        deepWorkPct: 82,
        longestStreakSeconds: 3600,
        switchCount: 2,
        deepWorkSessionCount: 1,
      },
      recap: {
        day: {
          headline: 'Tracked 1h 0m across 1 synced work blocks. Main thread: VSCode.',
          chapters: [
            {
              id: 'headline',
              eyebrow: 'Timeline',
              title: 'What the synced day shows',
              body: 'Tracked 1h 0m across 1 synced work blocks. Main thread: VSCode.',
            },
          ],
          metrics: [
            {
              label: 'Focus time',
              value: '1h 0m',
              detail: '1 synced work blocks',
            },
          ],
          changeSummary: '',
          promptChips: ['What was I working on most today?'],
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
      topWorkstreams: [
        {
          label: 'VSCode',
          seconds: 3600,
          blockCount: 1,
          isUntitled: false,
        },
      ],
      latestWorkBlockId: 'block:1',
      workBlockCount: 1,
      entityCount: 1,
      artifactCount: 1,
      privacyFiltered: true,
    },
    workBlocks: [
      {
        id: 'block:1',
        startAt: '2026-07-14T14:00:00.000Z',
        endAt: '2026-07-14T15:00:00.000Z',
        label: 'VSCode',
        labelSource: 'rule',
        dominantCategory: 'development',
        focusSeconds: 3600,
        switchCount: 2,
        confidence: 'high',
        topApps: [{ appKey: 'VSCode', seconds: 3300 }],
        topPages: [{ domain: 'github.com', label: 'github.com', seconds: 900 }],
        artifactIds: [],
      },
    ],
    entities: [
      {
        id: 'project:daylens',
        label: 'Daylens',
        kind: 'project',
        secondsToday: 3600,
        blockCount: 1,
      },
    ],
    artifacts: [
      {
        id: 'artifact:1',
        kind: 'report',
        title: 'Daily report',
        byteSize: 1024,
        generatedAt: FIXTURE_GENERATED_AT,
        threadId: null,
      },
    ],
  }
  return { ...payload, ...overrides }
}

export function makeCleanWorkspaceLivePresence(
  overrides: Partial<WorkspaceLivePresence> = {},
): WorkspaceLivePresence {
  return {
    contractVersion: '2026-04-20-r2',
    deviceId: FIXTURE_DEVICE_ID,
    localDate: FIXTURE_LOCAL_DATE,
    state: 'active',
    heartbeatAt: Date.parse(FIXTURE_GENERATED_AT),
    capturedAt: Date.parse(FIXTURE_GENERATED_AT),
    lastMeaningfulCaptureAt: Date.parse(FIXTURE_GENERATED_AT),
    currentBlockLabel: 'VSCode',
    currentCategory: 'development',
    currentAppKey: 'VSCode',
    currentFocusSeconds: 1200,
    ...overrides,
  }
}
