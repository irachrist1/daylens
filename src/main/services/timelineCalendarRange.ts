// Lightweight block read for the calendar month grid.
//
// The month view needs up to ~42 days of blocks at once. Building full
// DayTimelinePayloads for that many days re-derives sessions, websites, and
// focus data per day — far too heavy for a glance surface. This module reads
// the same persisted timeline_blocks rows the day view renders (one truth),
// reduced to the fields a month cell shows, in a single query.
//
// Label resolution mirrors the day view: a user rename in
// block_label_overrides always wins over label_current (corrections win and
// survive rebuilds). Active seconds come from the block's app_session member
// weights — the same session-time basis as blockActiveSeconds — clamped to
// the wall-clock span so a sparsely tracked block never reads larger than its
// visible range.

import type Database from 'better-sqlite3'
import type { AppCategory, ArtifactRef, CalendarRangeBlock, CalendarRangeDay, WorkKind } from '@shared/types'
import { dominantCategoryForBlock } from './workBlocks'

const WORK_KINDS: ReadonlySet<string> = new Set(['work', 'leisure', 'personal', 'idle'])

function toWorkKind(kind: string | null | undefined): WorkKind {
  return kind && WORK_KINDS.has(kind) ? kind as WorkKind : 'work'
}

interface RangeRow {
  id: string
  date: string
  start_time: number
  end_time: number
  block_kind: string | null
  label_current: string
  override_label: string | null
  category_distribution_json: string
  evidence_summary_json: string
  member_seconds: number | null
}

export function getTimelineRangeBlocks(
  db: Database.Database,
  fromDate: string,
  toDate: string,
): CalendarRangeDay[] {
  const rows = db.prepare(`
    SELECT
      b.id,
      b.date,
      b.start_time,
      b.end_time,
      b.block_kind,
      b.label_current,
      o.label AS override_label,
      b.category_distribution_json,
      b.evidence_summary_json,
      (
        SELECT SUM(m.weight_seconds)
        FROM timeline_block_members m
        WHERE m.block_id = b.id AND m.member_type = 'app_session'
      ) AS member_seconds
    FROM timeline_blocks b
    LEFT JOIN block_label_overrides o ON o.block_id = b.id
    WHERE b.date >= ? AND b.date <= ?
      AND b.invalidated_at IS NULL
      AND b.is_live = 0
      AND NOT EXISTS (
        SELECT 1 FROM timeline_block_reviews r
        WHERE r.block_id = b.id AND r.review_state = 'ignored'
      )
    ORDER BY b.date ASC, b.start_time ASC
  `).all(fromDate, toDate) as RangeRow[]

  const days = new Map<string, CalendarRangeDay>()

  for (const row of rows) {
    let distribution: Partial<Record<AppCategory, number>> = {}
    try {
      distribution = JSON.parse(row.category_distribution_json || '{}')
    } catch {
      distribution = {}
    }

    // Same category resolution as the day view's persisted read path: the
    // stored dominant_category can lag the recomputed one, so recompute from
    // the distribution + top page/document artifacts.
    let topArtifacts: ArtifactRef[] = []
    try {
      const evidence = JSON.parse(row.evidence_summary_json || '{}') as {
        pages?: ArtifactRef[]
        documents?: ArtifactRef[]
      }
      topArtifacts = [
        ...(Array.isArray(evidence.pages) ? evidence.pages : []),
        ...(Array.isArray(evidence.documents) ? evidence.documents : []),
      ]
        .sort((left, right) => right.totalSeconds - left.totalSeconds)
        .slice(0, 6)
    } catch {
      topArtifacts = []
    }

    const spanSeconds = Math.max(1, Math.round((row.end_time - row.start_time) / 1000))
    const memberSeconds = row.member_seconds ?? 0
    const activeSeconds = memberSeconds > 0 ? Math.min(memberSeconds, spanSeconds) : spanSeconds

    const block: CalendarRangeBlock = {
      id: row.id,
      date: row.date,
      startTime: row.start_time,
      endTime: row.end_time,
      dominantCategory: dominantCategoryForBlock(distribution, topArtifacts),
      label: row.override_label?.trim() || row.label_current,
      kind: toWorkKind(row.block_kind),
      activeSeconds,
    }

    const day = days.get(row.date)
    if (day) {
      day.blocks.push(block)
      day.activeSeconds += activeSeconds
    } else {
      days.set(row.date, { date: row.date, blocks: [block], activeSeconds })
    }
  }

  return [...days.values()]
}
