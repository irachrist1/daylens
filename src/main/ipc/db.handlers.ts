import { ipcMain } from 'electron'
import {
  clearBlockLabelOverride,
  setBlockLabelOverride,
  getAppCharacter,
  getAppSummariesForRange,
  getPeakHours,
  getSessionsForRange,
  getSessionsForApp,
  getWebsiteSummariesForRange,
  setCategoryOverride,
  clearCategoryOverride,
  getCategoryOverrides,
  getBlockLabelOverride,
  writeAIBlockLabel,
} from '../db/queries'
import { getAppDetailProjection, getArtifactDetailProjection, getHistoryDayProjection, getTimelineDayProjection, getWorkflowPatternsProjection, getWeeklySummaryProjection, materializeTimelineDayProjection } from '../core/query/projections'
import { readDerivedAppSummariesForDate } from '../core/projections/chunk2'
import { invalidateProjectionScope } from '../core/projections/invalidation'
import {
  resolveClientQuery,
  resolveDayContext,
  findClientByName,
  listClients,
  listClientsDetailed,
  createClient,
  updateClient,
  archiveClient,
  restoreClient,
  getOrCreateClientByName,
  getRollupSummary,
} from '../core/query/attributionResolvers'
import type { ClientRecord } from '../core/query/attributionResolvers'
import { runAttributionForRange } from '../services/attribution'
import { backfillMemoryFromHistory } from '../jobs/eveningConsolidation'
import { getDb, tableExists } from '../services/database'
import { getCurrentSession, getLinuxTrackingDiagnostics, trackingStatus } from '../services/tracking'
import { getProcessMetrics } from '../services/processMonitor'
import { getBlockDetailPayload, getDistractionCostPayload, getRecapRange, shouldReanalyzeBlockWithAI } from '../services/workBlocks'
import { computeAppActivityDigest } from '../services/appActivityDigest'
import { generateWorkBlockInsight, scheduleTimelineAIJobs } from '../services/ai'
import { resolveIcon } from '../services/iconResolver'
import { getLinuxDesktopDiagnostics } from '../services/linuxDesktop'
import { IPC } from '@shared/types'
import { getTrackingPermissionState, requestScreenTrackingPermission } from '../services/trackingPermissions'
import type {
  AppUsageSummary,
  AppSession,
  WorkSessionPayload,
  WorkSessionApp,
  ActivitySegmentPayload,
  ClientDetailPayload,
  IconRequest,
  ProjectSummary,
  RollupEntry,
  DayWorkSessionsPayload,
  WorkContextBlock,
  WorkContextInsight,
  TimelineWorkSession,
  WorkMemorySettingsSummary,
} from '@shared/types'
import { FOCUSED_CATEGORIES } from '@shared/types'

// ─── Date helpers ─────────────────────────────────────────────────────────────

