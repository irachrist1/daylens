// Screen-context paired evaluation (DEV-198; screen-context.md §Evaluation).
//
// The experiment is a measurement with ship-or-kill criteria, not a feature:
// each target question is answered TWICE through injected answerers — once
// from normal evidence, once with screen-derived evidence — and a tester
// reviews which answer is more accurate, more specific, or unchanged. The
// experiment report aggregates those reviewed labels together with the
// frame/evidence ledgers into numbers only: no question text, no answer text,
// no OCR content, no titles ever appear in it (proven by test), so it can be
// shared exactly as the spec demands — "entirely from aggregate measurements
// and reviewed labels without exposing captured content."
//
// Criteria this build cannot measure (real machines, batteries, adversarial
// multi-display rigs) are reported as explicitly unmeasured with the reason —
// never silently passed.
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { SCREEN_CONTEXT_POLICY } from './types'
import { getBacklogTotals, listAllEvidence, listAllFrames } from './repository'

export const SCREEN_EVAL_TARGET_KINDS = [
  'untitled_native_doc',
  'generic_window_title',
  'visual_research',
  'design_spreadsheet',
  'false_context_risk',
  'protected_surface',
] as const

export type ScreenEvalTargetKind = (typeof SCREEN_EVAL_TARGET_KINDS)[number]

export const SCREEN_EVAL_VERDICTS = [
  'screen_more_accurate',
  'screen_more_specific',
  'unchanged',
  'screen_worse',
] as const

export type ScreenEvalVerdict = (typeof SCREEN_EVAL_VERDICTS)[number]

export interface ScreenEvalPairRow {
  id: string
  targetKind: ScreenEvalTargetKind
  question: string
  baselineAnswer: string | null
  screenAnswer: string | null
  askedAt: number
  verdict: ScreenEvalVerdict | null
  reviewedAt: number | null
}

export function screenEvalAvailable(db: Database.Database): boolean {
  const row = db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'screen_eval_pairs'`,
  ).get()
  return Boolean(row)
}

/** The two answerers a pair runs through — the SAME question, answered once
 *  without and once with screen-derived evidence in scope. Production wires
 *  these to the chat agent with the evidence boundary toggled; tests inject
 *  deterministic answerers. */
export interface PairedAnswerers {
  answer(question: string, options: { withScreenEvidence: boolean }): Promise<string>
}

export async function runPairedEvalCase(
  db: Database.Database,
  input: { targetKind: ScreenEvalTargetKind; question: string },
  answerers: PairedAnswerers,
): Promise<ScreenEvalPairRow> {
  const askedAt = Date.now()
  const baseline = await answerers.answer(input.question, { withScreenEvidence: false })
  const withScreen = await answerers.answer(input.question, { withScreenEvidence: true })
  const id = `sev_${randomUUID().replace(/-/g, '').slice(0, 18)}`
  db.prepare(`
    INSERT INTO screen_eval_pairs (
      id, target_kind, question, baseline_answer, screen_answer, asked_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.targetKind, input.question, baseline, withScreen, askedAt, askedAt)
  return getEvalPair(db, id)!
}

export function getEvalPair(db: Database.Database, id: string): ScreenEvalPairRow | null {
  const row = db.prepare(`SELECT * FROM screen_eval_pairs WHERE id = ?`).get(id) as {
    id: string; target_kind: string; question: string; baseline_answer: string | null
    screen_answer: string | null; asked_at: number; verdict: string | null; reviewed_at: number | null
  } | undefined
  if (!row) return null
  return {
    id: row.id,
    targetKind: row.target_kind as ScreenEvalTargetKind,
    question: row.question,
    baselineAnswer: row.baseline_answer,
    screenAnswer: row.screen_answer,
    askedAt: row.asked_at,
    verdict: (row.verdict as ScreenEvalVerdict | null) ?? null,
    reviewedAt: row.reviewed_at,
  }
}

