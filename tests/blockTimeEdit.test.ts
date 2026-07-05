import test from 'node:test'
import assert from 'node:assert/strict'
import {
  blockSpanDraftChanged,
  clampEndTimeDraft,
  clampStartTimeDraft,
  draftTimeInputChange,
  fromTimeInputValue,
  toTimeInputValue,
} from '../src/renderer/lib/blockTimeEdit.ts'

function localMs(hour: number, minute = 0): number {
  return new Date(2026, 6, 1, hour, minute, 0, 0).getTime()
}

// Mirrors the pre-fix onChange clamp from BlockEditModal (commit 0b588fa) that
// fought controlled <input type="time"> edits in Electron/Chromium.
function legacyEndDraftOnChange(raw: string, originalEndMs: number): string {
  if (!raw) return raw
  const ms = fromTimeInputValue(raw, originalEndMs)
  return ms != null && ms > originalEndMs ? toTimeInputValue(originalEndMs) : raw
}

function legacyStartDraftOnChange(raw: string, originalStartMs: number): string {
  if (!raw) return raw
  const ms = fromTimeInputValue(raw, originalStartMs)
  return ms != null && ms < originalStartMs ? toTimeInputValue(originalStartMs) : raw
}

test('draftTimeInputChange propagates picker output without clamping', () => {
  assert.equal(draftTimeInputChange('10:30'), '10:30')
  assert.equal(draftTimeInputChange('09:15'), '09:15')
  assert.equal(draftTimeInputChange(''), '')
})

test('legacy onChange clamp rejected in-progress end edits that blur now accepts', () => {
  const blockEnd = localMs(11, 0)
  assert.equal(legacyEndDraftOnChange('12:00', blockEnd), toTimeInputValue(blockEnd))

  let draft = draftTimeInputChange('12:00')
  assert.equal(draft, '12:00', 'onChange must not snap back while the user is editing')
  draft = clampEndTimeDraft(draft, blockEnd)
  assert.equal(draft, toTimeInputValue(blockEnd), 'blur enforces trim-only')
})

test('edit modal flow: onChange → blur → save payload keeps valid trims', () => {
  const block = { startTime: localMs(10, 0), endTime: localMs(11, 0) }
  let startDraft = toTimeInputValue(block.startTime)
  let endDraft = toTimeInputValue(block.endTime)

  startDraft = draftTimeInputChange('10:30')
  endDraft = draftTimeInputChange('10:45')

  startDraft = clampStartTimeDraft(startDraft, block.startTime)
  endDraft = clampEndTimeDraft(endDraft, block.endTime)

  const span = blockSpanDraftChanged(startDraft, endDraft, block)
  assert.equal(span?.changed, true)
  assert.equal(span?.startMs, localMs(10, 30))
  assert.equal(span?.endMs, localMs(10, 45))
})

test('blur rejects outward trims after the user finishes editing', () => {
  const block = { startTime: localMs(10, 0), endTime: localMs(11, 0) }

  assert.equal(clampStartTimeDraft('09:30', block.startTime), toTimeInputValue(block.startTime))
  assert.equal(clampEndTimeDraft('11:30', block.endTime), toTimeInputValue(block.endTime))
  assert.equal(
    blockSpanDraftChanged(
      clampStartTimeDraft('09:30', block.startTime),
      clampEndTimeDraft('11:30', block.endTime),
      block,
    )?.changed,
    false,
  )
})

test('legacy start onChange blocked moving the edge later through some picker steps', () => {
  const blockStart = localMs(10, 0)
  assert.equal(legacyStartDraftOnChange('09:45', blockStart), toTimeInputValue(blockStart))
  assert.equal(draftTimeInputChange('11:00'), '11:00')
  assert.equal(clampStartTimeDraft('11:00', blockStart), '11:00')
})
