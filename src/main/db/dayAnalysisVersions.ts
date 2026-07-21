// Versioned day analysis — persistence (DEV-206). Every AI analysis of a day
// is an append-only VERSION: what it said, when, from which facts (facts
// hash), by which model and prompt version, and why it replaced the previous
// one. Nothing here is ever updated in place except retirement, which marks
// the current version as invalidated by a correction/deletion instead of
// deleting history — so "why did my day's analysis change?" always has an
// inspectable answer, never silent divergence.
//
// Kinds: 'day' (the day wrap narrative), 'week'/'month'/'year' (the period
// wraps that contain the day), and 'timeline' (the regroup/relabel analysis
// run). period_key is the date for 'day'/'timeline' and the period's start
// date otherwise — the same keys the wrapped narrative store uses.

import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import type {
  DayAnalysisKind,
  DayAnalysisReason,
  DayAnalysisVersionSummary,
} from '@shared/types'

export interface AppendDayAnalysisVersionInput {
  kind: DayAnalysisKind
  periodKey: string
  factsHash: string
  /** The provider model that wrote it; null for deterministic output. */
  model: string | null
  promptVersion: number
  triggerSource: string
  source: 'ai' | 'fallback' | 'deterministic'
  /** What the analysis said — the narrative object or a run summary. */
  payload: unknown
  /** Caller-known reason (e.g. 'manual-regenerate' on an explicit force).
   *  When omitted, derived from the ledger: 'initial' for the first version,
   *  the retirement reason when the previous version was retired by a
   *  correction/deletion, 'facts-changed' when the facts hash moved, and
   *  'regenerated' otherwise. */
  reason?: DayAnalysisReason
  now?: number
}

interface VersionRow {
  id: number
  kind: string
  period_key: string
  version: number
  facts_hash: string
  model: string | null
  prompt_version: number
  trigger_source: string
  source: string
  reason: string
  payload_json: string
  created_at: number
  retired_at: number | null
  retired_reason: string | null
}

function tableExists(db: Database.Database): boolean {
  const row = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='day_analysis_versions' LIMIT 1`,
  ).get()
  return Boolean(row)
}

function latestVersionRow(db: Database.Database, kind: DayAnalysisKind, periodKey: string): VersionRow | null {
  return (db.prepare(`
    SELECT * FROM day_analysis_versions
    WHERE kind = ? AND period_key = ?
    ORDER BY version DESC LIMIT 1
  `).get(kind, periodKey) as VersionRow | undefined) ?? null
}

function payloadDigest(payloadJson: string): string {
  return createHash('sha1').update(payloadJson).digest('hex')
}

function retirementToReason(retiredReason: string | null): DayAnalysisReason {
  switch (retiredReason) {
    case 'deletion': return 'deletion'
    case 'evidence-change': return 'evidence-change'
    case 'correction':
    default:
      return 'correction'
  }
}

/**
 * Append a new version for (kind, periodKey). Returns the version number
 * written, or null when nothing was appended because the latest live version
 * already says exactly this (same facts hash, same payload, same source) —
 * re-serving a stored wrap is not a new analysis.
 */
export function appendDayAnalysisVersion(
  db: Database.Database,
  input: AppendDayAnalysisVersionInput,
): number | null {
  if (!tableExists(db)) return null
  const now = input.now ?? Date.now()
  const payloadJson = JSON.stringify(input.payload ?? null)
  const latest = latestVersionRow(db, input.kind, input.periodKey)

  if (
    latest
    && latest.retired_at == null
    && latest.facts_hash === input.factsHash
    && latest.source === input.source
    && payloadDigest(latest.payload_json) === payloadDigest(payloadJson)
  ) {
    return null
  }

  const reason: DayAnalysisReason = input.reason
    ?? (!latest
      ? 'initial'
      : latest.retired_at != null
        ? retirementToReason(latest.retired_reason)
        : latest.facts_hash !== input.factsHash
          ? 'facts-changed'
          : 'regenerated')

  const version = (latest?.version ?? 0) + 1
  db.prepare(`
    INSERT INTO day_analysis_versions (
      kind, period_key, version, facts_hash, model, prompt_version,
      trigger_source, source, reason, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.kind,
    input.periodKey,
    version,
    input.factsHash,
    input.model,
    input.promptVersion,
    input.triggerSource,
    input.source,
    reason,
    payloadJson,
    now,
  )
  return version
}

