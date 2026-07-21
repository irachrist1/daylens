// Full-history export (DEV-196; privacy-retention-and-sync.md §Export).
//
// The person can export their complete Daylens history to a folder they own:
//
//  - COMPLETE: the table list is enumerated from the LIVE schema
//    (sqlite_master), never a hardcoded list that rots. A table added by a
//    future migration exports automatically (it lands in the "Everything
//    else" section until someone gives it a nicer label). Anything withheld
//    is listed in the manifest's `omissions` with a reason — nothing is
//    silently omitted.
//  - PORTABLE: one JSONL file per table (a JSON object per line, column
//    names as keys, BLOBs as {"$blob_base64": …}), plus CSV/Markdown
//    summaries and a README documenting the format — usable without Daylens.
//  - PRIVATE: generated locally. This module imports only node:fs,
//    node:path, node:crypto and the database handle — no network module can
//    even be reached from here (tests/historyExport.test.ts proves it).
//  - DELETION-HONEST: deletion in Daylens is a hard delete plus the durable
//    deletion journal (deletionJournal.ts), so deleted content is already
//    absent from the live database. The soft-delete shapes that DO remain as
//    tombstone rows (deleted_at / tombstoned_at columns, status='deleted'
//    CHECKs) are filtered out here and counted in the manifest.
//  - SENSITIVITY-HONEST: rows marked sensitivity='high' are withheld unless
//    the person explicitly opts in (spec: "High-sensitivity derived evidence
//    requires an explicit export selection"), and the withheld count is in
//    the manifest. Credentials never appear because they are never in the
//    database (OS secure store only) — the manifest says so out loud.
//
// Kept free of Electron imports (paths and app version are passed in) so the
// whole plan/export/verify path runs under the hermetic test suite.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import type Database from 'better-sqlite3'
import type {
  HistoryExportOmission,
  HistoryExportPlan,
  HistoryExportProgress,
  HistoryExportRunResult,
  HistoryExportSectionSummary,
  HistoryExportTableSummary,
  HistoryExportVerification,
} from '@shared/types'

export const EXPORT_FORMAT = 'daylens-export/1'

// ─── What is withheld, and why ───────────────────────────────────────────────

// Internal machinery tables: operational bookkeeping, caches, and transient
// staging that contain no user history of their own (their content is either
// derived from exported tables or meaningless outside this install). Withheld
// AND listed in the manifest. Everything not matched here exports.
const INTERNAL_TABLES: Record<string, string> = {
  schema_version: 'migration bookkeeping — the manifest already records the schema version',
  provider_breaker_state: 'AI-provider circuit-breaker state, meaningless outside this install',
  rebuild_jobs: 'background rebuild queue bookkeeping',
  maintenance_runs: 'database maintenance run log',
  derived_projection_runs: 'projection scheduler bookkeeping',
  derived_state_versions: 'projection version bookkeeping',
  live_app_session_snapshot: 'transient in-flight capture snapshot — flushed into app_sessions',
  website_visits_pending: 'transient staging for browser-history import',
  browser_history_cursors: 'internal browser-history import cursors',
  app_profile_cache: 'derived app-profile cache, rebuilt automatically',
  memory_record_vectors: 'semantic-search embedding bookkeeping — derived, rebuilt automatically',
  // Screen-context experiment: raw frames never leave the device and the
  // derived evidence is local-only by the experiment's accepted boundary —
  // it is excluded from sync, MCP, managed AI, AND every export, until a
  // later accepted change explicitly moves that boundary.
  screen_context_frames: 'screen-context experiment frame-lifecycle ledger — local-only by the experiment boundary',
  screen_context_evidence: 'screen-context experiment derived evidence — local-only by the experiment boundary, never exported',
  screen_eval_pairs: 'screen-context paired-evaluation questions and answers — local-only experiment material; the report is aggregate-only',
}

// Columns withheld from otherwise-exported tables.
const WITHHELD_COLUMNS: Record<string, { columns: string[]; reason: string }> = {
  connector_connections: {
    columns: ['sync_cursor'],
    reason: 'internal connector sync cursors — provider bookkeeping, never user data',
  },
}

// ─── Sections ────────────────────────────────────────────────────────────────
// Human-readable grouping for the Settings preview and the manifest. Order
// matters: first match wins (corrections before timeline_*, memory before
// entity catch-alls). The final rule is a catch-all so a table added by a
// future migration still exports — completeness never depends on this list.

interface SectionRule {
  id: string
  label: string
  match: (table: string) => boolean
}

