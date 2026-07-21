// Screen-context experiment (DEV-197) — the boundary proofs.
//
// Raw frames never leave the device; derived screen evidence is local-only:
// it cannot ride the encrypted sync payload (the strict allowlist has no keys
// for it), it is withheld from the full-history export (and the manifest says
// so), and the measurement events pass the global analytics sanitizer with
// buckets and closed enums only.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SyncAllowlistViolation,
  assertSyncPayloadAllowed,
} from '../src/shared/syncAllowlist/index'
import { makeCleanRemoteSyncPayload } from './support/remoteSyncPayloadFixture'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { planHistoryExport } from '../src/main/services/historyExport.ts'
import { sanitizeAnalyticsProperties } from '../src/shared/analytics.ts'
import { ScreenContextLifecycle } from '../src/main/services/screenContext/lifecycle.ts'
import type {
  FrameFileStore,
  ScreenFrameExtractor,
} from '../src/main/services/screenContext/types.ts'

// ─── Sync: the strict allowlist has no screen-context keys ────────────────────

test('screen-context evidence cannot ride the sync payload as a root collection', () => {
  const dirty = {
    ...makeCleanRemoteSyncPayload(),
    screenContextEvidence: [{
      id: 'sce_x',
      frame_id: 'scf_x',
      doc_title: 'Q3 Acquisition Draft',
      ocr_spans_json: '["due diligence checklist"]',
    }],
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

test('screen-context fields cannot nest onto an allowed synced object', () => {
  const clean = makeCleanRemoteSyncPayload()
  const dirty = {
    ...clean,
    workBlocks: [{ ...clean.workBlocks[0]!, screenOcrSpans: ['acquisition timeline'] }],
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

// ─── Export: withheld, and the manifest says so ───────────────────────────────

test('the full-history export withholds both screen-context tables and names them in the omissions', () => {
  const db = createProductionTestDatabase()
  db.prepare(`
    INSERT INTO screen_context_frames (
      id, captured_at, trigger, exclusion_policy_version, local_path, byte_size,
      state, retry_count, created_at, updated_at
    ) VALUES ('scf_priv', ?, 'diagnostic', 1, '/fake/priv.scframe', 10, 'captured', 0, ?, ?)
  `).run(Date.now(), Date.now(), Date.now())

  const plan = planHistoryExport(db)
  const exportedTables = plan.sections.flatMap((section) => section.tables.map((t) => t.table))
  assert.ok(!exportedTables.includes('screen_context_frames'), 'frame ledger must not export')
  assert.ok(!exportedTables.includes('screen_context_evidence'), 'derived evidence must not export')

  const internal = plan.omissions.find((o) => o.tables?.some((t) => t.startsWith('screen_context_frames')))
  assert.ok(internal, 'the omission manifest names the withheld screen-context tables')
  assert.ok(
    plan.omissions.some((o) => o.tables?.some((t) => t.startsWith('screen_context_evidence'))),
    'derived evidence is listed as withheld too',
  )
  db.close()
})

// ─── Analytics: the global sanitizer passes buckets and enums only ────────────

test('screen-context measurement properties survive the global analytics sanitizer; content-shaped keys do not', () => {
  const sanitized = sanitizeAnalyticsProperties({
    outcome: 'blocked',
    blocked_reason: 'protected_surface',
    trigger: 'interval',
    latency_bucket: '5-15s',
    byte_bucket: '1-4MB',
    backlog_bucket: '11-50',
    retry_count: 3,
    added_new_fact: true,
    // Anything content-shaped must be dropped by the allowlist.
    doc_title: 'Q3 Acquisition Draft',
    window_title: 'secrets.xlsx',
    url: 'https://intranet.example/secret',
    app_name: 'TextEdit',
    captured_at: 1_800_000_000_000,
  })
  assert.deepEqual(sanitized, {
    outcome: 'blocked',
    blocked_reason: 'protected_surface',
    trigger: 'interval',
    latency_bucket: '5-15s',
    byte_bucket: '1-4MB',
    backlog_bucket: '11-50',
    retry_count: 3,
    added_new_fact: true,
  })
})

// ─── End to end: a real lifecycle run leaks nothing through any boundary ──────

test('a full lifecycle run produces evidence that stays out of sync and export', async () => {
  const db = createProductionTestDatabase()
  const files = new Map<string, Uint8Array>()
  const store: FrameFileStore = {
    write: (_id, bytes) => {
      const localPath = `/fake/e2e/${files.size}.scframe`
      files.set(localPath, bytes)
      return { localPath, byteSize: bytes.byteLength }
    },
    read: (p) => files.get(p)!,
    delete: (p) => { files.delete(p) },
    list: () => [...files.keys()],
  }
  const extractor: ScreenFrameExtractor = {
    async extract() {
      return {
        docTitle: 'PRIVATE_E2E_MARKER budget review',
        ocrSpans: ['PRIVATE_E2E_MARKER row 12'],
        subjectRefs: [],
        extractorModel: 'fixture-extractor',
        extractorSchemaVersion: 1,
        confidence: 1,
      }
    },
  }
  const lifecycle = new ScreenContextLifecycle({ db, frameStore: store, extractor })
  const captured = lifecycle.captureFrame({
    bytes: new TextEncoder().encode('pixels'),
    capturedAt: Date.now(),
    trigger: 'diagnostic',
    appBundleId: 'com.apple.Numbers',
    appName: 'Numbers',
    displayId: 1,
  }, {
    consentEnabled: true, screenContextPaused: false, trackingPaused: false,
    foregroundExcluded: false, privateBrowser: false, protectedSurface: false,
    screenShareActive: false, protectedMediaActive: false,
  }, {
    onBattery: false, cpuPressure: false, locked: false, idle: false, asleep: false, fullScreenMedia: false,
  })
  const evidence = await lifecycle.processFrame(captured.frame!.id)
  assert.ok(evidence)

  // The clean sync payload build knows nothing about the new tables — and the
  // strict schema would refuse them anyway (proven above). The export plan
  // withholds them even though rows now exist.
  assert.doesNotThrow(() => assertSyncPayloadAllowed(makeCleanRemoteSyncPayload()))
  const plan = planHistoryExport(db)
  const exportedTables = plan.sections.flatMap((section) => section.tables.map((t) => t.table))
  assert.ok(!exportedTables.includes('screen_context_evidence'))
  db.close()
})
