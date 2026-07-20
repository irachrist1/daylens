// DEV-183: the context-packet inspector — "what did the model see for this
// answer", assembled read-only from the recorded ledger row, without calling
// any model. Proves:
//
//   1. per-kind grouping — every packet kind appears as a group (empty or
//      not), in the packet's own order, with plain-language labels, and each
//      item keeps its recorded reason, source type, sensitivity, and version;
//   2. omissions in plain language — what was considered and deliberately not
//      sent reads as a sentence, not a code;
//   3. deletion coherence — the packet is a historical disclosure record:
//      evidence deleted AFTER the exchange stays in the view, labeled
//      honestly per identity kind (deleted evidence, recomputed block,
//      revoked file grant), while untouched evidence reads as present;
//   4. the lookup contract behind the IPC surface — inspect by packet id,
//      inspect by bound assistant message id, honest null when nothing was
//      recorded, and light list entries for the packet browser.
import test from 'node:test'
import assert from 'node:assert/strict'
import type Database from 'better-sqlite3'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import {
  buildContextPacket,
  recordContextPacket,
  linkContextPacketToMessage,
  type ContextItemKind,
  type ContextPacket,
} from '../src/main/services/contextPacket.ts'
import {
  assembleContextPacketInspection,
  inspectContextPacket,
  listContextPacketEntries,
  omissionLabel,
  resolveEvidencePresence,
  KIND_LABELS,
} from '../src/main/services/contextPacketInspection.ts'
import { indexMemoryForDay } from '../src/main/services/memoryIndex.ts'
import { addWorkMemoryFact } from '../src/main/services/workMemoryProfile.ts'
import {
  addFileAccessGrant,
  revokeFileAccessGrant,
  storeDerivedText,
} from '../src/main/services/fileAccess.ts'

const DATE = '2026-04-22'
const NOW = new Date(2026, 3, 23, 12, 0, 0, 0)
const DESTINATION = 'anthropic:test-model'

const KIND_ORDER: ContextItemKind[] = [
  'day_fact', 'corrected_fact', 'entity', 'search_exact', 'search_semantic', 'file_excerpt',
]

function localMs(hour: number, minute = 0): number {
  return new Date(2026, 3, 22, hour, minute, 0, 0).getTime()
}

function insertSession(
  db: Database.Database,
  title: string,
  startHour: number,
  durationMinutes: number,
): void {
  const startTime = localMs(startHour)
  db.prepare(`
    INSERT INTO app_sessions (
      bundle_id, app_name, start_time, end_time, duration_sec,
      category, is_focused, window_title, raw_app_name, capture_source, capture_version
    ) VALUES ('com.mitchellh.ghostty', 'Ghostty', ?, ?, ?, 'development', 1, ?, 'Ghostty', 'test', 1)
  `).run(startTime, startTime + durationMinutes * 60_000, durationMinutes * 60, title)
}

async function buildAndRecord(
  db: Database.Database,
  question: string,
  now: Date = NOW,
): Promise<ContextPacket> {
  const packet = await buildContextPacket(db, {
    purpose: 'answer',
    question,
    now,
    destination: DESTINATION,
  })
  recordContextPacket(db, packet, { exchangeKind: 'chat', threadId: 7 })
  return packet
}