// Returns today's date as a local YYYY-MM-DD string.
// DO NOT use new Date().toISOString().split('T')[0] — that returns the UTC date,
// which is wrong in UTC- timezones (e.g. EST) after ~7pm.
function localDateString(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Returns [fromMs, toMs] spanning the full local calendar day for a YYYY-MM-DD string.
// Constructs from year/month/day components so the result is always local midnight,
// regardless of how Date() parses ISO strings (which vary by platform/timezone).
function dayBounds(dateStr: string): [number, number] {
  const [y, m, d] = dateStr.split('-').map(Number)
  const from = new Date(y, m - 1, d).getTime()  // local midnight
  return [from, from + 86_400_000]
}

function shiftLocalDate(dateStr: string, offset: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const next = new Date(y, m - 1, d + offset)
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`
}

function mergeAppSummaryRows(rows: AppUsageSummary[]): AppUsageSummary[] {
  const map = new Map<string, AppUsageSummary>()
  for (const row of rows) {
    const key = row.canonicalAppId ?? row.bundleId
    const existing = map.get(key)
    if (existing) {
      existing.totalSeconds += row.totalSeconds
      existing.sessionCount = (existing.sessionCount ?? 0) + (row.sessionCount ?? 0)
      existing.isFocused = existing.isFocused || row.isFocused
      continue
    }
    map.set(key, { ...row })
  }
  return [...map.values()]
    .filter((summary) => summary.totalSeconds > 0)
    .sort((left, right) => right.totalSeconds - left.totalSeconds)
}

function getCachedRangeAppSummaries(days: number): AppUsageSummary[] {
  const db = getDb()
  const today = localDateString()
  const rows: AppUsageSummary[] = []
  for (let offset = Math.max(1, days) - 1; offset >= 0; offset--) {
    const dateStr = shiftLocalDate(today, -offset)
    if (dateStr !== today) {
      const derived = readDerivedAppSummariesForDate(db, dateStr)
      if (derived) {
        rows.push(...derived)
        continue
      }
    }
    const [from, to] = dayBounds(dateStr)
    rows.push(...getAppSummariesForRange(db, from, to))
  }
  return mergeAppSummaryRows(rows)
}

function getWorkMemorySettingsSummary(db: ReturnType<typeof getDb>): WorkMemorySettingsSummary {
  if (!tableExists(db, 'context_patterns')) {
    return { promotedCount: 0, totalOccurrences: 0, topPatterns: [] }
  }

  const promoted = db.prepare(`
    SELECT COUNT(*) AS count
    FROM context_patterns
    WHERE status = 'promoted'
  `).get() as { count: number }

  const totalOccurrences = tableExists(db, 'pattern_occurrences')
    ? (db.prepare(`SELECT COUNT(*) AS count FROM pattern_occurrences`).get() as { count: number }).count
    : 0

  const topPatterns = db.prepare(`
    SELECT
      context_patterns.id,
      context_patterns.label_suggestion AS label,
      context_patterns.category_suggestion AS category,
      context_patterns.confidence,
      context_patterns.recall_count AS recallCount,
      context_patterns.updated_at AS updatedAt,
      COUNT(pattern_occurrences.id) AS occurrenceCount
    FROM context_patterns
    LEFT JOIN pattern_occurrences
      ON pattern_occurrences.pattern_id = context_patterns.id
    WHERE context_patterns.status = 'promoted'
    GROUP BY context_patterns.id
    ORDER BY context_patterns.confidence DESC, occurrenceCount DESC, context_patterns.updated_at DESC
    LIMIT 5
  `).all() as WorkMemorySettingsSummary['topPatterns']

  return {
    promotedCount: promoted.count,
    totalOccurrences,
    topPatterns,
  }
}

function forgetWorkMemoryPattern(db: ReturnType<typeof getDb>, patternId: string): WorkMemorySettingsSummary {
  if (tableExists(db, 'pattern_occurrences')) {
    db.prepare(`DELETE FROM pattern_occurrences WHERE pattern_id = ?`).run(patternId)
  }
  if (tableExists(db, 'context_patterns')) {
    db.prepare(`DELETE FROM context_patterns WHERE id = ?`).run(patternId)
  }
  return getWorkMemorySettingsSummary(db)
}

function forgetAllWorkMemory(db: ReturnType<typeof getDb>): WorkMemorySettingsSummary {
  const tables = ['pattern_occurrences', 'context_patterns', 'user_memory_facts', 'daily_memory_archive']
  for (const table of tables) {
    if (tableExists(db, table)) db.prepare(`DELETE FROM ${table}`).run()
  }
  return getWorkMemorySettingsSummary(db)
}

// ─── Work session payload helpers ────────────────────────────────────────────

function placeholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ')
}

function buildAppNameMap(db: ReturnType<typeof getDb>, bundleIds: string[]): Map<string, string> {
  const uniqueBundleIds = [...new Set(bundleIds.filter(Boolean))]
  const map = new Map<string, string>()
  if (uniqueBundleIds.length === 0) return map

  const inClause = placeholders(uniqueBundleIds)
  const rows = db.prepare(`
    SELECT bundle_id, app_name
    FROM apps
    WHERE bundle_id IN (${inClause})
  `).all(...uniqueBundleIds) as Array<{ bundle_id: string; app_name: string }>
  for (const r of rows) map.set(r.bundle_id, r.app_name)

  const unresolvedBundleIds = uniqueBundleIds.filter((bundleId) => !map.has(bundleId))
  if (unresolvedBundleIds.length > 0) {
    const legacyRows = db.prepare(`
      SELECT bundle_id, app_name
      FROM app_sessions
      WHERE bundle_id IN (${placeholders(unresolvedBundleIds)})
      ORDER BY start_time DESC
    `).all(...unresolvedBundleIds) as Array<{ bundle_id: string; app_name: string }>
    for (const r of legacyRows) {
      if (!map.has(r.bundle_id)) map.set(r.bundle_id, r.app_name)
    }
  }

  return map
}

interface WsRow {
  id: string
  started_at: number
  ended_at: number
  duration_ms: number
  active_ms: number
  idle_ms: number
  client_id: string | null
  project_id: string | null
  attribution_status: string
  attribution_confidence: number | null
  title: string | null
  primary_bundle_id: string | null
  app_bundle_ids_json: string
}

function buildWorkSessionPayloads(db: ReturnType<typeof getDb>, whereClause: string, params: unknown[]): WorkSessionPayload[] {
  const rows = db.prepare(`SELECT * FROM work_sessions ${whereClause}`).all(...params) as WsRow[]
  if (rows.length === 0) return []

  const sessionIds = rows.map((row) => row.id)
  const sessionInClause = placeholders(sessionIds)

  const memberRows = db.prepare(`
    SELECT wss.work_session_id, wss.role, wss.contribution_ms, aseg.primary_bundle_id
    FROM work_session_segments wss
    JOIN activity_segments aseg ON aseg.id = wss.segment_id
    WHERE wss.work_session_id IN (${sessionInClause})
  `).all(...sessionIds) as Array<{
    work_session_id: string
    role: string
    contribution_ms: number
    primary_bundle_id: string
  }>
  const membersBySession = new Map<string, typeof memberRows>()
  for (const member of memberRows) {
    const existing = membersBySession.get(member.work_session_id)
    if (existing) existing.push(member)
    else membersBySession.set(member.work_session_id, [member])
  }

  const appNameMap = buildAppNameMap(db, memberRows.map((row) => row.primary_bundle_id))

  const clientIds = [...new Set(rows.map(r => r.client_id).filter(Boolean))] as string[]
  const projectIds = [...new Set(rows.map(r => r.project_id).filter(Boolean))] as string[]
  const clientMap = new Map<string, { name: string; color: string | null }>()
  const projectMap = new Map<string, string>()

  if (clientIds.length > 0) {
    const clientRows = db.prepare(`
      SELECT id, name, color
      FROM clients
      WHERE id IN (${placeholders(clientIds)})
    `).all(...clientIds) as Array<{ id: string; name: string; color: string | null }>
    for (const row of clientRows) clientMap.set(row.id, { name: row.name, color: row.color })
  }
  if (projectIds.length > 0) {
    const projectRows = db.prepare(`
      SELECT id, name
      FROM projects
      WHERE id IN (${placeholders(projectIds)})
    `).all(...projectIds) as Array<{ id: string; name: string }>
    for (const row of projectRows) projectMap.set(row.id, row.name)
  }

  const evidenceRows = db.prepare(`
    SELECT work_session_id, evidence_type, evidence_value, weight
    FROM work_session_evidence
    WHERE work_session_id IN (${sessionInClause})
    ORDER BY work_session_id ASC, weight DESC
  `).all(...sessionIds) as Array<{
    work_session_id: string
    evidence_type: string
    evidence_value: string
    weight: number
  }>
  const evidenceBySession = new Map<string, typeof evidenceRows>()
  for (const evidence of evidenceRows) {
    const existing = evidenceBySession.get(evidence.work_session_id)
    if (existing) {
      if (existing.length < 10) existing.push(evidence)
    } else {
      evidenceBySession.set(evidence.work_session_id, [evidence])
    }
  }

  return rows.map(ws => {
    const members = membersBySession.get(ws.id) ?? []

    const appMs = new Map<string, { ms: number; role: string }>()
    for (const m of members) {
      const existing = appMs.get(m.primary_bundle_id)
      if (existing) existing.ms += m.contribution_ms
      else appMs.set(m.primary_bundle_id, { ms: m.contribution_ms, role: m.role })
    }
    const apps: WorkSessionApp[] = [...appMs.entries()]
      .sort((a, b) => b[1].ms - a[1].ms)
      .map(([bundleId, { ms, role }]) => ({
        app_name: appNameMap.get(bundleId) ?? bundleId.split('.').pop() ?? bundleId,
        duration_ms: ms,
        role,
      }))
    const evidence = evidenceBySession.get(ws.id) ?? []

    const clientInfo = ws.client_id ? clientMap.get(ws.client_id) : null

    return {
      id: ws.id,
      started_at: ws.started_at,
      ended_at: ws.ended_at,
      duration_ms: ws.duration_ms,
      active_ms: ws.active_ms,
      idle_ms: ws.idle_ms,
      client_id: ws.client_id,
      client_name: clientInfo?.name ?? null,
      client_color: clientInfo?.color ?? null,
      project_id: ws.project_id,
      project_name: ws.project_id ? (projectMap.get(ws.project_id) ?? null) : null,
      attribution_status: ws.attribution_status as 'attributed' | 'ambiguous' | 'unattributed',
      attribution_confidence: ws.attribution_confidence,
      title: ws.title,
      apps,
      evidence: evidence.map(e => ({ type: e.evidence_type, value: e.evidence_value, weight: e.weight })),
    }
  })
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

export function registerDbHandlers(): void {
  // Today's app summaries — uses local calendar day, not UTC day
  ipcMain.handle(IPC.DB.GET_TODAY, () => {
    const [from, to] = dayBounds(localDateString())
    return getAppSummariesForRange(getDb(), from, to)
  })

  // Raw sessions for a given date — used by History and Today timeline
  ipcMain.handle(IPC.DB.GET_HISTORY, (_e, dateStr: string) => {
    const [from, to] = dayBounds(dateStr)
    return mergeLiveSessionForDate(getSessionsForRange(getDb(), from, to), dateStr)
  })

  ipcMain.handle(IPC.DB.GET_HISTORY_DAY, (_e, dateStr: string) => {
    return getHistoryDayProjection(getDb(), dateStr, getLiveSessionForDate(dateStr), { materialize: false })
  })

  ipcMain.handle(IPC.DB.GET_TIMELINE_DAY, (_e, dateStr: string) => {
    const payload = getTimelineDayProjection(getDb(), dateStr, getLiveSessionForDate(dateStr), { materialize: false })
    scheduleTimelineAIJobs(payload)
    return payload
  })

  ipcMain.handle(IPC.DB.REBUILD_TIMELINE_DAY, async (_e, dateStr: string) => {
    // "Rebuild" is intentionally no longer a destructive block wipe. Days
    // already self-heal on open; the useful manual action is to spend AI work
    // only where the day is still on a deterministic floor or low-confidence
    // label, preserving curated AI labels and user overrides.
    const db = getDb()
    const payload = materializeTimelineDayProjection(db, dateStr, getLiveSessionForDate(dateStr))
    let changed = false
    let attempted = 0
    const failures: string[] = []

    for (const block of payload.blocks) {
      if (!shouldReanalyzeBlockWithAI(block)) continue
      attempted++
      try {
        const insight = await generateWorkBlockInsight(
          { ...block, label: { ...block.label, override: null } },
          { jobType: 'block_cleanup_relabel', triggerSource: 'system', throwOnError: true },
        )
        changed = applyAIInsightToTimelineBlock(db, block, insight) || changed
      } catch (error) {
        console.warn(`[timeline] AI re-analysis failed for block ${block.id}:`, error)
        failures.push(error instanceof Error ? error.message : String(error))
      }
    }

    if (attempted > 0 && !changed && failures.length > 0) {
      throw new Error(`AI re-analysis failed: ${failures[0]}`)
    }

    if (changed) {
      invalidateProjectionScope('timeline', 'timeline-ai-reanalysis')
      invalidateProjectionScope('apps', 'timeline-ai-reanalysis')
      invalidateProjectionScope('insights', 'timeline-ai-reanalysis')
    }

    const refreshed = materializeTimelineDayProjection(db, dateStr, getLiveSessionForDate(dateStr))
    scheduleTimelineAIJobs(refreshed)
    return refreshed
  })

  ipcMain.handle(IPC.DB.GET_RECAP_RANGE, (_e, dates: string[]) => {
    return getRecapRange(getDb(), dates)
  })

  // App usage summaries for a range — used by Apps view
  // days=1 → today since local midnight (not rolling 24h)
  // days=7/30 → rolling window ending at end of today
  ipcMain.handle(IPC.DB.GET_APP_SUMMARIES, (_e, days: number = 7) => {
    const [todayFrom, todayTo] = dayBounds(localDateString())
    if (days <= 1) {
      return getAppSummariesForRange(getDb(), todayFrom, todayTo)
    }
    return getCachedRangeAppSummaries(days)
  })

  // C23 / D6: Apps view date switcher. Returns summaries for a specific
  // calendar day. Today is raw foreground totals; past days are equivalent.
  ipcMain.handle(IPC.DB.GET_APP_SUMMARIES_FOR_DATE, (_e, dateStr: string) => {
    if (dateStr !== localDateString()) {
      const derived = readDerivedAppSummariesForDate(getDb(), dateStr)
      if (derived) return derived
    }
    const [from, to] = dayBounds(dateStr)
    return getAppSummariesForRange(getDb(), from, to)
  })

  ipcMain.handle(IPC.DB.SET_CATEGORY_OVERRIDE, (_e, bundleId: string, category: string) => {
    setCategoryOverride(getDb(), bundleId, category as import('@shared/types').AppCategory)
    invalidateProjectionScope('timeline', 'category_override')
    invalidateProjectionScope('apps', 'category_override')
    invalidateProjectionScope('insights', 'category_override')
  })

  ipcMain.handle(IPC.DB.CLEAR_CATEGORY_OVERRIDE, (_e, bundleId: string) => {
    clearCategoryOverride(getDb(), bundleId)
    invalidateProjectionScope('timeline', 'category_override')
    invalidateProjectionScope('apps', 'category_override')
    invalidateProjectionScope('insights', 'category_override')
  })

  ipcMain.handle(IPC.DB.GET_CATEGORY_OVERRIDES, () => {
    return getCategoryOverrides(getDb())
  })

  // Per-app session drill-down — used by Apps detail panel
  ipcMain.handle(IPC.DB.GET_APP_SESSIONS, (_e, bundleId: string, days: number = 7) => {
    const [todayFrom, todayTo] = dayBounds(localDateString())
    if (days <= 1) return getSessionsForApp(getDb(), bundleId, todayFrom, todayTo)
    const from = todayFrom - (days - 1) * 86_400_000
    return getSessionsForApp(getDb(), bundleId, from, todayTo)
  })

  // Website summaries — used by Today's Top Websites card
  ipcMain.handle(IPC.DB.GET_WEBSITE_SUMMARIES, (_e, days: number = 1) => {
    const [todayFrom, todayTo] = dayBounds(localDateString())
    if (days <= 1) return getWebsiteSummariesForRange(getDb(), todayFrom, todayTo)
    const from = todayFrom - (days - 1) * 86_400_000
    return getWebsiteSummariesForRange(getDb(), from, todayTo)
  })

  ipcMain.handle(IPC.DB.GET_PEAK_HOURS, () => {
    const now = Date.now()
    const fourteenDaysAgo = now - 14 * 24 * 60 * 60 * 1000
    return getPeakHours(getDb(), fourteenDaysAgo, now)
  })

  ipcMain.handle(IPC.DB.GET_WEEKLY_SUMMARY, (_e, endDateStr: string) => {
    return getWeeklySummaryProjection(getDb(), endDateStr)
  })

  ipcMain.handle(IPC.DB.GET_APP_CHARACTER, (_e, bundleId: string, daysBack: number) => {
    return getAppCharacter(getDb(), bundleId, daysBack)
  })

  ipcMain.handle(IPC.DB.GET_APP_DETAIL, (_e, canonicalAppId: string, days: number = 7) => {
    return getAppDetailProjection(getDb(), canonicalAppId, days, getCurrentSession())
  })

  // D5: per-app activity digest used by the Apps list view to lead with what
  // was accomplished in each app, not how long. Walks each day in the range,
  // builds canonical-app → best block label + best artifact title pairs.
  // Artifact/page attribution respects ownership: a page captured in Safari
  // never bleeds onto a non-browser app in the same block, and an artifact
  // with ownerBundleId=VS Code never attaches to Dia.
  ipcMain.handle(IPC.DB.GET_APP_ACTIVITY_DIGEST, (_e, days: number = 1): import('@shared/types').AppActivityDigest[] => {
    const db = getDb()
    const today = localDateString()
    const dayCount = Math.max(1, days)
    const [todayY, todayM, todayD] = today.split('-').map(Number)
    const blocks: import('@shared/types').WorkContextBlock[] = []
    for (let offset = 0; offset < dayCount; offset++) {
      const dt = new Date(todayY, todayM - 1, todayD)
      dt.setDate(dt.getDate() - offset)
      const dateStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
      const payload = getTimelineDayProjection(db, dateStr, getLiveSessionForDate(dateStr), { materialize: false })
      for (const block of payload.blocks) blocks.push(block)
    }
    return computeAppActivityDigest(blocks)
  })

  ipcMain.handle(IPC.DB.GET_WORK_MEMORY_SUMMARY, () => {
    return getWorkMemorySettingsSummary(getDb())
  })

  ipcMain.handle(IPC.DB.FORGET_WORK_MEMORY_PATTERN, (_e, patternId: string) => {
    return forgetWorkMemoryPattern(getDb(), patternId)
  })

  ipcMain.handle(IPC.DB.FORGET_ALL_WORK_MEMORY, () => {
    return forgetAllWorkMemory(getDb())
  })

  ipcMain.handle(IPC.DB.BACKFILL_WORK_MEMORY, () => {
    return backfillMemoryFromHistory(getDb())
  })

  ipcMain.handle(IPC.DB.GET_BLOCK_DETAIL, (_e, blockId: string) => {
    return getBlockDetailPayload(getDb(), blockId, getCurrentSession())
  })

  ipcMain.handle(IPC.DB.GET_WORKFLOW_SUMMARIES, (_e, days: number = 14) => {
    return getWorkflowPatternsProjection(getDb(), days)
  })

  ipcMain.handle(IPC.DB.GET_ARTIFACT_DETAILS, (_e, artifactId: string) => {
    return getArtifactDetailProjection(getDb(), artifactId)
  })

  ipcMain.handle(IPC.DB.SET_BLOCK_LABEL_OVERRIDE, (_e, payload: { blockId: string; date?: string | null; label: string; narrative?: string | null }) => {
    const db = getDb()
    if (payload.date) {
      materializeTimelineDayProjection(db, payload.date, getLiveSessionForDate(payload.date))
    }
    setBlockLabelOverride(db, payload.blockId, payload.label, payload.narrative ?? null)
    invalidateProjectionScope('timeline', 'block_label_override')
    invalidateProjectionScope('apps', 'block_label_override')
    invalidateProjectionScope('insights', 'block_label_override')
  })

  ipcMain.handle(IPC.DB.CLEAR_BLOCK_LABEL_OVERRIDE, (_e, blockId: string) => {
    clearBlockLabelOverride(getDb(), blockId)
    invalidateProjectionScope('timeline', 'block_label_override')
    invalidateProjectionScope('apps', 'block_label_override')
    invalidateProjectionScope('insights', 'block_label_override')
  })

  ipcMain.handle(IPC.DB.GET_DISTRACTION_COST, () => {
    return getDistractionCostPayload(getDb())
  })

  // Returns the current in-flight session (not yet flushed to DB) so the renderer
  // can display live totals without waiting for the next app switch.
  ipcMain.handle(IPC.TRACKING.GET_LIVE, () => getCurrentSession())
  ipcMain.handle(IPC.TRACKING.GET_DIAGNOSTICS, () => ({
    platform: process.platform,
    trackingStatus: { ...trackingStatus },
    linuxTracking: getLinuxTrackingDiagnostics(),
    linuxDesktop: getLinuxDesktopDiagnostics(),
  }))
  ipcMain.handle(IPC.TRACKING.GET_PERMISSION_STATE, () => getTrackingPermissionState())
  ipcMain.handle(IPC.TRACKING.REQUEST_SCREEN_PERMISSION, async () => requestScreenTrackingPermission())

  ipcMain.handle(IPC.TRACKING.GET_PROCESS_METRICS, () => {
    return getProcessMetrics()
  })

  // ─── Attribution query resolvers ──────────────────────────────────────────
  ipcMain.handle(IPC.ATTRIBUTION.GET_CLIENT_QUERY, (
    _e, clientId: string, fromMs: number, toMs: number, question: string,
  ) => {
    return resolveClientQuery(clientId, fromMs, toMs, question, getDb())
  })

  ipcMain.handle(IPC.ATTRIBUTION.GET_DAY_CONTEXT, (_e, dateStr: string) => {
    return resolveDayContext(dateStr, getDb())
  })

  ipcMain.handle(IPC.ATTRIBUTION.FIND_CLIENT, (_e, name: string) => {
    return findClientByName(name, getDb())
  })

  ipcMain.handle(IPC.ATTRIBUTION.LIST_CLIENTS, () => {
    return listClients(getDb())
  })

  ipcMain.handle(IPC.ATTRIBUTION.LIST_CLIENTS_DETAILED, (): ClientRecord[] => {
    return listClientsDetailed(getDb())
  })

  ipcMain.handle(IPC.ATTRIBUTION.CREATE_CLIENT, (_e, payload: { name: string; color?: string | null }): ClientRecord => {
    return createClient(payload, getDb())
  })

  ipcMain.handle(IPC.ATTRIBUTION.UPDATE_CLIENT, (_e, payload: { id: string; name?: string; color?: string | null }): ClientRecord | null => {
    return updateClient(payload, getDb())
  })

  ipcMain.handle(IPC.ATTRIBUTION.ARCHIVE_CLIENT, (_e, id: string): boolean => {
    const ok = archiveClient(id, getDb())
    if (ok) {
      invalidateProjectionScope('timeline', 'client_archived')
      invalidateProjectionScope('apps', 'client_archived')
      invalidateProjectionScope('insights', 'client_archived')
    }
    return ok
  })

  ipcMain.handle(IPC.ATTRIBUTION.RESTORE_CLIENT, (_e, id: string): boolean => {
    const ok = restoreClient(id, getDb())
    if (ok) {
      invalidateProjectionScope('timeline', 'client_restored')
      invalidateProjectionScope('apps', 'client_restored')
      invalidateProjectionScope('insights', 'client_restored')
    }
    return ok
  })

  ipcMain.handle(IPC.ATTRIBUTION.RUN_FOR_RANGE, (_e, fromMs: number, toMs: number) => {
    return runAttributionForRange(fromMs, toMs, {}, getDb())
  })

  // ─── New attribution data handlers for renderer views ────────────────────

  ipcMain.handle(IPC.ATTRIBUTION.GET_CLIENT_DETAIL, (_e, clientId: string, fromDate: string, toDate: string): ClientDetailPayload | null => {
    const db = getDb()
    const client = db.prepare(`SELECT id, name, color, status FROM clients WHERE id = ?`).get(clientId) as { id: string; name: string; color: string | null; status: string } | undefined
    if (!client) return null

    const projectCount = (db.prepare(`SELECT COUNT(*) AS cnt FROM projects WHERE client_id = ? AND status = 'active'`).get(clientId) as { cnt: number }).cnt
    const projects = db.prepare(`SELECT id, client_id, name, color FROM projects WHERE client_id = ? AND status = 'active' ORDER BY name`).all(clientId) as ProjectSummary[]

    const rollupSummary = getRollupSummary(clientId, fromDate, toDate, db)

    // Get day bounds
    const [fy, fm, fd] = fromDate.split('-').map(Number)
    const [ty, tm, td] = toDate.split('-').map(Number)
    const fromMs = new Date(fy, fm - 1, fd).getTime()
    const toMs = new Date(ty, tm - 1, td, 23, 59, 59, 999).getTime()

    const sessions = buildWorkSessionPayloads(db, `WHERE client_id = ? AND started_at >= ? AND started_at <= ? ORDER BY started_at DESC`, [clientId, fromMs, toMs])
    const ambiguousSessions = buildWorkSessionPayloads(db, `WHERE attribution_status = 'ambiguous' AND started_at >= ? AND started_at <= ? AND id IN (
      SELECT DISTINCT wss.work_session_id FROM work_session_segments wss
      JOIN segment_attributions sa ON sa.segment_id = wss.segment_id
      WHERE sa.client_id = ? AND sa.confidence > 0.3
    ) ORDER BY started_at DESC`, [fromMs, toMs, clientId])

    return {
      client: { ...client, projectCount },
      projects,
      rollups: rollupSummary.by_day,
      sessions,
      ambiguous_sessions: ambiguousSessions,
    }
  })

  ipcMain.handle(IPC.ATTRIBUTION.GET_WORK_SESSIONS_FOR_DAY, (_e, dateStr: string): DayWorkSessionsPayload => {
    const db = getDb()
    const [y, m, d] = dateStr.split('-').map(Number)
    const fromMs = new Date(y, m - 1, d).getTime()
    const toMs = fromMs + 86_400_000

    const sessions = buildWorkSessionPayloads(db, `WHERE started_at >= ? AND started_at < ? ORDER BY started_at ASC`, [fromMs, toMs])

    // Merge live session if applicable
    const live = getCurrentSession()
    const liveEnd = Date.now()
    const liveSessions: TimelineWorkSession[] = sessions.map(s => ({ ...s }))

    if (live && liveEnd > fromMs && live.startTime < toMs) {
      // Check if live session overlaps any existing session
      const hasLive = sessions.some(s => s.started_at === live.startTime)
      if (!hasLive) {
        liveSessions.push({
          id: '__live__',
          started_at: Math.max(live.startTime, fromMs),
          ended_at: liveEnd,
          duration_ms: liveEnd - Math.max(live.startTime, fromMs),
          active_ms: liveEnd - Math.max(live.startTime, fromMs),
          idle_ms: 0,
          client_id: null,
          client_name: null,
          client_color: null,
          project_id: null,
          project_name: null,
          attribution_status: 'unattributed',
          attribution_confidence: null,
          title: live.appName,
          apps: [{ app_name: live.appName, duration_ms: liveEnd - Math.max(live.startTime, fromMs), role: 'primary' }],
          evidence: [],
          is_live: true,
        })
        liveSessions.sort((a, b) => a.started_at - b.started_at)
      }
    }

    let attributed = 0, ambiguous = 0, unattributed = 0
    for (const s of liveSessions) {
      if (s.attribution_status === 'attributed') attributed += s.active_ms
      else if (s.attribution_status === 'ambiguous') ambiguous += s.active_ms
      else unattributed += s.active_ms
    }

    return {
      date: dateStr,
      sessions: liveSessions,
      total_attributed_ms: attributed,
      total_ambiguous_ms: ambiguous,
      total_unattributed_ms: unattributed,
    }
  })

  ipcMain.handle(IPC.ATTRIBUTION.GET_WORK_SESSION_SEGMENTS, (_e, sessionId: string): ActivitySegmentPayload[] => {
    const db = getDb()
    const rows = db.prepare(`
      SELECT as2.id, as2.started_at, as2.ended_at, as2.duration_ms, as2.primary_bundle_id, as2.class
      FROM activity_segments as2
      JOIN work_session_segments wss ON wss.segment_id = as2.id
      WHERE wss.work_session_id = ?
      ORDER BY as2.started_at ASC
    `).all(sessionId) as Array<{ id: string; started_at: number; ended_at: number; duration_ms: number; primary_bundle_id: string; class: string }>

    const appNameMap = buildAppNameMap(db, rows.map((row) => row.primary_bundle_id))
    return rows.map(r => ({
      id: r.id,
      started_at: r.started_at,
      ended_at: r.ended_at,
      duration_ms: r.duration_ms,
      primary_app_name: appNameMap.get(r.primary_bundle_id) ?? r.primary_bundle_id.split('.').pop() ?? r.primary_bundle_id,
      class: r.class,
    }))
  })

  ipcMain.handle(IPC.ATTRIBUTION.GET_ROLLUPS, (_e, clientId: string | null, fromDate: string, toDate: string): RollupEntry[] => {
    const summary = getRollupSummary(clientId, fromDate, toDate, getDb())
    return summary.by_day
  })

  ipcMain.handle(IPC.ATTRIBUTION.GET_APP_WORK_SESSIONS, (_e, bundleId: string, days: number = 7): WorkSessionPayload[] => {
    const db = getDb()
    const [todayFrom, todayTo] = dayBounds(localDateString())
    const fromMs = days <= 1 ? todayFrom : todayFrom - (days - 1) * 86_400_000
    const toMs = todayTo

    // Find work sessions where this app was used (via work_session_segments → activity_segments)
    return buildWorkSessionPayloads(db, `WHERE id IN (
      SELECT DISTINCT wss.work_session_id FROM work_session_segments wss
      JOIN activity_segments aseg ON aseg.id = wss.segment_id
      WHERE aseg.primary_bundle_id = ?
    ) AND started_at >= ? AND started_at < ? ORDER BY started_at DESC LIMIT 50`, [bundleId, fromMs, toMs])
  })

  // Supports two call shapes:
  //   reassign-session(sessionId, clientId, projectId)                    // legacy
  //   reassign-session(sessionId, { clientId?, clientName?, projectId? }) // new
  // When `clientName` is provided without `clientId`, a matching client is created (or reused) before reassigning.
  ipcMain.handle(IPC.ATTRIBUTION.REASSIGN_SESSION, (
    _e,
    sessionId: string,
    secondArg: string | null | { clientId?: string | null; clientName?: string | null; projectId?: string | null },
    thirdArg?: string | null,
  ): { clientId: string | null; projectId: string | null } => {
    const db = getDb()

    let clientId: string | null = null
    let projectId: string | null = null
    if (typeof secondArg === 'object' && secondArg !== null) {
      clientId = secondArg.clientId ?? null
      projectId = secondArg.projectId ?? null
      if (!clientId && secondArg.clientName && secondArg.clientName.trim()) {
        const created = getOrCreateClientByName(secondArg.clientName.trim(), db)
        clientId = created.id
      }
    } else {
      clientId = secondArg ?? null
      projectId = thirdArg ?? null
    }

    db.prepare(`UPDATE work_sessions SET client_id = ?, project_id = ?, attribution_status = CASE WHEN ? IS NOT NULL THEN 'attributed' ELSE 'unattributed' END, attribution_confidence = CASE WHEN ? IS NOT NULL THEN 1.0 ELSE NULL END, updated_at = ? WHERE id = ?`)
      .run(clientId, projectId, clientId, clientId, Date.now(), sessionId)
    // Update segment attributions to reflect user decision
    const segmentIds = db.prepare(`SELECT segment_id FROM work_session_segments WHERE work_session_id = ?`).all(sessionId) as Array<{ segment_id: string }>
    for (const { segment_id } of segmentIds) {
      db.prepare(`UPDATE segment_attributions SET client_id = ?, project_id = ?, decision_source = 'user', confidence = 1.0 WHERE segment_id = ? AND rank = 1`)
        .run(clientId, projectId, segment_id)
    }
    invalidateProjectionScope('timeline', 'session_reassigned')
    invalidateProjectionScope('apps', 'session_reassigned')
    invalidateProjectionScope('insights', 'session_reassigned')
    return { clientId, projectId }
  })

  // Reassign every work_session overlapping a time range to a client (and
  // optionally a project). Either `clientId` or `clientName` may be given;
  // a name without a matching client auto-creates one.
  ipcMain.handle(IPC.ATTRIBUTION.REASSIGN_RANGE, (
    _e,
    payload: { fromMs: number; toMs: number; clientId?: string | null; clientName?: string | null; projectId?: string | null },
  ): { clientId: string | null; projectId: string | null; sessionsUpdated: number } => {
    const db = getDb()
    let clientId: string | null = payload.clientId ?? null
    const projectId: string | null = payload.projectId ?? null
    if (!clientId && payload.clientName && payload.clientName.trim()) {
      const created = getOrCreateClientByName(payload.clientName.trim(), db)
      clientId = created.id
    }

    // Pick any session that overlaps the range (started before toMs, ended after fromMs).
    const sessions = db.prepare(`
      SELECT id FROM work_sessions
      WHERE started_at < ? AND ended_at > ?
    `).all(payload.toMs, payload.fromMs) as Array<{ id: string }>

    const now = Date.now()
    const tx = db.transaction(() => {
      for (const { id } of sessions) {
        db.prepare(`UPDATE work_sessions SET client_id = ?, project_id = ?, attribution_status = CASE WHEN ? IS NOT NULL THEN 'attributed' ELSE 'unattributed' END, attribution_confidence = CASE WHEN ? IS NOT NULL THEN 1.0 ELSE NULL END, updated_at = ? WHERE id = ?`)
          .run(clientId, projectId, clientId, clientId, now, id)
        const segmentIds = db.prepare(`SELECT segment_id FROM work_session_segments WHERE work_session_id = ?`).all(id) as Array<{ segment_id: string }>
        for (const { segment_id } of segmentIds) {
          db.prepare(`UPDATE segment_attributions SET client_id = ?, project_id = ?, decision_source = 'user', confidence = 1.0 WHERE segment_id = ? AND rank = 1`)
            .run(clientId, projectId, segment_id)
        }
      }
    })
    tx()

    invalidateProjectionScope('timeline', 'session_reassigned')
    invalidateProjectionScope('apps', 'session_reassigned')
    invalidateProjectionScope('insights', 'session_reassigned')
    return { clientId, projectId, sessionsUpdated: sessions.length }
  })

  ipcMain.handle(IPC.ICONS.RESOLVE, async (_e, payload: IconRequest) => {
    return resolveIcon(payload)
  })
}

function getLiveSessionForDate(dateStr: string) {
  const live = getCurrentSession()
  if (!live) return null

  const [from, to] = dayBounds(dateStr)
  const liveEnd = Date.now()
  if (liveEnd <= from || live.startTime >= to) return null
  return live
}

function mergeLiveSessionForDate(sessions: AppSession[], dateStr: string): AppSession[] {
  const live = getLiveSessionForDate(dateStr)
  if (!live) return sessions

  const endTime = Date.now()
  return [
    ...sessions,
    {
      id: -1,
      bundleId: live.bundleId,
      appName: live.appName,
      startTime: live.startTime,
      endTime,
      durationSeconds: Math.max(1, Math.round((endTime - live.startTime) / 1000)),
      category: live.category,
      isFocused: FOCUSED_CATEGORIES.includes(live.category),
    },
  ].sort((left, right) => left.startTime - right.startTime)
}

function applyAIInsightToTimelineBlock(
  db: ReturnType<typeof getDb>,
  block: WorkContextBlock,
  insight: WorkContextInsight,
): boolean {
  // Day-level cleanup preserves user overrides (force = false).
  const label = insight.label?.trim()
  if (!label) {
    throw new Error(`AI did not return a label for block ${block.id}.`)
  }
  const wrote = writeAIBlockLabel(db, {
    blockId: block.id,
    label,
    narrative: insight.narrative ?? null,
  })
  if (!wrote) {
    // A user can rename the block while the AI request is in flight. That race
    // is a valid preserve-override no-op, not an AI persistence failure.
    if (getBlockLabelOverride(db, block.id)?.label.trim()) return false
    throw new Error(`AI label could not be persisted for block ${block.id}.`)
  }
  return true
}
