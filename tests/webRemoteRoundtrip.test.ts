import assert from 'node:assert/strict'
import test from 'node:test'
import { getFunctionName } from 'convex/server'
import type { RemoteSyncPayload } from '@daylens/remote-contract'
import { internal } from '../apps/web/convex/_generated/api.js'
import httpRouter from '../apps/web/convex/http.ts'
import * as devices from '../apps/web/convex/devices.ts'
import * as remoteSync from '../apps/web/convex/remoteSync.ts'
import { buildAppDetail } from '../apps/web/app/lib/presentation.ts'
import { InMemoryConvexDatabase } from './support/inMemoryConvex.ts'

type RegisteredHandler = {
  _handler: (ctx: unknown, args: unknown) => Promise<unknown>
}

const workspaceId = 'workspaces:test'
const deviceId = 'desktop:test'

function handler(value: unknown): RegisteredHandler['_handler'] {
  return (value as RegisteredHandler)._handler
}

function makePayload(overrides: Partial<RemoteSyncPayload> = {}): RemoteSyncPayload {
  const localDate = '2026-07-14'
  const generatedAt = '2026-07-14T16:00:00.000Z'
  const payload: RemoteSyncPayload = {
    contractVersion: '2026-04-20-r2',
    deviceId,
    localDate,
    generatedAt,
    daySummary: {
      contractVersion: '2026-04-20-r2',
      deviceId,
      localDate,
      generatedAt,
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
        generatedAt,
        threadId: null,
      },
    ],
  }
  return { ...payload, ...overrides }
}

async function setupRemote() {
  const db = new InMemoryConvexDatabase()
  await db.insert('devices', {
    workspaceId,
    deviceId,
    platform: 'macos',
    displayName: 'Test Mac',
    lastSyncAt: 0,
  })
  return db
}

function mutationContext(db: InMemoryConvexDatabase) {
  return { db }
}

function authenticatedContext(db: InMemoryConvexDatabase) {
  return {
    db,
    auth: {
      getUserIdentity: async () => ({ workspaceId, deviceId, sessionKind: 'desktop' }),
    },
    runQuery: async (reference: unknown, args: Record<string, unknown>) => {
      const name = getFunctionName(reference as never)
      if (name !== 'devices:getByWorkspaceAndDeviceId') {
        throw new Error(`Unexpected query: ${name}`)
      }
      return handler(devices.getByWorkspaceAndDeviceId)({ db }, args)
    },
  }
}

function httpContext(db: InMemoryConvexDatabase, options: { failNextSync?: boolean } = {}) {
  let failNextSync = options.failNextSync === true
  return {
    auth: {
      getUserIdentity: async () => ({ workspaceId, deviceId, sessionKind: 'desktop' }),
    },
    runQuery: async (reference: unknown, args: Record<string, unknown>) => {
      const name = getFunctionName(reference as never)
      if (name !== 'devices:getByWorkspaceAndDeviceId') {
        throw new Error(`Unexpected query: ${name}`)
      }
      return handler(devices.getByWorkspaceAndDeviceId)({ db }, args)
    },
    runMutation: async (reference: unknown, args: Record<string, unknown>) => {
      const name = getFunctionName(reference as never)
      if (name === 'remoteSync:syncDay') {
        if (failNextSync) {
          failNextSync = false
          throw new Error('injected network-boundary persistence failure')
        }
        return handler(remoteSync.syncDay)({ db }, args)
      }
      if (name === 'remoteSync:recordFailure') {
        return handler(remoteSync.recordFailure)({ db }, args)
      }
      throw new Error(`Unexpected mutation: ${name}`)
    },
  }
}