const SECTION_RULES: SectionRule[] = [
  {
    id: 'corrections',
    label: 'Corrections & reviews',
    match: (t) =>
      [
        'correction_undo_log',
        'timeline_boundary_corrections',
        'timeline_block_reviews',
        'block_label_overrides',
        'category_overrides',
        'evidence_exclusions',
        'memory_proposal_rejections',
      ].includes(t),
  },
  {
    id: 'activity',
    label: 'Captured activity',
    match: (t) =>
      [
        'app_sessions',
        'raw_window_sessions',
        'website_visits',
        'browser_context_events',
        'file_activity_events',
        'focus_events',
        'focus_sessions',
        'idle_periods',
        'activity_state_events',
        'distraction_events',
        'external_signals',
        'work_context_observations',
        'apps',
        'app_identities',
      ].includes(t),
  },
  {
    id: 'timeline',
    label: 'Timeline days & work sessions',
    match: (t) =>
      /^(timeline_|derived_|work_session|workflow_|block_)/.test(t) ||
      [
        'day_snapshots',
        'daily_summaries',
        'activity_segments',
        'segment_attributions',
        'work_sessions',
        'daily_entity_rollups',
        'pattern_occurrences',
        'context_patterns',
        'memory_index_days',
        'wrapped_narratives',
        'day_analysis_versions',
      ].includes(t),
  },
  {
    id: 'memory',
    label: 'Memory',
    match: (t) =>
      /^(memory_|work_memory|user_memory|supplied_memory)/.test(t) || t === 'daily_memory_archive',
  },
  {
    id: 'entities',
    label: 'People, projects & entities',
    match: (t) =>
      /^(entity_|entities$|client|project|artifact|attribution_)/.test(t),
  },
  {
    id: 'ai',
    label: 'AI threads & context',
    match: (t) => /^ai_/.test(t) || t === 'context_packets',
  },
  {
    id: 'connected',
    label: 'Connected sources',
    match: (t) => /^connector_/.test(t),
  },
  {
    id: 'app',
    label: 'Preferences, devices & access',
    match: (t) => ['file_access_grants', 'file_disclosures', 'devices'].includes(t),
  },
  { id: 'other', label: 'Everything else', match: () => true },
]

function sectionFor(table: string): SectionRule {
  return SECTION_RULES.find((rule) => rule.match(table))!
}

// ─── Schema enumeration ──────────────────────────────────────────────────────

export interface ExportedColumnSchema {
  name: string
  /** Declared SQLite type ("TEXT", "INTEGER", …). */
  type: string
  notnull: boolean
  pk: boolean
}

interface TableSpec {
  name: string
  section: SectionRule
  /** Column names actually exported (withheld columns removed). */
  columns: string[]
  /** Declared schema for the exported columns — shipped in schema/tables.json
   *  so the JSON can be validated against its schema version without Daylens. */
  columnSchema: ExportedColumnSchema[]
  withheldColumns: string[]
  /** WHERE fragments, ANDed. Empty = full table. */
  deletionFilters: string[]
  hasSensitivity: boolean
  totalRows: number
  exportRows: number
  deletedWithheld: number
  highSensitivityWithheld: number
}

interface SchemaEnumeration {
  tables: TableSpec[]
  /** Virtual tables (FTS5, vec0) and their shadow tables — derived indexes. */
  derivedIndexTables: string[]
  internalTables: string[]
}

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

function quoteIdent(name: string): string {
  // Every name here comes straight from sqlite_master / PRAGMA table_info,
  // but quote defensively anyway.
  return `"${name.replace(/"/g, '""')}"`
}

export interface HistoryExportOptions {
  includeHighSensitivity?: boolean
}

function enumerateSchema(db: Database.Database, options: HistoryExportOptions): SchemaEnumeration {
  const rows = db
    .prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name`)
    .all() as Array<{ name: string; sql: string | null }>

  const virtualNames = rows
    .filter((row) => /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(row.sql ?? ''))
    .map((row) => row.name)

  const derivedIndexTables: string[] = []
  const internalTables: string[] = []
  const tables: TableSpec[] = []

  for (const row of rows) {
    const name = row.name
    if (name.startsWith('sqlite_')) continue // SQLite's own bookkeeping
    if (!IDENT_RE.test(name)) continue
    if (virtualNames.includes(name) || virtualNames.some((v) => name.startsWith(`${v}_`))) {
      derivedIndexTables.push(name)
      continue
    }
    if (INTERNAL_TABLES[name]) {
      internalTables.push(name)
      continue
    }

    const columnsInfo = db.prepare(`PRAGMA table_info(${quoteIdent(name)})`).all() as Array<{
      name: string
      type: string
      notnull: number
      pk: number
    }>
    const allColumns = columnsInfo.map((c) => c.name)
    const withheld = WITHHELD_COLUMNS[name]?.columns ?? []
    const columns = allColumns.filter((c) => !withheld.includes(c))
    const columnSchema: ExportedColumnSchema[] = columnsInfo
      .filter((c) => !withheld.includes(c.name))
      .map((c) => ({ name: c.name, type: c.type, notnull: c.notnull !== 0, pk: c.pk !== 0 }))

    // Deletion tombstones that remain as rows: filter them out so deleted
    // content is NOT in the export.
    const deletionFilters: string[] = []
    if (allColumns.includes('deleted_at')) deletionFilters.push('deleted_at IS NULL')
    if (allColumns.includes('tombstoned_at')) deletionFilters.push('tombstoned_at IS NULL')
    if (
      allColumns.includes('status') &&
      /\bstatus\b[^,]*CHECK[^)]*'deleted'/i.test(row.sql ?? '')
    ) {
      deletionFilters.push(`status != 'deleted'`)
    }

    const hasSensitivity = allColumns.includes('sensitivity')

    const total = (
      db.prepare(`SELECT COUNT(*) AS n FROM ${quoteIdent(name)}`).get() as { n: number }
    ).n

    let deletedWithheld = 0
    if (deletionFilters.length > 0) {
      const kept = (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM ${quoteIdent(name)} WHERE ${deletionFilters.join(' AND ')}`,
          )
          .get() as { n: number }
      ).n
      deletedWithheld = total - kept
    }

    const filters = [...deletionFilters]
    let highSensitivityWithheld = 0
    if (hasSensitivity && !options.includeHighSensitivity) {
      const survivorsClause = deletionFilters.length
        ? `${deletionFilters.join(' AND ')} AND sensitivity = 'high'`
        : `sensitivity = 'high'`
      highSensitivityWithheld = (
        db
          .prepare(`SELECT COUNT(*) AS n FROM ${quoteIdent(name)} WHERE ${survivorsClause}`)
          .get() as { n: number }
      ).n
      filters.push(`sensitivity != 'high'`)
    }

    const exportRows = total - deletedWithheld - highSensitivityWithheld

    tables.push({
      name,
      section: sectionFor(name),
      columns,
      columnSchema,
      withheldColumns: withheld,
      deletionFilters: filters,
      hasSensitivity,
      totalRows: total,
      exportRows,
      deletedWithheld,
      highSensitivityWithheld,
    })
  }

  return { tables, derivedIndexTables, internalTables }
}

