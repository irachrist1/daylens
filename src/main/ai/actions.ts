// AI action layer.
//
// Turns a chat instruction into an action *proposal* (a preview), and — only
// when the user confirms — commits it through the same manual-edit pipeline.
// This is deliberately separate from the read-only resolvers: the
// resolvers READ data to answer; these tools ACT, explicitly, and never mutate
// until confirmed. Detection is deterministic-first (cheap) — a model call is
// only for the long tail and lives in the caller (memory extraction).
import type Database from 'better-sqlite3'
import crypto from 'node:crypto'
import type {
  AIActionCommitResult,
  AIActionUndo,
  AIActionWidget,
  AIMemoryOpPreview,
  AIMemoryProposal,
  AIMergeBlocksProposal,
  AIRenameBlockProposal,
  WorkContextBlock,
} from '@shared/types'
import { getTimelineDayPayload } from '../services/workBlocks'
import { getCurrentSession } from '../services/tracking'
import { localDateString } from '../lib/localDate'
import {
  applyMemoryWriteOps,
  getClientMemory,
  type MemoryWriteOp,
} from '../services/workMemoryProfile'
import { applyBlockLabelCorrection, applyBlockMerge, clearBlockLabelCorrection } from '../services/blockCorrections'
import {
  findMemoryProposalRejection,
  isSensitiveFactStatement,
  recordMemoryProposalRejection,
} from '../services/suppliedMemory'

function newProposalId(): string {
  return `act_${crypto.randomBytes(6).toString('hex')}`
}

// ── Rename a block ──────────────────────────────────────────────────────────

const RENAME_RE = /\b(rename|relabel|re-?title|call)\b/i

export function looksLikeRenameBlockInstruction(message: string): boolean {
  const m = message.trim()
  if (!m || m.length > 300) return false
  if (!RENAME_RE.test(m)) return false
  return /\b(to|as)\b/i.test(m)
}

function liveSessionForDate(dateStr: string) {
  return dateStr === localDateString() ? getCurrentSession() : null
}

function loadDayBlocks(db: Database.Database, dateStr: string): WorkContextBlock[] {
  const payload = getTimelineDayPayload(db, dateStr, liveSessionForDate(dateStr))
  return [...payload.blocks].sort((a, b) => a.startTime - b.startTime)
}

function labelOf(block: WorkContextBlock): string {
  return block.label.override?.trim() || block.label.current?.trim() || block.ruleBasedLabel
}

function formatClock(ms: number): string {
  const d = new Date(ms)
  let h = d.getHours()
  const min = d.getMinutes()
  const ampm = h >= 12 ? 'pm' : 'am'
  h = h % 12
  if (h === 0) h = 12
  return min === 0 ? `${h}${ampm}` : `${h}:${String(min).padStart(2, '0')}${ampm}`
}

function formatRange(startMs: number, endMs: number): string {
  return `${formatClock(startMs)}–${formatClock(endMs)}`
}

// "2pm" / "2:30 pm" / "14:00" → minutes since midnight, or null.
function parseClockToMinutes(text: string): number | null {
  const m = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i)
  if (!m) return null
  let hour = Number(m[1])
  const min = m[2] ? Number(m[2]) : 0
  const ampm = m[3]?.toLowerCase()
  if (hour > 23 || min > 59) return null
  if (ampm === 'pm' && hour < 12) hour += 12
  if (ampm === 'am' && hour === 12) hour = 0
  // Bare "2" with no am/pm and no other anchor is too ambiguous to be a time.
  if (!ampm && !m[2]) return null
  return hour * 60 + min
}

function blockMinuteOfDay(ms: number): number {
  const d = new Date(ms)
  return d.getHours() * 60 + d.getMinutes()
}

