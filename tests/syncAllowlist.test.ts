import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SYNC_ALLOWLIST_KEY_SCHEMA_PAIRS,
  SyncAllowlistViolation,
  assertOpaqueSourceAllowed,
  assertSyncPayloadAllowed,
  assertWorkspaceLivePresenceAllowed,
} from '../src/shared/syncAllowlist/index'
import {
  makeCleanRemoteSyncPayload,
  makeCleanWorkspaceLivePresence,
  makeDirtyRemoteSyncPayload,
} from './support/remoteSyncPayloadFixture'

test('clean post-boundary remote sync payload passes the allowlist unchanged', () => {
  const clean = makeCleanRemoteSyncPayload()
  const allowed = assertSyncPayloadAllowed(clean)
  assert.deepEqual(allowed, clean)
})

test('dirty remote sync fixture fails with classified path violations', () => {
  const dirty = makeDirtyRemoteSyncPayload()
  assert.throws(
    () => assertSyncPayloadAllowed(dirty),
    (error: unknown) => {
      assert.ok(error instanceof SyncAllowlistViolation)
      const classes = new Set(error.violations.map((item) => item.class))
      assert.ok(classes.has('path'), `expected path violation, got ${[...classes].join(',')}`)
      assert.ok(
        error.violations.some((item) => item.path.includes('workBlocks[0].label')),
        'expected label path violation',
      )
      assert.ok(
        error.violations.some((item) => item.path.includes('artifactIds')),
        'expected artifact id path violation',
      )
      return true
    },
  )
})

test('extra root field on sync payload fails strict schema', () => {
  const dirty = {
    ...makeCleanRemoteSyncPayload(),
    rawForegroundEvents: [{ windowTitle: 'leak' }],
  }
  assert.throws(
    () => assertSyncPayloadAllowed(dirty),
    (error: unknown) => {
      assert.ok(error instanceof SyncAllowlistViolation)
      assert.ok(error.violations.some((item) => item.class === 'extra_field'))
      return true
    },
  )
})

test('credential in a work block label fails the allowlist', () => {
  const payload = makeCleanRemoteSyncPayload()
  payload.workBlocks[0]!.label = 'Draft with sk-abcdefghijklmnopqrstuvwxyz012345'
  assert.throws(
    () => assertSyncPayloadAllowed(payload),
    (error: unknown) => {
      assert.ok(error instanceof SyncAllowlistViolation)
      assert.ok(error.violations.some((item) => item.class === 'credential'))
      assert.ok(error.violations.some((item) => item.path.includes('label')))
      return true
    },
  )
})

test('opaque source reference rejects title and url extras', () => {
  const valid = assertOpaqueSourceAllowed({
    evidenceId: 'ev_123',
    evidenceKind: 'application_interval',
    originatingDevice: 'desktop:test',
  })
  assert.equal(valid.evidenceId, 'ev_123')

  assert.throws(
    () =>
      assertOpaqueSourceAllowed({
        evidenceId: 'ev_123',
        evidenceKind: 'application_interval',
        originatingDevice: 'desktop:test',
        title: 'Secret Client Plan',
      }),
    (error: unknown) => {
      assert.ok(error instanceof SyncAllowlistViolation)
      assert.ok(error.violations.some((item) => item.class === 'opaque_source_shape'))
      return true
    },
  )

  assert.throws(
    () =>
      assertOpaqueSourceAllowed({
        evidenceId: 'ev_123',
        evidenceKind: 'application_interval',
        originatingDevice: 'desktop:test',
        url: 'https://example.com/private',
      }),
    (error: unknown) => {
      assert.ok(error instanceof SyncAllowlistViolation)
      assert.ok(error.violations.some((item) => item.class === 'opaque_source_shape'))
      return true
    },
  )
})

test('key maps match zod .strict() shapes for every synced type', () => {
  for (const pair of SYNC_ALLOWLIST_KEY_SCHEMA_PAIRS) {
    const fromKeys = Object.keys(pair.keys).sort()
    const fromShape = Object.keys(pair.shape).sort()
    assert.deepEqual(
      fromKeys,
      fromShape,
      `${pair.name}: key map and zod shape drifted`,
    )
  }
})

test('WorkspaceLivePresence is allowlisted and rejects credential labels', () => {
  const clean = makeCleanWorkspaceLivePresence()
  assert.deepEqual(assertWorkspaceLivePresenceAllowed(clean), clean)

  assert.throws(
    () =>
      assertWorkspaceLivePresenceAllowed({
        ...clean,
        currentBlockLabel: 'token=supersecretvalue123',
      }),
    (error: unknown) => {
      assert.ok(error instanceof SyncAllowlistViolation)
      assert.ok(error.violations.some((item) => item.class === 'credential'))
      return true
    },
  )

  assert.throws(
    () =>
      assertWorkspaceLivePresenceAllowed({
        ...clean,
        ocrText: 'screen derived',
      }),
    (error: unknown) => {
      assert.ok(error instanceof SyncAllowlistViolation)
      assert.ok(error.violations.some((item) => item.class === 'extra_field'))
      return true
    },
  )
})

test('excluded raw evidence classes cannot serialize into an allowed payload', () => {
  const cases: Array<{ name: string; mutate: (payload: ReturnType<typeof makeCleanRemoteSyncPayload>) => unknown }> = [
    {
      name: 'raw URL in label',
      mutate: (payload) => {
        payload.workBlocks[0]!.label = 'https://intranet.example/secret?token=abc'
        return payload
      },
    },
    {
      name: 'path in entity label',
      mutate: (payload) => {
        payload.entities[0]!.label = '/home/person/notes.md'
        return payload
      },
    },
    {
      name: 'forbidden screen key nested via override object',
      mutate: (payload) => ({
        ...payload,
        workBlocks: [
          {
            ...payload.workBlocks[0]!,
            ocrText: 'captured screen text',
          },
        ],
      }),
    },
  ]

  for (const item of cases) {
    assert.throws(
      () => assertSyncPayloadAllowed(item.mutate(makeCleanRemoteSyncPayload())),
      (error: unknown) => {
        assert.ok(error instanceof SyncAllowlistViolation, item.name)
        return true
      },
      item.name,
    )
  }
})