// ─── Omissions (the honesty ledger) ──────────────────────────────────────────

function buildOmissions(schema: SchemaEnumeration, options: HistoryExportOptions): HistoryExportOmission[] {
  const omissions: HistoryExportOmission[] = [
    {
      category: 'credentials',
      reason:
        'API keys, connector tokens, and sync keys live only in the operating system secure store — they are never in the database and never exported.',
    },
    {
      category: 'billing-secrets',
      reason: 'Billing lives with the payment provider; no billing secret is stored locally or exported.',
    },
    {
      category: 'raw-screen-frames',
      reason: 'Daylens never persists raw screen frames, so there are none to export.',
    },
  ]

  const deletedRows = schema.tables.reduce((sum, t) => sum + t.deletedWithheld, 0)
  const deletedTables = schema.tables.filter((t) => t.deletedWithheld > 0).map((t) => t.name)
  omissions.push({
    category: 'deleted-content',
    reason:
      'Content you deleted (and records a connected provider deleted) is not in this export. Hard deletes are already gone from the database; remaining tombstone rows are filtered out.',
    tables: deletedTables,
    rows: deletedRows,
  })

  if (!options.includeHighSensitivity) {
    const highRows = schema.tables.reduce((sum, t) => sum + t.highSensitivityWithheld, 0)
    omissions.push({
      category: 'high-sensitivity',
      reason:
        'Rows marked high-sensitivity are withheld unless you explicitly include them when exporting.',
      tables: schema.tables.filter((t) => t.highSensitivityWithheld > 0).map((t) => t.name),
      rows: highRows,
    })
  }

  if (schema.derivedIndexTables.length > 0) {
    omissions.push({
      category: 'derived-search-indexes',
      reason:
        'Full-text and semantic search indexes are derived from exported tables and rebuilt automatically — they carry no data of their own.',
      tables: schema.derivedIndexTables,
    })
  }

  omissions.push({
    category: 'internal-machinery',
    reason: 'Operational bookkeeping, caches, and transient staging with no user history of its own.',
    tables: schema.internalTables.map((t) => `${t} (${INTERNAL_TABLES[t]})`),
  })

  for (const [table, spec] of Object.entries(WITHHELD_COLUMNS)) {
    omissions.push({
      category: 'internal-columns',
      reason: `${table}.${spec.columns.join(', ')}: ${spec.reason}`,
      tables: [table],
    })
  }

  return omissions
}

// ─── Plan ────────────────────────────────────────────────────────────────────

function tableSummary(t: TableSpec): HistoryExportTableSummary {
  return {
    table: t.name,
    rows: t.exportRows,
    deletedWithheld: t.deletedWithheld,
    highSensitivityWithheld: t.highSensitivityWithheld,
  }
}

function sectionSummaries(tables: TableSpec[]): HistoryExportSectionSummary[] {
  const sections: HistoryExportSectionSummary[] = []
  for (const rule of SECTION_RULES) {
    const matched = tables.filter((t) => t.section.id === rule.id)
    if (matched.length === 0) continue
    sections.push({
      id: rule.id,
      label: rule.label,
      rows: matched.reduce((sum, t) => sum + t.exportRows, 0),
      tables: matched.map(tableSummary),
    })
  }
  return sections
}

function evidenceDayRange(db: Database.Database): { firstDay: string | null; lastDay: string | null } {
  const row = db
    .prepare(
      `SELECT
         date(MIN(start_time) / 1000, 'unixepoch', 'localtime') AS first,
         date(MAX(start_time) / 1000, 'unixepoch', 'localtime') AS last
       FROM app_sessions`,
    )
    .get() as { first: string | null; last: string | null }
  return { firstDay: row.first, lastDay: row.last }
}

export function planHistoryExport(
  db: Database.Database,
  options: HistoryExportOptions = {},
): HistoryExportPlan {
  const schema = enumerateSchema(db, options)
  const sections = sectionSummaries(schema.tables)
  const { firstDay, lastDay } = evidenceDayRange(db)
  return {
    sections,
    omissions: buildOmissions(schema, options),
    totalRows: schema.tables.reduce((sum, t) => sum + t.exportRows, 0),
    totalTables: schema.tables.length,
    highSensitivityRows: schema.tables.reduce((sum, t) => sum + t.highSensitivityWithheld, 0),
    firstDay,
    lastDay,
  }
}

// ─── Manifest ────────────────────────────────────────────────────────────────