// Resolve which block the instruction is about. Returns null when it can't pin a
// single non-provisional block — the caller then falls through to a normal
// answer instead of guessing.
function resolveTargetBlock(blocks: WorkContextBlock[], targetPhrase: string, fullMessage: string): WorkContextBlock | null {
  const editable = blocks.filter((b) => !b.provisional)
  if (editable.length === 0) return null
  const phrase = targetPhrase.toLowerCase().trim()

  // "this" / "current" / "the (last) block" / "it" → the most recent block.
  if (/\b(this|current|live|active|last|previous|latest|it|the block|that block)\b/.test(phrase) || phrase === '' ) {
    return editable[editable.length - 1]
  }

  // A clock time anywhere in the phrase → the block covering that minute.
  const clockMin = parseClockToMinutes(phrase) ?? parseClockToMinutes(fullMessage)
  if (clockMin !== null) {
    const hit = editable.find((b) => {
      const start = blockMinuteOfDay(b.startTime)
      const end = blockMinuteOfDay(b.endTime)
      return clockMin >= start && clockMin <= end
    })
    if (hit) return hit
    // Nearest block by start when nothing strictly covers it.
    return editable.reduce((best, b) =>
      Math.abs(blockMinuteOfDay(b.startTime) - clockMin) < Math.abs(blockMinuteOfDay(best.startTime) - clockMin) ? b : best,
    )
  }

  // Part-of-day window → the block whose midpoint falls inside it.
  const window = /morning/.test(phrase) ? [5 * 60, 12 * 60]
    : /afternoon/.test(phrase) ? [12 * 60, 17 * 60]
      : /evening|tonight/.test(phrase) ? [17 * 60, 23 * 60]
        : null
  if (window) {
    const hit = editable.find((b) => {
      const mid = (blockMinuteOfDay(b.startTime) + blockMinuteOfDay(b.endTime)) / 2
      return mid >= window[0] && mid <= window[1]
    })
    if (hit) return hit
  }

  // Otherwise treat the phrase as (part of) an existing label.
  const cleaned = phrase.replace(/\b(the|my|block|episode|named|labelled|labeled|called)\b/g, ' ').replace(/\s+/g, ' ').trim()
  if (cleaned.length >= 3) {
    const byLabel = editable.filter((b) => labelOf(b).toLowerCase().includes(cleaned))
    if (byLabel.length === 1) return byLabel[0]
  }
  return null
}

function extractNewLabel(message: string): string | null {
  const m = message.trim().replace(/[.!?]+$/, '')
  const match = m.match(/\b(?:to|as)\s+["“'']?(.+?)["”'']?$/i)
  if (!match) return null
  const label = match[1].trim()
  if (!label || label.length > 80) return null
  return label
}

// "yesterday" → yesterday's local date; otherwise today. Keeps rename targeting
// honest when the user names a past day.
function dateFromMessage(message: string): string {
  if (/\byesterday\b/i.test(message)) {
    return localDateString(new Date(Date.now() - 24 * 60 * 60 * 1000))
  }
  return localDateString()
}

function extractTargetPhrase(message: string): string {
  const m = message.trim()
  const match = m.match(/\b(?:rename|relabel|re-?title|call)\b\s+(.+?)\s+\b(?:to|as)\b/i)
  return match?.[1]?.trim() ?? ''
}

/** Build a rename proposal, or null if the message isn't a resolvable rename. */
export function buildRenameBlockProposal(
  db: Database.Database,
  message: string,
  contextDate: string | null,
): AIRenameBlockProposal | null {
  if (!looksLikeRenameBlockInstruction(message)) return null
  const nextLabel = extractNewLabel(message)
  if (!nextLabel) return null

  const date = contextDate ?? dateFromMessage(message)
  const blocks = loadDayBlocks(db, date)
  if (blocks.length === 0) return null

  const targetPhrase = extractTargetPhrase(message)
  const block = resolveTargetBlock(blocks, targetPhrase, message)
  if (!block) return null

  const previousLabel = labelOf(block)
  if (previousLabel.toLowerCase() === nextLabel.toLowerCase()) return null

  return {
    kind: 'rename_block',
    proposalId: newProposalId(),
    surface: 'card',
    confirmLabel: 'Rename block',
    blockId: block.id,
    date,
    previousLabel,
    nextLabel,
    timeRange: formatRange(block.startTime, block.endTime),
  }
}

// ── Merge two blocks ────────────────────────────────────────────────────────

const MERGE_RE = /\bmerge\b/i

export function looksLikeMergeBlocksInstruction(message: string): boolean {
  const m = message.trim()
  if (!m || m.length > 300) return false
  return MERGE_RE.test(m) && /\bblock|episode|these|last two|this (?:one|block) (?:with|into)|previous|above|below|next\b/i.test(m)
}

