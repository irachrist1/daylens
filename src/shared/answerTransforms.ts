import type { AIAnswerTransformKind } from './types'

// FB7: the single source of truth for "Turn into…" transforms — the user-visible
// label, and the faithful rewrite instruction the main process runs against the
// SPECIFIC prior answer. Shared so the renderer (menu + retry re-identification)
// and the main process (the real model call) can never drift apart.

export const ANSWER_TRANSFORM_KINDS: AIAnswerTransformKind[] = ['shorter', 'checklist', 'bullets', 'report']

export const TRANSFORM_LABELS: Record<AIAnswerTransformKind, string> = {
  shorter: 'Make it shorter',
  checklist: 'Turn into a checklist',
  bullets: 'Turn into bullets',
  report: 'Turn into a report',
}

// Every instruction is faithful-by-construction: rewrite the source answer's real
// content into a new form, never re-analyze or invent data.
export const TRANSFORM_INSTRUCTIONS: Record<AIAnswerTransformKind, string> = {
  shorter: 'You tighten an existing Daylens answer. Rewrite it as a 2–4 sentence version that keeps every real fact, number, project, and time range from the source. Drop preamble and repetition. Never add data the source does not contain. Output only the rewritten answer.',
  checklist: 'You reformat an existing Daylens answer into a checklist. Output GitHub-style "- [ ] " items, one concrete action or item per line, derived only from the answer\'s content. Keep its real names and numbers. No preamble, no invented items.',
  bullets: 'You reformat an existing Daylens answer into a tight bulleted list. Lead with the most important point. Each bullet is one of the answer\'s actual points, keeping its real names and numbers. No preamble, no invented points.',
  report: 'You expand an existing Daylens answer into a short shareable report. Output markdown: a single "# " title line, then 2–4 "## " sections whose body carries the answer\'s REAL numbers, projects, threads, and time ranges. Write in second person. No filler, no vanity-dashboard language, and never invent data beyond the source answer.',
}

const LABEL_TO_KIND: Record<string, AIAnswerTransformKind> = Object.fromEntries(
  ANSWER_TRANSFORM_KINDS.map((kind) => [TRANSFORM_LABELS[kind], kind]),
) as Record<string, AIAnswerTransformKind>

export function transformLabel(kind: AIAnswerTransformKind): string {
  return TRANSFORM_LABELS[kind]
}

export function transformInstruction(kind: AIAnswerTransformKind): string {
  return TRANSFORM_INSTRUCTIONS[kind]
}

// A turn whose message is exactly a transform label IS that transform — so a
// retry re-runs it as a faithful transform, not a fresh (mis-routed) query.
export function transformKindFromLabel(label: string): AIAnswerTransformKind | null {
  return LABEL_TO_KIND[label.trim()] ?? null
}
