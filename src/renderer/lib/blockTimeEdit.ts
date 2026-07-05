// Block editor time fields (Timeline → BlockEditModal). Trim-only: edges move
// inward, never outward (timeline.md §3.4 rule 5). The server clamps again in
// trimTimelineBlockSpan; these helpers keep the modal draft honest on blur/save.

export function toTimeInputValue(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function fromTimeInputValue(value: string, baseMs: number): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const d = new Date(baseMs)
  d.setHours(Number(match[1]), Number(match[2]), 0, 0)
  return d.getTime()
}

/** Pass-through while the user is editing — never fight keystrokes or the picker. */
export function draftTimeInputChange(raw: string): string {
  return raw
}

/** Trim-only clamp when the field loses focus or Save runs. */
export function clampStartTimeDraft(raw: string, originalStartMs: number): string {
  if (!raw.trim()) return toTimeInputValue(originalStartMs)
  const ms = fromTimeInputValue(raw, originalStartMs)
  if (ms == null) return toTimeInputValue(originalStartMs)
  if (ms < originalStartMs) return toTimeInputValue(originalStartMs)
  return raw
}

export function clampEndTimeDraft(raw: string, originalEndMs: number): string {
  if (!raw.trim()) return toTimeInputValue(originalEndMs)
  const ms = fromTimeInputValue(raw, originalEndMs)
  if (ms == null) return toTimeInputValue(originalEndMs)
  if (ms > originalEndMs) return toTimeInputValue(originalEndMs)
  return raw
}

export function blockSpanDraftChanged(
  startDraft: string,
  endDraft: string,
  block: { startTime: number; endTime: number },
): { startMs: number; endMs: number; changed: boolean } | null {
  const startMs = fromTimeInputValue(startDraft, block.startTime)
  const endMs = fromTimeInputValue(endDraft, block.endTime)
  if (startMs == null || endMs == null) return null
  return {
    startMs,
    endMs,
    changed: startMs !== block.startTime || endMs !== block.endTime,
  }
}