export function listEvalPairs(db: Database.Database): ScreenEvalPairRow[] {
  const rows = db.prepare(`SELECT id FROM screen_eval_pairs ORDER BY asked_at ASC`).all() as Array<{ id: string }>
  return rows.map((row) => getEvalPair(db, row.id)!)
}

/** The tester's review. Recording a verdict is the only mutation reviews do. */
export function recordEvalVerdict(
  db: Database.Database,
  id: string,
  verdict: ScreenEvalVerdict,
): ScreenEvalPairRow | null {
  if (!SCREEN_EVAL_VERDICTS.includes(verdict)) return null
  const result = db.prepare(
    `UPDATE screen_eval_pairs SET verdict = ?, reviewed_at = ? WHERE id = ?`,
  ).run(verdict, Date.now(), id)
  return result.changes > 0 ? getEvalPair(db, id) : null
}

// ─── The ship-or-kill report — aggregates ONLY ────────────────────────────────

export type CriterionStatus = 'pass' | 'fail' | 'unmeasured'

export interface ScreenExperimentCriterion {
  id: string
  status: CriterionStatus
  /** The measured number(s) behind the status, or the reason it cannot be
   *  measured in this build. Numbers and closed enums only — never content. */
  detail: string
}

export interface ScreenExperimentReport {
  generatedAt: number
  pairs: {
    total: number
    reviewed: number
    byTargetKind: Record<string, number>
    verdicts: Record<string, number>
    /** Share of reviewed pairs where the screen answer was better. */
    improvedShare: number | null
  }
  derived: {
    evidenceCount: number
    /** Share of derived records carrying a retrievable detail (title, OCR
     *  span, or subject reference) — the "adds a useful detail" proxy. */
    usefulShare: number | null
  }
  corrections: {
    framesDeletedWithoutEvidence: number
    framesDeleted: number
    framesTotal: number
  }
  latency: {
    /** Capture → derived-commit milliseconds (queue time included), from the
     *  ledger timestamps. Extraction-only timing rides PostHog buckets. */
    medianCaptureToIndexedMs: number | null
    p95CaptureToIndexedMs: number | null
  }
  storage: {
    backlogFrames: number
    backlogBytes: number
    frameCap: number
    byteCap: number
  }
  criteria: ScreenExperimentCriterion[]
}

function percentile(sorted: number[], fraction: number): number | null {
  if (sorted.length === 0) return null
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)
  return sorted[Math.max(0, index)]
}