// Resolve the two blocks to merge. Only adjacent blocks merge (mirrors the
// manual Merge up/down control, invariant 5) — returns the pair in time order,
// or null if it can't pin two adjacent editable blocks.
function resolveMergePair(blocks: WorkContextBlock[], message: string): [WorkContextBlock, WorkContextBlock] | null {
  const editable = blocks.filter((b) => !b.provisional)
  if (editable.length < 2) return null
  const m = message.toLowerCase()

  // "merge the last two blocks" / "merge my last two"
  if (/last two|past two|recent two|two most recent/.test(m)) {
    return [editable[editable.length - 2], editable[editable.length - 1]]
  }

  // "merge this/the current block with the previous/above one"
  if (/\b(this|current|last|latest)\b/.test(m) && /\b(previous|above|prior|before)\b/.test(m)) {
    return [editable[editable.length - 2], editable[editable.length - 1]]
  }

  // Two clock times → the two blocks covering them, if adjacent.
  const times = [...m.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi)].map((mt) => parseClockToMinutes(mt[0]))
    .filter((v): v is number => v !== null)
  if (times.length >= 2) {
    const findIdx = (min: number) => editable.findIndex((b) => {
      const start = blockMinuteOfDay(b.startTime)
      const end = blockMinuteOfDay(b.endTime)
      return min >= start && min <= end
    })
    const i1 = findIdx(times[0])
    const i2 = findIdx(times[1])
    if (i1 >= 0 && i2 >= 0 && Math.abs(i1 - i2) === 1) {
      const [a, b] = i1 < i2 ? [i1, i2] : [i2, i1]
      return [editable[a], editable[b]]
    }
  }

  return null
}

/** Build a merge proposal, or null if the message isn't a resolvable merge. */
export function buildMergeBlocksProposal(
  db: Database.Database,
  message: string,
  contextDate: string | null,
): AIMergeBlocksProposal | null {
  if (!looksLikeMergeBlocksInstruction(message)) return null
  const date = contextDate ?? dateFromMessage(message)
  const blocks = loadDayBlocks(db, date)
  const pair = resolveMergePair(blocks, message)
  if (!pair) return null
  const [first, second] = pair
  return {
    kind: 'merge_blocks',
    proposalId: newProposalId(),
    surface: 'card',
    confirmLabel: 'Merge blocks',
    destructive: true,
    date,
    blockIds: [first.id, second.id],
    firstLabel: labelOf(first),
    secondLabel: labelOf(second),
    firstRange: formatRange(first.startTime, first.endTime),
    secondRange: formatRange(second.startTime, second.endTime),
    mergedRange: formatRange(first.startTime, second.endTime),
  }
}

// ── Memory (preview built from extracted ops; extraction lives in the caller) ─

/** The confirmation-gate filter for extracted memory ops (DEV-185, spec
 *  §Conversational memory). Drops an add/update whose text is a secret,
 *  credential, health, or financial detail (never proposed automatically) or
 *  matches a stored rejection (a rejected proposal is not re-suggested in the
 *  next similar conversation without new evidence). Deletes and corrections of
 *  existing facts pass through — the user is steering, not being re-asked. */
export function filterMemoryOpsForProposal(db: Database.Database, ops: MemoryWriteOp[]): MemoryWriteOp[] {
  return ops.filter((op) => {
    if (op.action === 'delete') return true
    const text = op.text ?? ''
    if (isSensitiveFactStatement(text)) return false
    if (op.action === 'add' && findMemoryProposalRejection(db, text)) return false
    return true
  })
}

/** The user cancelled a memory preview card — record each proposed add/update
 *  text as a rejection so the same fact is not proposed again without new
 *  evidence. Deletes are not rejections of a fact, so they record nothing. */
export function recordMemoryProposalDismissal(db: Database.Database, action: AIMemoryProposal): void {
  for (const op of action.ops) {
    if (op.op === 'delete' || !op.text) continue
    recordMemoryProposalRejection(db, { statement: op.text })
  }
}

/** Turn extracted memory ops into a preview proposal. Returns null when there's
 *  nothing durable to change. `scope` targets a client's memory (memory.md
 *  §2.2) when the instruction named one — otherwise it's general memory. */
export function buildMemoryProposal(
  ops: MemoryWriteOp[],
  currentFacts: Array<{ id: string; text: string }>,
  scope?: { scopeId: string; scopeName: string } | null,
): AIMemoryProposal | null {
  const byId = new Map(currentFacts.map((f) => [f.id, f.text]))
  const scopeLabel = scope?.scopeName ?? 'Work'
  const previews: AIMemoryOpPreview[] = []
  for (const op of ops) {
    const prev = op.targetId ? byId.get(op.targetId) ?? null : null
    const text = op.action === 'delete' ? (prev ?? op.text ?? '') : (op.text ?? '')
    if (!text) continue
    previews.push({
      op: op.action,
      text,
      previousText: op.action === 'add' ? null : prev,
      targetId: op.targetId ?? null,
      scope: scopeLabel,
    })
  }
  if (previews.length === 0) return null
  const destructive = previews.some((p) => p.op === 'delete')
  return {
    kind: 'memory_write',
    proposalId: newProposalId(),
    surface: 'card',
    confirmLabel: destructive ? 'Update memory' : 'Save to memory',
    destructive,
    ops: previews,
    scopeId: scope?.scopeId ?? null,
  }
}