async function postSync(ctx: ReturnType<typeof httpContext>, payload: RemoteSyncPayload) {
  const match = httpRouter.lookup('/remote/syncDay', 'POST')
  assert.ok(match)
  return handler(match[0])(
    ctx,
    new Request('https://local.daylens.test/remote/syncDay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  ) as Promise<Response>
}

test('remote sync stores one privacy-sanitized day and web queries the production projection', async () => {
  const db = await setupRemote()
  const response = await postSync(httpContext(db), makePayload())
  assert.equal(response.status, 200)

  const remoteDay = await remoteSync.loadRemoteDayForWorkspace(
    { db } as never,
    workspaceId as never,
    '2026-07-14',
  )
  assert.ok(remoteDay)
  assert.equal(remoteDay.snapshot.workBlocks.length, 1)
  assert.equal(remoteDay.snapshot.workBlocks[0]?.label, 'VSCode')
  assert.deepEqual(remoteDay.snapshot.workBlocks[0]?.topPages, [
    { domain: 'github.com', label: 'github.com', seconds: 900 },
  ])
  assert.deepEqual(remoteDay.snapshot.workBlocks[0]?.artifactIds, [])
  assert.equal(JSON.stringify(remoteDay).includes('Secret Client'), false)
  assert.equal(JSON.stringify(remoteDay).includes('/Users/person/private/client-plan.md'), false)
  assert.equal(remoteDay.snapshot.privacyFiltered, true)

  const app = remoteDay.snapshot.appSummaries[0]
  assert.ok(app)
  const webDetail = buildAppDetail(remoteDay.snapshot, app)
  assert.deepEqual(webDetail.headlineLabels, ['VSCode'])
  assert.deepEqual(webDetail.relatedSites, [
    { domain: 'github.com', label: 'github.com', seconds: 900 },
  ])
})

test('repeated sync is idempotent and omission deletes stale remote facts', async () => {
  const db = await setupRemote()
  const payload = makePayload()
  await handler(remoteSync.syncDay)(mutationContext(db), { workspaceId, deviceId, payload })
  await handler(remoteSync.syncDay)(mutationContext(db), { workspaceId, deviceId, payload })

  assert.equal(db.rows('synced_day_summaries').length, 1)
  assert.equal(db.rows('synced_work_blocks').length, 1)
  assert.equal(db.rows('synced_entities').length, 1)
  assert.equal(db.rows('synced_artifacts').length, 1)

  const emptyPayload = makePayload({ workBlocks: [], entities: [], artifacts: [] })
  await handler(remoteSync.syncDay)(mutationContext(db), {
    workspaceId,
    deviceId,
    payload: emptyPayload,
  })

  assert.equal(db.rows('synced_day_summaries').length, 1)
  assert.equal(db.rows('synced_work_blocks').length, 0)
  assert.equal(db.rows('synced_entities').length, 0)
  assert.equal(db.rows('synced_artifacts').length, 0)
  const remoteDay = await remoteSync.loadRemoteDayForWorkspace(
    { db } as never,
    workspaceId as never,
    '2026-07-14',
  )
  assert.ok(remoteDay)
  assert.deepEqual(remoteDay.snapshot.workBlocks, [])
  assert.deepEqual(remoteDay.snapshot.entities, [])
  assert.deepEqual(remoteDay.snapshot.standoutArtifacts, [])
})

test('a failed request is recorded and an explicit retry converges without duplicates', async () => {
  const db = await setupRemote()
  const ctx = httpContext(db, { failNextSync: true })

  const failed = await postSync(ctx, makePayload())
  assert.equal(failed.status, 500)
  assert.equal(db.rows('sync_failures').length, 1)
  assert.equal(db.rows('synced_day_summaries').length, 0)

  const retried = await postSync(ctx, makePayload())
  assert.equal(retried.status, 200)
  assert.equal(db.rows('synced_day_summaries').length, 1)
  assert.equal(db.rows('synced_work_blocks').length, 1)
})

test('device revocation immediately blocks remote writes and authenticated web reads', async () => {
  const db = await setupRemote()
  const ctx = authenticatedContext(db)
  const device = db.rows('devices')[0]
  assert.ok(device)

  await handler(devices.remove)(ctx, { deviceId: device._id })
  assert.equal(db.rows('devices').length, 0)

  const rejected = await postSync(httpContext(db), makePayload())
  assert.equal(rejected.status, 403)
  assert.match(await rejected.text(), /Unknown device/)

  await assert.rejects(
    () => handler(remoteSync.getTimelineDay)(ctx, { localDate: '2026-07-14' }),
    /Session revoked/,
  )
})

test('the contract function references used by the local transport remain production routes', () => {
  assert.equal(getFunctionName(internal.remoteSync.syncDay), 'remoteSync:syncDay')
  assert.equal(
    getFunctionName(internal.devices.getByWorkspaceAndDeviceId),
    'devices:getByWorkspaceAndDeviceId',
  )
})