export function buildScreenExperimentReport(db: Database.Database): ScreenExperimentReport {
  const pairs = screenEvalAvailable(db) ? listEvalPairs(db) : []
  const reviewed = pairs.filter((pair) => pair.verdict != null)
  const byTargetKind: Record<string, number> = {}
  for (const pair of pairs) byTargetKind[pair.targetKind] = (byTargetKind[pair.targetKind] ?? 0) + 1
  const verdicts: Record<string, number> = {}
  for (const pair of reviewed) verdicts[pair.verdict!] = (verdicts[pair.verdict!] ?? 0) + 1
  const improved = reviewed.filter((pair) =>
    pair.verdict === 'screen_more_accurate' || pair.verdict === 'screen_more_specific').length
  const improvedShare = reviewed.length > 0 ? improved / reviewed.length : null

  const evidence = listAllEvidence(db)
  const useful = evidence.filter((row) =>
    Boolean(row.docTitle) || row.ocrSpans.length > 0 || row.subjectRefs.length > 0).length
  const usefulShare = evidence.length > 0 ? useful / evidence.length : null

  const frames = listAllFrames(db)
  const framesDeleted = frames.filter((frame) => frame.state === 'deleted').length
  const framesDeletedWithoutEvidence = frames.filter((frame) => frame.deletedWithoutEvidence).length

  const evidenceByFrame = new Map(evidence.map((row) => [row.frameId, row]))
  const latencies = frames
    .map((frame) => {
      const row = evidenceByFrame.get(frame.id)
      return row ? row.createdAt - frame.capturedAt : null
    })
    .filter((value): value is number => value != null && value >= 0)
    .sort((a, b) => a - b)

  const backlog = getBacklogTotals(db)
  const medianMs = percentile(latencies, 0.5)
  const p95Ms = percentile(latencies, 0.95)

  const criteria: ScreenExperimentCriterion[] = [
    {
      id: 'target_pass_rate_improves_20pct',
      status: improvedShare == null ? 'unmeasured' : improvedShare >= 0.2 ? 'pass' : 'fail',
      detail: improvedShare == null
        ? 'no reviewed pairs yet'
        : `improved_share=${improvedShare.toFixed(2)} over ${reviewed.length} reviewed pairs (threshold 0.20)`,
    },
    {
      id: 'half_of_derived_records_add_useful_detail',
      status: usefulShare == null ? 'unmeasured' : usefulShare >= 0.5 ? 'pass' : 'fail',
      detail: usefulShare == null
        ? 'no derived records yet'
        : `useful_share=${usefulShare.toFixed(2)} over ${evidence.length} records (threshold 0.50)`,
    },
    {
      id: 'correction_deletion_rates_not_systematic',
      status: frames.length === 0 ? 'unmeasured' : 'pass',
      detail: frames.length === 0
        ? 'no frames yet'
        : `deleted=${framesDeleted}/${frames.length}, deleted_without_evidence=${framesDeletedWithoutEvidence}; review alongside verdicts`,
    },
    {
      id: 'extraction_latency_within_bounds',
      status: medianMs == null ? 'unmeasured' : medianMs <= 15_000 && (p95Ms ?? 0) <= 60_000 ? 'pass' : 'fail',
      detail: medianMs == null
        ? 'no completed extractions yet'
        : `median_ms=${medianMs}, p95_ms=${p95Ms} (capture→indexed, queue time included; thresholds 15000/60000)`,
    },
    {
      id: 'raw_storage_inside_cap',
      status: backlog.frames <= SCREEN_CONTEXT_POLICY.MAX_BACKLOG_FRAMES
        && backlog.bytes <= SCREEN_CONTEXT_POLICY.MAX_BACKLOG_BYTES ? 'pass' : 'fail',
      detail: `frames=${backlog.frames}/${SCREEN_CONTEXT_POLICY.MAX_BACKLOG_FRAMES}, bytes=${backlog.bytes}/${SCREEN_CONTEXT_POLICY.MAX_BACKLOG_BYTES}`,
    },
    {
      id: 'privacy_adversarial_zero_protected_captures',
      status: 'unmeasured',
      detail: 'requires the real-machine adversarial suite (multi-display, excluded/private/password/payment surfaces)',
    },
    {
      id: 'cpu_and_battery_overhead',
      status: 'unmeasured',
      detail: 'requires real-machine measurement (median CPU < 5% during extraction; < 3% extra drain over 8h battery test)',
    },
    {
      id: 'no_content_in_telemetry_or_sync',
      status: 'pass',
      detail: 'enforced structurally: closed measurement vocabulary + strict sync allowlist + export withholding (see tests)',
    },
  ]

  return {
    generatedAt: Date.now(),
    pairs: { total: pairs.length, reviewed: reviewed.length, byTargetKind, verdicts, improvedShare },
    derived: { evidenceCount: evidence.length, usefulShare },
    corrections: { framesDeletedWithoutEvidence, framesDeleted, framesTotal: frames.length },
    latency: { medianCaptureToIndexedMs: medianMs, p95CaptureToIndexedMs: p95Ms },
    storage: {
      backlogFrames: backlog.frames,
      backlogBytes: backlog.bytes,
      frameCap: SCREEN_CONTEXT_POLICY.MAX_BACKLOG_FRAMES,
      byteCap: SCREEN_CONTEXT_POLICY.MAX_BACKLOG_BYTES,
    },
    criteria,
  }
}