export interface HistoryExportManifestFile {
  file: string
  sha256: string
  bytes: number
  /** Row count for data/*.jsonl files; absent for summaries. */
  rows?: number
  table?: string
}

export interface HistoryExportManifest {
  format: typeof EXPORT_FORMAT
  createdAt: string
  timezone: string
  appVersion: string
  schemaVersion: number
  includeHighSensitivity: boolean
  dateRange: { firstDay: string | null; lastDay: string | null }
  sections: HistoryExportSectionSummary[]
  omissions: HistoryExportOmission[]
  files: HistoryExportManifestFile[]
  totals: { tables: number; rows: number; bytes: number }
}

// ─── Streaming writer ────────────────────────────────────────────────────────

class HashingFileWriter {
  private stream: fs.WriteStream
  private hash = crypto.createHash('sha256')
  bytes = 0

  constructor(readonly filePath: string) {
    this.stream = fs.createWriteStream(filePath, { encoding: 'utf8' })
  }

  /** Write one chunk, honoring backpressure so year-scale tables never buffer
   *  the whole file in memory. */
  async write(chunk: string): Promise<void> {
    this.hash.update(chunk, 'utf8')
    this.bytes += Buffer.byteLength(chunk, 'utf8')
    if (!this.stream.write(chunk)) {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error) => reject(err)
        this.stream.once('error', onError)
        this.stream.once('drain', () => {
          this.stream.removeListener('error', onError)
          resolve()
        })
      })
    }
  }

  async close(): Promise<string> {
    await new Promise<void>((resolve, reject) => {
      this.stream.end((err?: Error | null) => (err ? reject(err) : resolve()))
    })
    return this.hash.digest('hex')
  }
}

function encodeValue(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return { $blob_base64: value.toString('base64') }
  if (typeof value === 'bigint') return value.toString()
  return value
}

