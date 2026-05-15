// Hard cap helper for context blobs concatenated into the CLI legacy system
// prompt. Heavy days can otherwise grow the prompt unboundedly, which hides
// silent cost drift behind a "the model is slower lately" symptom.
//
// Tool-calling providers (Anthropic, OpenAI, Google) do not use this helper —
// they reach for `aiTools` directly and never see a giant prebaked blob.
// CLI providers (`claude`, `codex`) cannot use the tool loop, so the legacy
// concat path is what they see; this cap is the only thing standing between
// a 12h tracked day and a 20k-char system prompt.

// ~12k chars ≈ 3k tokens. Tunable: bump if CLI answer quality drops on long
// days, lower if cost telemetry shows unexpected growth.
export const CLI_CONTEXT_CHAR_CAP = 12_000

const TRUNCATION_NOTE_RESERVE = 80

export function capContextBlock(value: string, cap = CLI_CONTEXT_CHAR_CAP): string {
  if (!value) return value
  if (value.length <= cap) return value
  const sliceEnd = cap - TRUNCATION_NOTE_RESERVE
  const droppedChars = value.length - sliceEnd
  return `${value.slice(0, sliceEnd).trimEnd()}\n\n[context truncated — ${droppedChars} chars dropped to fit prompt budget]`
}