test('inspection groups every packet kind in order, with plain-language labels and recorded reasons intact', async () => {
  const db = createProductionTestDatabase()
  insertSession(db, 'Refactoring the retrieval planner', 9, 45)
  indexMemoryForDay(db, DATE)
  addWorkMemoryFact(db, 'Prefers the retrieval planner work in the morning.')
  const grant = addFileAccessGrant(db, {
    scopeKind: 'file',
    path: '/home/person/notes/retrieval-planner.md',
    state: 'model_readable',
  })
  storeDerivedText(db, grant.id, 'Retrieval planner notes: rank by time fit first.')

  const packet = await buildAndRecord(db, 'retrieval planner')
  const inspection = inspectContextPacket(db, { packetId: packet.id })
  assert.ok(inspection, 'the recorded packet inspects')

  // Every kind appears as a group, in the packet's own order, empty or not —
  // so the view can say honestly that e.g. nothing of a kind was sent.
  assert.deepEqual(inspection.groups.map((group) => group.kind), KIND_ORDER)
  for (const group of inspection.groups) {
    assert.equal(group.label, KIND_LABELS[group.kind as ContextItemKind], 'labels are the plain-language ones')
    assert.ok(!/_/.test(group.label), `label reads as language, not a code: ${group.label}`)
  }

  // Grouping is faithful: each group holds exactly the packet's items of its kind.
  for (const kind of KIND_ORDER) {
    const expected = packet.items.filter((item) => item.kind === kind)
    const group = inspection.groups.find((candidate) => candidate.kind === kind)
    assert.ok(group)
    assert.deepEqual(group.items.map((item) => item.identity), expected.map((item) => item.identity))
  }

  // The exchange had searchable work, a memory fact, and a granted file — the
  // populated groups prove the per-kind view carries real content.
  const byKind = Object.fromEntries(inspection.groups.map((group) => [group.kind, group.items]))
  assert.ok(byKind.search_exact.length > 0, 'exact search hits are grouped')
  assert.ok(byKind.corrected_fact.length > 0, 'memory facts are grouped')
  assert.ok(byKind.file_excerpt.length > 0, 'file excerpts are grouped')

  // Each item keeps the ledger's disclosure fields: statement, reason,
  // source type, sensitivity — and untouched evidence reads as present.
  for (const group of inspection.groups) {
    for (const item of group.items) {
      assert.ok(item.statement.length > 0)
      assert.ok(item.reason.length > 0, `every item explains why it was included: ${item.identity}`)
      assert.ok(['observed', 'connected', 'supplied', 'inferred'].includes(item.sourceType))
      assert.ok(['standard', 'personal', 'high'].includes(item.sensitivity))
      assert.equal(item.evidenceState, 'present', `nothing was deleted yet: ${item.identity}`)
      assert.equal(item.evidenceNote, null)
    }
  }
  const excerpt = byKind.file_excerpt[0]
  assert.ok(excerpt.version, 'file excerpts keep their content-version fingerprint')

  // The disclosure record: destination, that it left the device, when, the
  // policy version and the content fingerprint.
  assert.equal(inspection.destination, DESTINATION)
  assert.equal(inspection.leftDevice, true)
  assert.equal(inspection.createdAt, packet.assembledAt)
  assert.equal(inspection.policyVersion, packet.policyVersion)
  assert.equal(inspection.contentFingerprint, packet.contentFingerprint)
  assert.equal(inspection.itemCount, packet.items.length)
  assert.equal(inspection.question, 'retrieval planner')

  // Permissions consulted round-trip.
  assert.deepEqual(inspection.permissions, [{
    kind: 'file_access',
    scopeKind: 'file',
    path: '/home/person/notes/retrieval-planner.md',
    state: 'model_readable',
    allowHighSensitivity: false,
  }])
  db.close()
})

test('omissions read as plain language: what was considered and not sent, and why', async () => {
  const db = createProductionTestDatabase()
  // A model-readable grant on a high-sensitivity-looking file WITHOUT the
  // explicit high-sensitivity flag: considered, then held back and recorded.
  const grant = addFileAccessGrant(db, {
    scopeKind: 'file',
    path: '/home/person/notes/passwords-vault-notes.md',
    state: 'model_readable',
  })
  storeDerivedText(db, grant.id, 'vault notes about the passwords rotation schedule')

  const packet = await buildAndRecord(db, 'passwords rotation vault')
  assert.ok(
    packet.disclosure.omissions.some((omission) => omission.kind === 'file_excerpt' && omission.reason === 'high-sensitivity'),
    'the omission was recorded at assembly time',
  )
  const inspection = inspectContextPacket(db, { packetId: packet.id })
  assert.ok(inspection)
  const omission = inspection.omissions.find((candidate) => candidate.kind === 'file_excerpt')
  assert.ok(omission, 'the omission surfaces in the inspection')
  assert.match(omission.label, /1 file excerpt was considered and not sent/, 'counts read as a sentence')
  assert.match(omission.label, /high-sensitivity/, 'the reason is stated')
  assert.match(omission.label, /its own explicit permission/, 'the reason explains itself in plain words')

  // Label grammar handles plurals too.
  assert.match(
    omissionLabel({ kind: 'search_exact', count: 3, reason: 'tracking-excluded' }),
    /3 search matches were considered and not sent: held back by your tracking exclusions/,
  )
  db.close()
})