function encodeRow(columns: string[], row: Record<string, unknown>): string {
  const out: Record<string, unknown> = {}
  for (const column of columns) out[column] = encodeValue(row[column])
  return `${JSON.stringify(out)}\n`
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

// ─── Export ──────────────────────────────────────────────────────────────────

export interface RunHistoryExportInput extends HistoryExportOptions {
  /** The folder the person chose; the export is created as a subfolder. */
  destinationDir: string
  appVersion: string
  onProgress?: (progress: HistoryExportProgress) => void
  now?: Date
}

const PROGRESS_EVERY_ROWS = 2000

function readSchemaVersion(db: Database.Database): number {
  try {
    const row = db.prepare(`SELECT MAX(version) AS v FROM schema_version`).get() as {
      v: number | null
    }
    return row.v ?? 0
  } catch {
    return 0
  }
}

async function writeStringFile(filePath: string, content: string): Promise<{ sha256: string; bytes: number }> {
  const writer = new HashingFileWriter(filePath)
  await writer.write(content)
  const sha256 = await writer.close()
  return { sha256, bytes: writer.bytes }
}

function dailyTimeCsv(db: Database.Database): string {
  // Canonical time per local day and app (spec: "CSV for canonical time").
  const rows = db
    .prepare(
      `SELECT date(start_time / 1000, 'unixepoch', 'localtime') AS day,
              app_name,
              SUM(duration_sec) AS seconds
       FROM app_sessions
       GROUP BY day, app_name
       ORDER BY day, seconds DESC`,
    )
    .all() as Array<{ day: string; app_name: string; seconds: number }>
  const lines = ['day,app,seconds']
  for (const row of rows) lines.push([row.day, row.app_name, row.seconds].map(csvCell).join(','))
  return `${lines.join('\n')}\n`
}

function entityTotalsCsv(db: Database.Database): string {
  // Common entity totals (spec: "common entity totals").
  const rows = db
    .prepare(
      `SELECT e.entity_type AS type, e.canonical_name AS name,
              (SELECT COUNT(*) FROM entity_evidence_refs r WHERE r.entity_id = e.id) AS evidence_count
       FROM entities e
       WHERE e.status != 'deleted'
       ORDER BY evidence_count DESC, e.canonical_name`,
    )
    .all() as Array<{ type: string; name: string; evidence_count: number }>
  const lines = ['type,name,evidence_count']
  for (const row of rows) lines.push([row.type, row.name, row.evidence_count].map(csvCell).join(','))
  return `${lines.join('\n')}\n`
}

// The schema shipped INSIDE the export (schema/tables.json), so the JSON can
// be validated against its own schema version without Daylens (ticket
// acceptance: "its JSON validates against its included schema version").
export interface HistoryExportSchemaDoc {
  format: typeof EXPORT_FORMAT
  schemaVersion: number
  tables: Record<string, { columns: ExportedColumnSchema[] }>
}

function schemaDoc(db: Database.Database, tables: TableSpec[]): HistoryExportSchemaDoc {
  const doc: HistoryExportSchemaDoc = {
    format: EXPORT_FORMAT,
    schemaVersion: readSchemaVersion(db),
    tables: {},
  }
  for (const table of tables) doc.tables[table.name] = { columns: table.columnSchema }
  return doc
}

/** Validate one parsed JSONL row against the shipped column schema: exact
 *  column set, NOT NULL constraints honored, and BLOB encoding shape. Returns
 *  the problems found (empty = valid). Deliberately lenient on scalar types —
 *  SQLite is dynamically typed, so the declared type is documentation, not a
 *  promise the validator should fail on. */
export function validateRowAgainstSchema(
  row: Record<string, unknown>,
  columns: ExportedColumnSchema[],
): string[] {
  const problems: string[] = []
  const declared = new Set(columns.map((c) => c.name))
  for (const key of Object.keys(row)) {
    if (!declared.has(key)) problems.push(`unexpected column "${key}"`)
  }
  for (const column of columns) {
    if (!(column.name in row)) {
      problems.push(`missing column "${column.name}"`)
      continue
    }
    const value = row[column.name]
    if (value === null) {
      if (column.notnull) problems.push(`null in NOT NULL column "${column.name}"`)
      continue
    }
    if (typeof value === 'object') {
      const keys = Object.keys(value as Record<string, unknown>)
      const blob = (value as Record<string, unknown>)['$blob_base64']
      if (keys.length !== 1 || typeof blob !== 'string') {
        problems.push(`column "${column.name}" holds an object that is not a {"$blob_base64"} blob`)
      }
    }
  }
  return problems
}

// ─── Human-navigable day pages + index ───────────────────────────────────────
// A person must be able to locate a known day, entity, and correction in the
// export WITHOUT Daylens (ticket acceptance #4): days/YYYY/YYYY-MM-DD.md are
// readable dated files, and index.md at the root maps everything.

interface DayPageRow {
  day: string
  file: string
}

async function writeDayPages(
  db: Database.Database,
  workDir: string,
  addFile: (entry: HistoryExportManifestFile) => void,
): Promise<DayPageRow[]> {
  // Two grouped passes over the whole range (instead of a scan per day) keep
  // this fast on year-scale databases; results are grouped in memory per DAY,
  // which is bounded, never per row.
  const appRows = db
    .prepare(
      `SELECT date(start_time / 1000, 'unixepoch', 'localtime') AS day,
              app_name, SUM(duration_sec) AS seconds, COUNT(*) AS sessions
       FROM app_sessions
       GROUP BY day, app_name ORDER BY day, seconds DESC`,
    )
    .all() as Array<{ day: string; app_name: string; seconds: number; sessions: number }>
  const appsByDay = new Map<string, Array<{ app_name: string; seconds: number; sessions: number }>>()
  for (const row of appRows) {
    const bucket = appsByDay.get(row.day) ?? []
    bucket.push(row)
    appsByDay.set(row.day, bucket)
  }
  const blockRows = db
    .prepare(`SELECT date, start_time, end_time, label_current FROM timeline_blocks ORDER BY date, start_time`)
    .all() as Array<{ date: string; start_time: number; end_time: number; label_current: string }>
  const blocksByDay = new Map<string, Array<{ start_time: number; end_time: number; label_current: string }>>()
  for (const row of blockRows) {
    const bucket = blocksByDay.get(row.date) ?? []
    bucket.push(row)
    blocksByDay.set(row.date, bucket)
  }

  const written: DayPageRow[] = []
  for (const day of [...appsByDay.keys()].sort()) {
    const year = day.slice(0, 4)
    const relative = `days/${year}/${day}.md`
    fs.mkdirSync(path.join(workDir, 'days', year), { recursive: true })

    const apps = appsByDay.get(day)!
    const totalSeconds = apps.reduce((sum, a) => sum + a.seconds, 0)
    const lines: string[] = [
      `# ${day}`,
      '',
      `Tracked time: ${Math.round(totalSeconds / 60)} minutes across ${apps.length} application${apps.length === 1 ? '' : 's'}.`,
      '',
      '## Time by application',
      '',
    ]
    for (const app of apps) {
      lines.push(`- ${app.app_name} — ${Math.round(app.seconds / 60)} min (${app.sessions} session${app.sessions === 1 ? '' : 's'})`)
    }
    const dayBlocks = blocksByDay.get(day) ?? []
    if (dayBlocks.length > 0) {
      lines.push('', '## Timeline', '')
      for (const block of dayBlocks) {
        const from = new Date(block.start_time).toTimeString().slice(0, 5)
        const to = new Date(block.end_time).toTimeString().slice(0, 5)
        lines.push(`- ${from}–${to} ${block.label_current}`)
      }
    }
    lines.push(
      '',
      `Full detail for this day lives in the machine-readable files under data/ (filter on \`date\` = "${day}" or timestamps within the day).`,
      '',
    )

    const result = await writeStringFile(path.join(workDir, ...relative.split('/')), lines.join('\n'))
    addFile({ file: relative, ...result })
    written.push({ day, file: relative })
  }
  return written
}

function indexMarkdown(sections: HistoryExportSectionSummary[], dayPages: DayPageRow[]): string {
  const lines: string[] = [
    '# Daylens export — start here',
    '',
    '- `README.md` — the file format, documented.',
    '- `manifest.json` — exactly what this export contains, what was withheld and why, and a checksum for every file.',
    '- `summary/overview.md` — a human-readable overview.',
    '- `summary/daily-time.csv` — canonical time per local day and application.',
    '- `summary/entity-totals.csv` — every known person/project/page/entity by name, with evidence totals. Search this file to locate an entity, then find its rows in `data/entities.jsonl` and `data/entity_evidence_refs.jsonl`.',
    '',
    '## Your data, by section',
    '',
    'Each section below lists the machine-readable files (one JSON record per line) that hold it:',
    '',
  ]
  for (const section of sections) {
    if (section.tables.length === 0) continue
    lines.push(`### ${section.label}`)
    lines.push('')
    for (const table of section.tables) {
      lines.push(`- \`data/${table.table}.jsonl\` — ${table.rows.toLocaleString('en-US')} records`)
    }
    lines.push('')
  }

  lines.push('## Your days', '')
  if (dayPages.length === 0) {
    lines.push('No captured days yet.', '')
  } else {
    lines.push('One readable page per captured day:', '')
    let currentMonth = ''
    for (const page of dayPages) {
      const month = page.day.slice(0, 7)
      if (month !== currentMonth) {
        currentMonth = month
        lines.push('', `### ${month}`, '')
      }
      lines.push(`- [${page.day}](${page.file})`)
    }
    lines.push('')
  }

  lines.push(
    '## Finding things without Daylens',
    '',
    '- **A day**: open `days/<year>/<date>.md`, or filter `summary/daily-time.csv` by the `day` column.',
    '- **An entity** (a person, project, page…): search `summary/entity-totals.csv` for its name; its full records are in `data/entities.jsonl` (matched by `canonical_name`), with aliases in `data/entity_aliases.jsonl` and evidence in `data/entity_evidence_refs.jsonl`.',
    '- **A correction you made**: `data/correction_undo_log.jsonl` (every applied correction, with its date and description), plus `data/timeline_boundary_corrections.jsonl`, `data/block_label_overrides.jsonl`, and `data/category_overrides.jsonl`.',
    '- **Schema**: `schema/tables.json` declares every exported table and column, so the JSONL files validate against the schema version this export was written with.',
    '',
  )
  return lines.join('\n')
}

function overviewMarkdown(manifest: HistoryExportManifest): string {
  const lines: string[] = [
    '# Your Daylens history',
    '',
    `Exported ${manifest.createdAt} (${manifest.timezone}) by Daylens ${manifest.appVersion}.`,
    '',
    manifest.dateRange.firstDay
      ? `Covers ${manifest.dateRange.firstDay} through ${manifest.dateRange.lastDay}.`
      : 'No captured activity yet.',
    '',
    '## What is inside',
    '',
  ]
  for (const section of manifest.sections) {
    lines.push(`- **${section.label}** — ${section.rows.toLocaleString('en-US')} records across ${section.tables.length} table${section.tables.length === 1 ? '' : 's'}`)
  }
  lines.push('', '## What was withheld, and why', '')
  for (const omission of manifest.omissions) {
    const count = omission.rows != null ? ` (${omission.rows.toLocaleString('en-US')} rows)` : ''
    lines.push(`- **${omission.category}**${count}: ${omission.reason}`)
  }
  lines.push(
    '',
    '## Deletion contract',
    '',
    'This export now lives outside Daylens: deleting something inside Daylens later will NOT reach into this folder. Delete the folder yourself if you no longer want it.',
    '',
  )
  return lines.join('\n')
}

function formatReadme(): string {
  return [
    '# Daylens export format',
    '',
    `Format: \`${EXPORT_FORMAT}\``,
    '',
    'This folder is self-contained and usable without Daylens. Start at `index.md`.',
    '',
    '- `index.md` — the human entry point: where every day, entity, and correction lives.',
    '- `manifest.json` — what this export contains: app/schema versions, timezone, date',
    '  range, per-section record counts, the full list of withheld categories with',
    '  reasons, and a SHA-256 checksum + row count for every data file.',
    '- `schema/tables.json` — the declared schema (every exported table and column,',
    '  with types and NOT NULL constraints) for the schema version this export was',
    '  written with; the JSONL files validate against it.',
    '- `data/<table>.jsonl` — one file per database table. Each line is one record as',
    '  a JSON object; keys are the column names. Binary values are encoded as',
    '  `{"$blob_base64": "..."}`. Timestamps are Unix milliseconds unless the column',
    '  name says otherwise; `date` columns are local calendar days (YYYY-MM-DD).',
    '- `days/<year>/<date>.md` — one readable page per captured day.',
    '- `summary/daily-time.csv` — canonical time per local day and application.',
    '- `summary/entity-totals.csv` — evidence totals per known person/project/entity.',
    '- `summary/overview.md` — a human-readable overview of the export.',
    '',
    'To verify integrity, recompute each file’s SHA-256 and line count and compare',
    'them with `manifest.json` (Daylens Settings → Export can do this for you).',
    '',
  ].join('\n')
}

let exportRunning = false

export async function runHistoryExport(
  db: Database.Database,
  input: RunHistoryExportInput,
): Promise<HistoryExportRunResult> {
  if (exportRunning) {
    return { ok: false, error: 'An export is already running.', incompleteSections: [] }
  }
  exportRunning = true

  const now = input.now ?? new Date()
  const stamp = now
    .toISOString()
    .replace(/[:]/g, '')
    .replace(/\..+$/, '')
    .replace('T', '-')
  const folderName = `daylens-export-${stamp}`
  const finalDir = path.join(input.destinationDir, folderName)
  // Build in a .partial sibling and rename at the end, so a folder named
  // daylens-export-* is only ever a COMPLETE export, and failures clean up
  // after themselves (spec: temporary copies are cleaned up on completion or
  // failure; failure leaves source data unchanged and identifies incomplete
  // sections).
  const workDir = `${finalDir}.partial`

  const completedSections = new Set<string>()
  let currentSection: string | null = null

  try {
    const schema = enumerateSchema(db, input)
    const sections = sectionSummaries(schema.tables)
    const omissions = buildOmissions(schema, input)
    const totalRows = schema.tables.reduce((sum, t) => sum + t.exportRows, 0)

    fs.rmSync(workDir, { recursive: true, force: true })
    fs.mkdirSync(path.join(workDir, 'data'), { recursive: true })
    fs.mkdirSync(path.join(workDir, 'summary'), { recursive: true })
    fs.mkdirSync(path.join(workDir, 'schema'), { recursive: true })

    const files: HistoryExportManifestFile[] = []
    let rowsDone = 0

    const report = (stage: HistoryExportProgress['stage'], table: string | null, tableIndex: number) => {
      input.onProgress?.({
        stage,
        table,
        tableIndex,
        tableCount: schema.tables.length,
        rowsDone,
        totalRows,
      })
    }

    // 1. Stream every table.
    for (let i = 0; i < schema.tables.length; i++) {
      const table = schema.tables[i]
      currentSection = table.section.label
      report('tables', table.name, i)
      const relative = path.join('data', `${table.name}.jsonl`)
      const result = await writeTableFileWithProgress(db, table, path.join(workDir, relative), (n) => {
        rowsDone += n
        report('tables', table.name, i)
      })
      files.push({ file: relative.split(path.sep).join('/'), table: table.name, ...result })
      completedSections.add(table.section.label)
    }
    currentSection = null

    // 2. The schema this export's JSON validates against, shipped inside it.
    currentSection = 'Schema'
    report('summaries', null, schema.tables.length)
    const schemaFile = await writeStringFile(
      path.join(workDir, 'schema', 'tables.json'),
      `${JSON.stringify(schemaDoc(db, schema.tables), null, 2)}\n`,
    )
    files.push({ file: 'schema/tables.json', ...schemaFile })

    // 3. Summaries + human-navigable day pages and index.
    currentSection = 'Summaries'
    const daily = await writeStringFile(path.join(workDir, 'summary', 'daily-time.csv'), dailyTimeCsv(db))
    files.push({ file: 'summary/daily-time.csv', ...daily })
    const entityTotals = await writeStringFile(
      path.join(workDir, 'summary', 'entity-totals.csv'),
      entityTotalsCsv(db),
    )
    files.push({ file: 'summary/entity-totals.csv', ...entityTotals })

    currentSection = 'Day pages'
    const dayPages = await writeDayPages(db, workDir, (entry) => files.push(entry))
    const index = await writeStringFile(path.join(workDir, 'index.md'), indexMarkdown(sections, dayPages))
    files.push({ file: 'index.md', ...index })
    currentSection = 'Summaries'

    const manifest: HistoryExportManifest = {
      format: EXPORT_FORMAT,
      createdAt: now.toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      appVersion: input.appVersion,
      schemaVersion: readSchemaVersion(db),
      includeHighSensitivity: Boolean(input.includeHighSensitivity),
      dateRange: evidenceDayRange(db),
      sections,
      omissions,
      files,
      totals: {
        tables: schema.tables.length,
        rows: totalRows,
        bytes: files.reduce((sum, f) => sum + f.bytes, 0),
      },
    }

    const overview = await writeStringFile(
      path.join(workDir, 'summary', 'overview.md'),
      overviewMarkdown(manifest),
    )
    manifest.files.push({ file: 'summary/overview.md', ...overview })
    manifest.totals.bytes += overview.bytes

    const readme = await writeStringFile(path.join(workDir, 'README.md'), formatReadme())
    manifest.files.push({ file: 'README.md', ...readme })
    manifest.totals.bytes += readme.bytes

    fs.writeFileSync(path.join(workDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    currentSection = null

    // 4. Verify the export we just wrote — proof of completeness before we
    // tell the person it worked.
    report('verify', null, schema.tables.length)
    const verification = await verifyHistoryExport(workDir)
    if (!verification.ok) {
      throw new Error(`Export self-verification failed: ${verification.issues.join('; ')}`)
    }

    fs.rmSync(finalDir, { recursive: true, force: true })
    fs.renameSync(workDir, finalDir)

    return {
      ok: true,
      exportDir: finalDir,
      manifestPath: path.join(finalDir, 'manifest.json'),
      totalRows,
      totalTables: schema.tables.length,
      totalBytes: manifest.totals.bytes,
      omissions,
      verification,
    }
  } catch (error) {
    // Best-effort cleanup — the cleanup itself must never mask the real error
    // (e.g. an unwritable destination throws ENOTDIR here too).
    try {
      fs.rmSync(workDir, { recursive: true, force: true })
    } catch {
      /* the partial folder (if any) could not be removed; the export still failed honestly */
    }
    const incomplete = currentSection ? [currentSection] : []
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      incompleteSections: incomplete,
    }
  } finally {
    exportRunning = false
  }
}

async function writeTableFileWithProgress(
  db: Database.Database,
  table: TableSpec,
  filePath: string,
  onRows: (delta: number) => void,
): Promise<{ sha256: string; bytes: number; rows: number }> {
  const writer = new HashingFileWriter(filePath)
  const where = table.deletionFilters.length ? ` WHERE ${table.deletionFilters.join(' AND ')}` : ''
  const select = `SELECT ${table.columns.map(quoteIdent).join(', ')} FROM ${quoteIdent(table.name)}${where}`
  let rows = 0
  let sinceReport = 0
  try {
    for (const row of db.prepare(select).iterate() as IterableIterator<Record<string, unknown>>) {
      await writer.write(encodeRow(table.columns, row))
      rows += 1
      sinceReport += 1
      if (sinceReport >= PROGRESS_EVERY_ROWS) {
        onRows(sinceReport)
        sinceReport = 0
      }
    }
  } catch (error) {
    await writer.close().catch(() => {})
    throw error
  }
  if (sinceReport > 0) onRows(sinceReport)
  const sha256 = await writer.close()
  return { sha256, bytes: writer.bytes, rows }
}

// ─── Verification ────────────────────────────────────────────────────────────
// Re-reads an export from disk and checks every file's checksum, byte size,
// and (for data files) row count against the manifest — the person's proof
// that the folder really contains what the manifest claims.

async function hashAndCountFile(
  filePath: string,
  onLine?: (line: string) => void,
): Promise<{ sha256: string; bytes: number; lines: number }> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    let bytes = 0
    let lines = 0
    let pending = ''
    // StringDecoder so a multi-byte UTF-8 character split across read chunks
    // never corrupts a line before JSON.parse sees it.
    const decoder = new StringDecoder('utf8')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk: string | Buffer) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      hash.update(buf)
      bytes += buf.length
      if (!onLine) {
        for (const byte of buf) if (byte === 0x0a) lines += 1
        return
      }
      pending += decoder.write(buf)
      let newline = pending.indexOf('\n')
      while (newline !== -1) {
        lines += 1
        onLine(pending.slice(0, newline))
        pending = pending.slice(newline + 1)
        newline = pending.indexOf('\n')
      }
    })
    stream.on('error', reject)
    stream.on('end', () => resolve({ sha256: hash.digest('hex'), bytes, lines }))
  })
}