/** One representative line of what a version said, for listings. */
function leadFromPayload(payloadJson: string): string | null {
  try {
    const payload = JSON.parse(payloadJson) as Record<string, unknown> | null
    if (!payload || typeof payload !== 'object') return null
    if (typeof payload.lead === 'string' && payload.lead.trim()) return payload.lead.trim()
    if (typeof payload.summary === 'string' && payload.summary.trim()) return payload.summary.trim()
    return null
  } catch {
    return null
  }
}

function toSummary(row: VersionRow): DayAnalysisVersionSummary {
  return {
    kind: row.kind as DayAnalysisKind,
    periodKey: row.period_key,
    version: row.version,
    factsHash: row.facts_hash,
    model: row.model,
    promptVersion: row.prompt_version,
    triggerSource: row.trigger_source,
    source: row.source as DayAnalysisVersionSummary['source'],
    reason: row.reason as DayAnalysisReason,
    lead: leadFromPayload(row.payload_json),
    createdAt: row.created_at,
    retiredAt: row.retired_at,
    retiredReason: row.retired_reason as DayAnalysisVersionSummary['retiredReason'],
  }
}

/** Every stored version for (kind, periodKey), newest first. */
export function listDayAnalysisVersions(
  db: Database.Database,
  kind: DayAnalysisKind,
  periodKey: string,
): DayAnalysisVersionSummary[] {
  if (!tableExists(db)) return []
  const rows = db.prepare(`
    SELECT * FROM day_analysis_versions
    WHERE kind = ? AND period_key = ?
    ORDER BY version DESC
  `).all(kind, periodKey) as VersionRow[]
  return rows.map(toSummary)
}

/** The full stored payload of one version — old versions stay inspectable. */
export function getDayAnalysisVersionPayload(
  db: Database.Database,
  kind: DayAnalysisKind,
  periodKey: string,
  version: number,
): unknown | null {
  if (!tableExists(db)) return null
  const row = db.prepare(`
    SELECT payload_json FROM day_analysis_versions
    WHERE kind = ? AND period_key = ? AND version = ?
  `).get(kind, periodKey, version) as { payload_json: string } | undefined
  if (!row) return null
  try {
    return JSON.parse(row.payload_json)
  } catch {
    return null
  }
}

export type DayAnalysisRetirementReason = 'correction' | 'deletion' | 'evidence-change'

/** Shift a YYYY-MM-DD string by whole days, in local-date arithmetic. */
function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const shifted = new Date(y, m - 1, d + days)
  const mm = String(shifted.getMonth() + 1).padStart(2, '0')
  const dd = String(shifted.getDate()).padStart(2, '0')
  return `${shifted.getFullYear()}-${mm}-${dd}`
}

/**
 * Retire the CURRENT (latest, live) version of every analysis whose period
 * contains `date` — the version ledger's half of "a correction retires the
 * prose it invalidates". The rows stay: the next generation appends a new
 * version whose reason is derived from this retirement, so the change is
 * visible, never silent. Containment math mirrors
 * deleteWrappedNarrativesForDate (week rows are keyed by the start of a
 * rolling 7-day window, month by the first of the month, year by Jan 1).
 */
export function retireDayAnalysisVersionsForDate(
  db: Database.Database,
  date: string,
  reason: DayAnalysisRetirementReason,
): void {
  if (!tableExists(db)) return
  const now = Date.now()
  const retire = (kind: DayAnalysisKind, keyWhere: string, ...params: string[]) => {
    db.prepare(`
      UPDATE day_analysis_versions
      SET retired_at = ?, retired_reason = ?
      WHERE kind = ? AND retired_at IS NULL AND ${keyWhere}
        AND version = (
          SELECT MAX(version) FROM day_analysis_versions AS inner_v
          WHERE inner_v.kind = day_analysis_versions.kind
            AND inner_v.period_key = day_analysis_versions.period_key
        )
    `).run(now, reason, kind, ...params)
  }
  retire('day', 'period_key = ?', date)
  retire('timeline', 'period_key = ?', date)
  // A week window starting up to 6 days before `date` still contains it.
  retire('week', 'period_key >= ? AND period_key <= ?', shiftDate(date, -6), date)
  retire('month', 'substr(period_key, 1, 7) = ?', date.slice(0, 7))
  retire('year', 'substr(period_key, 1, 4) = ?', date.slice(0, 4))
}
