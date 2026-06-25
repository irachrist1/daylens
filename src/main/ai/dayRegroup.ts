// Parsing for the AI day-regroup plan (timeline.md §3.3 / §5).
//
// The regroup planner sees the whole day's heuristic blocks and returns which
// ADJACENT blocks are the same continued intent and should be merged into one.
// This file owns turning that model output into a safe set of merge-groups; the
// prompt construction and the model call live in jobs/aiService.ts. Kept pure
// (no app deps) so the safety rules below are unit-testable on their own.

// Strip a ```json … ``` fence if present, then fall back to the first {…} block,
// so a plan wrapped in a fence or a sentence still parses.
function extractJsonObject(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced?.[1]?.trim() ?? raw.trim()
  if (body.startsWith('{')) return body
  const brace = body.match(/\{[\s\S]*\}/)
  return brace?.[0] ?? body
}

// Pull the merge-groups out of the model's plan, leniently. We only act on
// groups of TWO OR MORE consecutive, in-range, ascending, non-overlapping
// indices — every one of those is a safe merge of adjacent blocks. Everything
// else (singletons, a forgotten index, a stray reorder, a non-consecutive group,
// an out-of-range index) is simply ignored: it stays its own block. So a
// slightly-malformed plan can never scramble the day or drop a block — at worst
// it merges less. Returns null only when there is no parseable JSON at all
// (treated by the caller as "AI unavailable" → leave the heuristic blocks).
export function parseDayRegroupGroups(raw: string, count: number): number[][] | null {
  const candidate = extractJsonObject(raw)
  let parsed: { groups?: unknown }
  try {
    parsed = JSON.parse(candidate) as { groups?: unknown }
  } catch {
    return null
  }
  if (!Array.isArray(parsed.groups)) return null

  const merges: number[][] = []
  const used = new Set<number>()
  for (const group of parsed.groups) {
    if (!Array.isArray(group)) continue
    const members = [...new Set(
      group
        .map((value) => (typeof value === 'number' ? value : Number(value)))
        .filter((value) => Number.isInteger(value) && value >= 0 && value < count),
    )].sort((a, b) => a - b)
    if (members.length < 2) continue
    let consecutive = true
    for (let i = 1; i < members.length; i++) {
      if (members[i] !== members[i - 1] + 1) { consecutive = false; break }
    }
    if (!consecutive) continue
    if (members.some((index) => used.has(index))) continue
    members.forEach((index) => used.add(index))
    merges.push(members)
  }
  return merges
}