// Action previews decorate an answer; they never replace it. Keeping this merge
// explicit prevents a confirmable side effect (especially memory) from turning
// into an early-return response that stops the conversation.
export function attachActionWidgets<T extends { actionWidgets?: AIActionWidget[] }>(
  answer: T,
  widgets: AIActionWidget[],
): T {
  if (widgets.length === 0) return answer
  return {
    ...answer,
    actionWidgets: [...(answer.actionWidgets ?? []), ...widgets],
  }
}

// ── Commit (runs the real manual-edit pipeline, only on confirm) ────────────

function commitRename(db: Database.Database, action: AIRenameBlockProposal): AIActionCommitResult {
  const { date, priorOverride } = applyBlockLabelCorrection(db, {
    blockId: action.blockId,
    date: action.date,
    label: action.nextLabel,
  })
  return {
    ok: true,
    summary: `Renamed to “${action.nextLabel}”.`,
    undo: {
      kind: 'restore_block_label',
      blockId: action.blockId,
      date,
      previousLabel: priorOverride ?? action.previousLabel,
      hadOverride: priorOverride !== null,
    },
  }
}

function commitMemory(db: Database.Database, action: AIMemoryProposal): AIActionCommitResult {
  const ops: MemoryWriteOp[] = action.ops.map((p) => ({
    action: p.op,
    text: p.op === 'delete' ? undefined : p.text,
    targetId: p.targetId ?? undefined,
  }))
  // Client-scoped writes (memory.md §2.2) land in the named client's scope; a
  // general write uses the default. Update/delete operate by fact id regardless.
  const result = action.scopeId
    ? applyMemoryWriteOps(db, ops, 'chat', action.scopeId)
    : applyMemoryWriteOps(db, ops, 'chat')
  if (!result.summary.trim()) {
    return { ok: false, summary: '', error: 'Nothing changed in memory.' }
  }
  // Offer an inline undo for the simple single-add case; richer edits are
  // reversible from Settings → Memory. A scoped add lands in the client's facts,
  // not the general profile, so look it up in the right scope.
  let undo: AIActionUndo | null = null
  if (action.ops.length === 1 && action.ops[0].op === 'add') {
    const facts = action.scopeId
      ? getClientMemory(db, action.scopeId.replace(/^client:/, ''))
      : result.facts
    const added = facts.find((f) => f.text === action.ops[0].text)
    if (added) undo = { kind: 'forget_memory_fact', factId: added.id }
  }
  return { ok: true, summary: result.summary, undo }
}

function commitMerge(db: Database.Database, action: AIMergeBlocksProposal): AIActionCommitResult {
  const blocks = loadDayBlocks(db, action.date)
  const first = blocks.find((b) => b.id === action.blockIds[0])
  const second = blocks.find((b) => b.id === action.blockIds[1])
  if (!first || !second) {
    return { ok: false, summary: '', error: 'One of those blocks is no longer there.' }
  }
  applyBlockMerge(db, action.date, first, second)
  // No manual unmerge exists, so no inline undo (invariant 5).
  return { ok: true, summary: `Merged into one block (${action.mergedRange}).` }
}

export function commitAction(db: Database.Database, action: AIActionWidget): AIActionCommitResult {
  switch (action.kind) {
    case 'rename_block':
      return commitRename(db, action)
    case 'merge_blocks':
      return commitMerge(db, action)
    case 'memory_write':
      return commitMemory(db, action)
  }
}

export function undoAction(db: Database.Database, undo: AIActionUndo): AIActionCommitResult {
  switch (undo.kind) {
    case 'restore_block_label': {
      if (undo.hadOverride) {
        applyBlockLabelCorrection(db, { blockId: undo.blockId, date: undo.date, label: undo.previousLabel })
        return { ok: true, summary: `Restored “${undo.previousLabel}”.` }
      }
      clearBlockLabelCorrection(db, undo.blockId)
      return { ok: true, summary: 'Rename undone.' }
    }
    case 'forget_memory_fact': {
      applyMemoryWriteOps(db, [{ action: 'delete', targetId: undo.factId }], 'chat')
      return { ok: true, summary: 'Removed from memory.' }
    }
  }
}