test('deletion coherence: evidence deleted after the exchange stays in the record, labeled honestly per kind', async () => {
  const db = createProductionTestDatabase()
  insertSession(db, 'Drafting the launch pricing table', 10, 40)
  indexMemoryForDay(db, DATE)
  addWorkMemoryFact(db, 'Owns the launch pricing table.')
  const grant = addFileAccessGrant(db, {
    scopeKind: 'file',
    path: '/home/person/notes/launch-pricing.md',
    state: 'model_readable',
  })
  storeDerivedText(db, grant.id, 'Launch pricing: three tiers, annual billing.')

  const packet = await buildAndRecord(db, 'launch pricing')
  const sessionItem = packet.items.find((item) => item.kind === 'search_exact' && item.identity.startsWith('session:'))
  const factItem = packet.items.find((item) => item.kind === 'corrected_fact')
  const fileItem = packet.items.find((item) => item.kind === 'file_excerpt')
  assert.ok(sessionItem && factItem && fileItem, 'the exchange disclosed a session hit, a fact, and a file excerpt')

  // The person then deletes the evidence: the moment's rows, the memory fact,
  // and revokes the file grant.
  const sessionRowId = sessionItem.identity.slice('session:'.length)
  db.prepare(`DELETE FROM memory_records WHERE rowid = ?`).run(sessionRowId)
  db.prepare(`DELETE FROM app_sessions WHERE id = ?`).run(sessionRowId)
  // Memory facts forget from whichever store holds them: drafted rows mark
  // status, confirmed supplied rows (smf_…) delete outright.
  const factId = factItem.identity.slice('fact:'.length)
  db.prepare(`UPDATE work_memory_facts SET status = 'deleted' WHERE id = ?`).run(factId)
  db.prepare(`DELETE FROM supplied_memory_facts WHERE id = ?`).run(factId)
  revokeFileAccessGrant(db, grant.id)

  const inspection = inspectContextPacket(db, { packetId: packet.id })
  assert.ok(inspection, 'the disclosure record survives — deleting evidence cannot un-send it')

  const inspectedItems = inspection.groups.flatMap((group) => group.items)
  const inspectedSession = inspectedItems.find((item) => item.identity === sessionItem.identity)
  assert.ok(inspectedSession, 'the deleted item is still shown')
  assert.equal(inspectedSession.evidenceState, 'deleted')
  assert.match(inspectedSession.evidenceNote ?? '', /since been deleted/, 'the label says what happened')
  assert.equal(inspectedSession.statement, sessionItem.statement, 'the disclosed statement is preserved as the record')

  const inspectedFact = inspectedItems.find((item) => item.identity === factItem.identity)
  assert.ok(inspectedFact)
  assert.equal(inspectedFact.evidenceState, 'deleted')
  assert.match(inspectedFact.evidenceNote ?? '', /forgotten/)

  const inspectedFile = inspectedItems.find((item) => item.identity === fileItem.identity)
  assert.ok(inspectedFile)
  assert.equal(inspectedFile.evidenceState, 'access_revoked')
  assert.match(inspectedFile.evidenceNote ?? '', /revoked/, 'a revoked grant is named as such, not as generic deletion')
  assert.match(inspectedFile.evidenceNote ?? '', /already sent/, 'the record is honest about why the excerpt remains')
  db.close()
})

test('per-kind presence checks: blocks, entities, and unknown identity forms', () => {
  const db = createProductionTestDatabase()
  const nowMs = Date.now()

  // A valid timeline block reads as present; a recomputed (invalidated) or
  // missing one is named as no longer in the current record.
  db.prepare(`
    INSERT INTO timeline_blocks (
      id, date, start_time, end_time, block_kind, dominant_category,
      label_current, heuristic_version, computed_at
    ) VALUES ('blk-live', ?, ?, ?, 'work', 'development', 'Planner work', 'v1', ?)
  `).run(DATE, localMs(9), localMs(10), nowMs)
  assert.equal(resolveEvidencePresence(db, { identity: 'block:blk-live', kind: 'day_fact' }).state, 'present')
  db.prepare(`UPDATE timeline_blocks SET invalidated_at = ? WHERE id = 'blk-live'`).run(nowMs)
  const recomputed = resolveEvidencePresence(db, { identity: 'block:blk-live', kind: 'day_fact' })
  assert.equal(recomputed.state, 'deleted')
  assert.match(recomputed.note ?? '', /recomputed or deleted/, 'block churn is not overclaimed as a person\'s deletion')
  assert.equal(resolveEvidencePresence(db, { identity: 'block:blk-never', kind: 'day_fact' }).state, 'deleted')

  // Entities: active and merged rows still exist; deleted or missing do not.
  db.prepare(`
    INSERT INTO entities (id, entity_type, identity_key, canonical_name, created_at, updated_at)
    VALUES ('ent-1', 'client', 'client:acme', 'Acme', ?, ?)
  `).run(nowMs, nowMs)
  assert.equal(resolveEvidencePresence(db, { identity: 'entity:ent-1', kind: 'entity' }).state, 'present')
  db.prepare(`UPDATE entities SET status = 'merged', merged_into_id = 'ent-2' WHERE id = 'ent-1'`).run()
  assert.equal(resolveEvidencePresence(db, { identity: 'entity:ent-1', kind: 'entity' }).state, 'present', 'merged is not deleted')
  db.prepare(`UPDATE entities SET status = 'deleted' WHERE id = 'ent-1'`).run()
  assert.equal(resolveEvidencePresence(db, { identity: 'entity:ent-1', kind: 'entity' }).state, 'deleted')

  // An identity form the checker does not know is stated as unverified —
  // never guessed present, never claimed deleted.
  const unknown = resolveEvidencePresence(db, { identity: 'weird:thing', kind: 'day_fact' })
  assert.equal(unknown.state, 'unverified')
  assert.ok(unknown.note, 'unverified still explains itself')
  assert.equal(resolveEvidencePresence(db, { identity: 'no-separator', kind: 'day_fact' }).state, 'unverified')
  db.close()
})