export async function verifyHistoryExport(exportDir: string): Promise<HistoryExportVerification> {
  const issues: string[] = []
  let tablesChecked = 0
  let rowsChecked = 0

  let manifest: HistoryExportManifest
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(exportDir, 'manifest.json'), 'utf8'))
  } catch (error) {
    return {
      ok: false,
      issues: [`manifest.json unreadable: ${error instanceof Error ? error.message : String(error)}`],
      tablesChecked: 0,
      rowsChecked: 0,
    }
  }

  if (manifest.format !== EXPORT_FORMAT) {
    issues.push(`unknown format "${manifest.format}" (expected "${EXPORT_FORMAT}")`)
  }

  // The shipped schema (schema/tables.json): every data row is validated
  // against it, so "the JSON validates against its included schema version"
  // is checked from disk, not assumed.
  let shippedSchema: HistoryExportSchemaDoc | null = null
  try {
    shippedSchema = JSON.parse(fs.readFileSync(path.join(exportDir, 'schema', 'tables.json'), 'utf8'))
  } catch {
    issues.push('schema/tables.json missing or unreadable — rows cannot be validated against the shipped schema')
  }
  if (shippedSchema && shippedSchema.schemaVersion !== manifest.schemaVersion) {
    issues.push(
      `shipped schema version ${shippedSchema.schemaVersion} does not match manifest schema version ${manifest.schemaVersion}`,
    )
  }

  for (const entry of manifest.files ?? []) {
    const filePath = path.join(exportDir, ...entry.file.split('/'))
    if (!fs.existsSync(filePath)) {
      issues.push(`${entry.file}: missing`)
      continue
    }
    const columns = entry.table ? shippedSchema?.tables[entry.table]?.columns : undefined
    if (entry.table && shippedSchema && !columns) {
      issues.push(`${entry.file}: table "${entry.table}" is absent from the shipped schema`)
    }
    let rowIssues = 0
    const onLine = columns
      ? (line: string) => {
          if (rowIssues >= 3) return // cap noise per table; one issue already fails verification
          try {
            const problems = validateRowAgainstSchema(JSON.parse(line), columns)
            for (const problem of problems.slice(0, 3 - rowIssues)) {
              rowIssues += 1
              issues.push(`${entry.file}: ${problem}`)
            }
          } catch {
            rowIssues += 1
            issues.push(`${entry.file}: line is not valid JSON`)
          }
        }
      : undefined
    const actual = await hashAndCountFile(filePath, onLine)
    if (actual.sha256 !== entry.sha256) issues.push(`${entry.file}: checksum mismatch`)
    if (actual.bytes !== entry.bytes) {
      issues.push(`${entry.file}: size mismatch (manifest ${entry.bytes}, actual ${actual.bytes})`)
    }
    if (entry.rows != null) {
      tablesChecked += 1
      rowsChecked += actual.lines
      if (actual.lines !== entry.rows) {
        issues.push(`${entry.file}: row count mismatch (manifest ${entry.rows}, actual ${actual.lines})`)
      }
    }
  }

  const manifestTableCount = (manifest.files ?? []).filter((f) => f.rows != null).length
  if (manifest.totals && manifestTableCount !== manifest.totals.tables) {
    issues.push(
      `manifest lists ${manifestTableCount} table files but claims ${manifest.totals.tables} tables`,
    )
  }
  const manifestRowTotal = (manifest.files ?? []).reduce((sum, f) => sum + (f.rows ?? 0), 0)
  if (manifest.totals && manifestRowTotal !== manifest.totals.rows) {
    issues.push(`manifest table rows sum to ${manifestRowTotal} but totals claim ${manifest.totals.rows}`)
  }

  return { ok: issues.length === 0, issues, tablesChecked, rowsChecked }
}
