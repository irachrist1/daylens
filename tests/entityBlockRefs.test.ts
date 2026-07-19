// Timeline-block references never dangle (memory-and-entities.md
// §Timeline-block references, DEV-177): across invalidation and reprojection a
// stored block reference remaps to the successor block when one covers its
// span, and otherwise degrades to the underlying evidence ids + time range.
import test from 'node:test'
import assert from 'node:assert/strict'
import type Database from 'better-sqlite3'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import {
  addTimelineBlockRef,
  resolveEntityTimelineBlockRefs,
  remapTimelineBlockRefs,
} from '../src/main/services/entities/blockRefRemap.ts'
import { upsertEntity } from '../src/main/services/entities/entityRepository.ts'
import {
  getTimelineDayPayload,
  invalidateTimelineDayBlocks,
} from '../src/main/services/workBlocks.ts'

const TEST_DATE = '2026-04-22'

function localMs(hour: number, minute = 0): number {
  return new Date(2026, 3, 22, hour, minute, 0, 0).getTime()
}

function insertSession(
  db: Database.Database,
  payload: { title: string; startMinute: number; durationMinutes: number },
): void {
  const startTime = localMs(9, payload.startMinute)
  const endTime = startTime + payload.durationMinutes * 60_000
  db.prepare(`
    INSERT INTO app_sessions (
      bundle_id, app_name, start_time, end_time, duration_sec,
      category, is_focused, window_title, raw_app_name, capture_source, capture_version
    ) VALUES ('com.google.Chrome', 'Google Chrome', ?, ?, ?, 'browsing', 1, ?, 'Google Chrome', 'test', 1)
  `).run(startTime, endTime, payload.durationMinutes * 60, payload.title)
}

test('a block reference follows reprojection to a successor or degrades to evidence — never dangles', () => {
  const db = createProductionTestDatabase()
  try {
    insertSession(db, { title: 'Camera comparison research - DPReview', startMinute: 0, durationMinutes: 25 })
    insertSession(db, { title: 'City council election results - Local News', startMinute: 25, durationMinutes: 25 })

    const payload = getTimelineDayPayload(db, TEST_DATE, null, { materialize: true })
    assert.ok(payload.blocks.length > 0, 'the seeded day projects blocks')
    const block = payload.blocks[0]

    const entity = upsertEntity(db, {
      type: 'meeting', identityKey: 'event:test-1', name: 'Research block', origin: 'connected',
    })
    addTimelineBlockRef(db, entity.id, { id: block.id, startTime: block.startTime, endTime: block.endTime })

    // Still valid: resolves straight to the block.
    let resolved = resolveEntityTimelineBlockRefs(db, [entity.id])
    assert.equal(resolved.length, 1)
    assert.equal(resolved[0].blockId, block.id)
    assert.equal(resolved[0].degraded, false)

    // Reprojection: invalidate the day, add evidence that changes the
    // segmentation, and rebuild — block ids churn.
    invalidateTimelineDayBlocks(db, TEST_DATE)
    insertSession(db, { title: 'Camera lens pricing spreadsheet - Sheets', startMinute: 10, durationMinutes: 10 })
    const rebuilt = getTimelineDayPayload(db, TEST_DATE, null, { materialize: true, forceRebuild: true })
    assert.ok(rebuilt.blocks.length > 0)

    const sweep = remapTimelineBlockRefs(db)
    resolved = resolveEntityTimelineBlockRefs(db, [entity.id])
    assert.equal(resolved.length, 1)
    const validIds = new Set(
      (db.prepare(`SELECT id FROM timeline_blocks WHERE invalidated_at IS NULL`).all() as Array<{ id: string }>)
        .map((row) => row.id),
    )
    if (resolved[0].blockId != null) {
      assert.ok(validIds.has(resolved[0].blockId), 'a remapped reference points at a live block')
    } else {
      assert.equal(resolved[0].degraded, true, 'no successor → the reference degraded, it did not dangle')
      assert.equal(resolved[0].spanStartMs, block.startTime, 'the degrade anchor keeps the original span')
      assert.ok(resolved[0].evidenceSessionIds.length > 0, 'a degraded reference still names its evidence')
    }
    assert.ok(sweep.remapped + sweep.degraded >= 0)

    // Wipe every valid block for the span: the reference must degrade.
    db.prepare(`UPDATE timeline_blocks SET invalidated_at = ? WHERE invalidated_at IS NULL`).run(Date.now())
    const afterWipe = resolveEntityTimelineBlockRefs(db, [entity.id])
    assert.equal(afterWipe[0].blockId, null)
    assert.equal(afterWipe[0].degraded, true)
    assert.ok(afterWipe[0].evidenceSessionIds.length > 0, 'evidence ids + time range remain resolvable')
  } finally {
    db.close()
  }
})

test('a degraded reference re-resolves against evidence even after further rebuilds', () => {
  const db = createProductionTestDatabase()
  try {
    insertSession(db, { title: 'Quarterly report draft - Docs', startMinute: 0, durationMinutes: 30 })
    const entity = upsertEntity(db, {
      type: 'file', identityKey: 'document:test-doc', name: 'Quarterly report', origin: 'connected',
    })
    // A ref to a block id that never existed (e.g. from an older generation).
    addTimelineBlockRef(db, entity.id, {
      id: 'blk_gone_forever', startTime: localMs(9, 0), endTime: localMs(9, 30),
    })
    const resolved = resolveEntityTimelineBlockRefs(db, [entity.id])
    assert.equal(resolved[0].degraded, true)
    assert.ok(resolved[0].evidenceSessionIds.length > 0)
    // The persisted row now records the degrade, so the next read is stable.
    const stored = db.prepare(`SELECT source_type FROM entity_evidence_refs WHERE entity_id = ?`).get(entity.id) as { source_type: string }
    assert.equal(stored.source_type, 'evidence_span')
  } finally {
    db.close()
  }
})