test('lookup contract: by packet id, by bound message id, honest null, and browser list entries', async () => {
  const db = createProductionTestDatabase()
  insertSession(db, 'Reviewing the quarterly report', 11, 30)
  indexMemoryForDay(db, DATE)

  const first = await buildAndRecord(db, 'quarterly report')
  linkContextPacketToMessage(db, first.id, 4242)

  // By packet id and by the assistant message the packet is bound to — the
  // same record either way.
  const byPacket = inspectContextPacket(db, { packetId: first.id })
  const byMessage = inspectContextPacket(db, { messageId: 4242 })
  assert.ok(byPacket && byMessage)
  assert.equal(byMessage.packetId, byPacket.packetId)
  assert.equal(byMessage.messageId, 4242)
  assert.equal(byMessage.threadId, 7)
  assert.deepEqual(byMessage.groups, byPacket.groups)

  // Honest null when nothing was recorded — no reconstructed view.
  assert.equal(inspectContextPacket(db, { packetId: 'ctx_never_recorded' }), null)
  assert.equal(inspectContextPacket(db, { messageId: 999999 }), null)
  assert.equal(inspectContextPacket(db, {}), null)

  // The browser rows: question, time, destination, counts — no packet JSON.
  const second = await buildAndRecord(db, 'quarterly report follow-up', new Date(NOW.getTime() + 60_000))
  const entries = listContextPacketEntries(db, { limit: 10 })
  assert.equal(entries.length, 2)
  assert.equal(entries[0].packetId, second.id, 'newest first')
  assert.equal(entries[1].packetId, first.id)
  assert.equal(entries[1].question, 'quarterly report')
  assert.equal(entries[1].destination, DESTINATION)
  assert.equal(entries[1].messageId, 4242)
  assert.equal(entries[1].itemCount, first.items.length)
  const countedTotal = Object.values(entries[1].counts).reduce((sum, count) => sum + count, 0)
  assert.equal(countedTotal, first.items.length, 'per-kind counts sum to the item count')
  for (const entry of entries) {
    assert.ok(!('packet' in entry), 'list entries stay light — the full packet never rides the list')
  }
  db.close()
})

test('an empty exchange inspects honestly: every group empty, zero items, record still complete', async () => {
  const db = createProductionTestDatabase()
  const packet = await buildContextPacket(db, {
    purpose: 'answer',
    question: 'anything at all',
    now: NOW,
    destination: DESTINATION,
  })
  recordContextPacket(db, packet, { exchangeKind: 'chat' })
  const stored = { // exercise the pure assembly path too
    id: packet.id,
    exchangeKind: 'chat' as const,
    threadId: null,
    messageId: null,
    scopeKey: null,
    destination: DESTINATION,
    createdAt: packet.assembledAt,
    packet,
  }
  const inspection = assembleContextPacketInspection(db, stored)
  assert.equal(inspection.itemCount, 0)
  assert.deepEqual(inspection.groups.map((group) => group.kind), KIND_ORDER, 'all groups appear even when empty')
  for (const group of inspection.groups) assert.deepEqual(group.items, [])
  // The day had no capture at all — the gap section says so.
  assert.ok(inspection.gaps.some((gap) => gap.kind === 'no-capture'), 'a signal-free day is stated, not blank')
  db.close()
})
