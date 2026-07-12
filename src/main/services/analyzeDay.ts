// One shared "analyze a day" pipeline: AI regroup (merge same-intent
// neighbours) → per-block AI relabel. Both the manual "Analyze" IPC action and
// the automatic day-rollover / startup finalization call THIS function, so
// invariant 3 ("same-intent neighbours merge into one block") is enforced the
// same way whether or not the user clicked a button.
//
// The engine over-splits a real day (a browser switch, a category change starts
// a new heuristic block), so the regroup can only ever make the day FEWER,
// truer blocks. The merge itself rides the durable boundary-correction path
// (timeline_boundary_corrections), so it survives every future rebuild
// (invariant 8). User corrections always win: a user-renamed block is never
// merged away. If the AI provider is unavailable or rate-limited, the regroup
// and relabel fall back cleanly to the heuristic blocks — nothing throws in the
// automatic path.
import type Database from 'better-sqlite3'
import type { LiveSession, WorkContextBlock, WorkContextInsight, DayTimelinePayload } from '@shared/types'
import { materializeTimelineDayProjection } from '../core/query/projections'
import { invalidateProjectionScope } from '../core/projections/invalidation'
import { mergeTimelineEpisodes, shouldReanalyzeBlockWithAI, writeTimelineBlockReview } from './workBlocks'
import { getBlockLabelOverride, setBlockLabelOverride, writeAIBlockLabel } from '../db/queries'
import { generateWorkBlockInsight, generateDayRegroupPlan } from './ai'
import { absenceSpannedBy, formatAbsenceRange, partitionAtRealAbsences } from '../lib/absenceGuard'

export type BlockInsightTrigger = 'user' | 'background' | 'system'

export interface AnalyzeTimelineDayDeps {
  // A freeform note about what the user actually did (from the wrap flow / the
  // manual Analyze hint). Passed to the model as a strong grounding signal.
  userHint?: string
  // How the day resolves its live session. Past days (the automatic finalize
  // path) have none; the manual path passes the handler's resolver.
  resolveLiveSession?: (dateStr: string) => LiveSession | null
  // Which invocation source to record for the relabel jobs. Manual clicks are
  // 'user'; the automatic finalize path is 'background'.
  triggerSource?: BlockInsightTrigger
  // Whether a total relabel failure should throw (so the manual "Analyze" UI
  // can show an error). The automatic finalize path sets this false: a provider
  // outage there must fall back cleanly to the heuristic blocks, never throw
  // into the scheduler. Default true (manual behaviour).
  surfaceErrors?: boolean
  // Injectable AI calls — real by default, mocked in tests so the suite never
  // reaches a provider.
  regroupPlan?: (
    blocks: WorkContextBlock[],
    opts: { userHint?: string },
  ) => Promise<number[][] | null | undefined>
  blockInsight?: (
    block: WorkContextBlock,
    opts: { jobType: 'block_cleanup_relabel'; triggerSource: BlockInsightTrigger; throwOnError: boolean; userHint?: string },
  ) => Promise<WorkContextInsight>
}

export interface AnalyzeTimelineDayResult {
  payload: DayTimelinePayload
  changed: boolean
  merged: boolean
  attempted: number
  failures: string[]
}

// Persist an AI label+narrative to a block, preserving user overrides.
function applyAIInsightToTimelineBlock(
  db: Database.Database,
  block: WorkContextBlock,
  insight: WorkContextInsight,
): boolean {
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

export async function analyzeTimelineDay(
  db: Database.Database,
  dateStr: string,
  deps: AnalyzeTimelineDayDeps = {},
): Promise<AnalyzeTimelineDayResult> {
  const userHint = deps.userHint?.trim() || undefined
  const resolveLiveSession = deps.resolveLiveSession ?? (() => null)
  const triggerSource = deps.triggerSource ?? 'user'
  const regroupPlan = deps.regroupPlan ?? ((blocks, opts) => generateDayRegroupPlan(blocks, opts))
  const blockInsight = deps.blockInsight ?? ((block, opts) => generateWorkBlockInsight(block, opts))

  const materialize = (): DayTimelinePayload =>
    materializeTimelineDayProjection(db, dateStr, resolveLiveSession(dateStr))

  let payload = materialize()
  let changed = false
  let merged = false
  let attempted = 0
  const failures: string[] = []

  // REPAIR (v2-ship-plan W1-A): a day stored before the absence guard existed
  // can contain a block that spans a real absence of 15+ minutes — on July 10
  // a 3:49 PM–10:05 PM block sat over an 8:01–9:39 PM absence. Detect any such
  // block and force the day to rebuild from its sessions: the pipeline now
  // refuses to join across the gap (scoreBoundary treats a real absence as a
  // hard cut that outranks every stored merge correction), so the block splits
  // exactly at the absence. User corrections survive the rebuild — label
  // overrides and reviews re-attach by evidence key, AI names carry forward
  // inside persistTimelineDay, and cuts/valid merges replay from their durable
  // stores. This runs in the normal re-analyze flow (the Analyze button /
  // REBUILD_TIMELINE_DAY), so repairing a bad day is one click, never a
  // direct edit of anyone's database.
  const spanningAbsence = payload.blocks.filter((block) =>
    !block.isLive
    && !block.provisional
    && block.sessions.length > 1
    && absenceSpannedBy(block.sessions) !== null)
  if (spanningAbsence.length > 0) {
    const splitCorrections = spanningAbsence
      .filter((block) => block.review.state === 'corrected')
      .map((block) => ({
        block,
        label: block.review.correctedLabel,
        intentRole: block.review.correctedIntentRole,
        intentSubject: block.review.correctedIntentSubject,
        category: block.review.correctedCategory,
      }))
    for (const block of spanningAbsence) {
      const gap = absenceSpannedBy(block.sessions)
      console.warn(
        `[timeline] repairing ${dateStr}: block "${block.label.current}" spans a real absence `
        + `(${gap ? formatAbsenceRange(gap) : 'unknown'}) — splitting at the gap`,
      )
    }
    payload = materializeTimelineDayProjection(db, dateStr, resolveLiveSession(dateStr), { forceRebuild: true })
    // A fused block's evidence key necessarily changes when the absence guard
    // splits its session set. Preserve the user's intent deterministically on
    // the rebuilt half with the greatest time overlap (earlier half wins a
    // tie). Copying it to every half would turn one correction into a claim
    // that disconnected stretches were necessarily the same work.
    for (const correction of splitCorrections) {
      const target = payload.blocks
        .filter((block) => !block.isLive && block.startTime < correction.block.endTime && block.endTime > correction.block.startTime)
        .sort((left, right) => {
          const leftOverlap = Math.min(left.endTime, correction.block.endTime) - Math.max(left.startTime, correction.block.startTime)
          const rightOverlap = Math.min(right.endTime, correction.block.endTime) - Math.max(right.startTime, correction.block.startTime)
          return rightOverlap - leftOverlap || left.startTime - right.startTime
        })[0]
      if (!target) continue
      writeTimelineBlockReview(db, dateStr, target, {
        state: 'corrected',
        correctedLabel: correction.label,
        correctedIntentRole: correction.intentRole,
        correctedIntentSubject: correction.intentSubject,
        correctedCategory: correction.category,
      })
      if (correction.label?.trim()) setBlockLabelOverride(db, target.id, correction.label, null)
    }
    if (splitCorrections.length > 0) payload = materialize()
    invalidateProjectionScope('timeline', 'absence-repair')
    invalidateProjectionScope('apps', 'absence-repair')
    invalidateProjectionScope('insights', 'absence-repair')
    changed = true
  }

  // AI-driven regroup (timeline.md §3.3 / §5): decide which adjacent heuristic
  // blocks are the same continued intent and should become one. The AI decides
  // only the grouping; the merge rides the durable boundary-correction path so
  // it survives every rebuild. Only blocks with persisted sessions can be
  // merged (a live/in-flight episode has nothing to anchor a correction on).
  const mergeable = payload.blocks.filter(
    (block) => !block.isLive && !block.provisional && block.sessions.some((session) => session.id >= 0),
  )
  if (mergeable.length >= 2) {
    try {
      const groups = await regroupPlan(mergeable, { userHint })
      let mergedAny = false
      for (const group of groups ?? []) {
        if (group.length < 2) continue
        const members = group.map((index) => mergeable[index]).filter(Boolean)
        if (members.length < 2) continue
        // A user-renamed block is never merged away.
        if (members.some((member) => getBlockLabelOverride(db, member.id)?.label?.trim())) continue
        if (members.some((member) => member.isLive || !member.sessions.some((session) => session.id >= 0))) continue
        // The absence guard vetoes any AI-proposed group that spans a real
        // absence of 15+ minutes (the AI proposes, the guard decides). The
        // contiguous runs on each side of the gap keep the AI's grouping
        // intent and still merge among themselves; mergeTimelineEpisodes
        // enforces the same veto again at the write, as the last line of
        // defense for every caller.
        for (const run of partitionAtRealAbsences(members, (member) => member.sessions)) {
          if (run.length < 2) continue
          try {
            mergeTimelineEpisodes(db, dateStr, run)
            mergedAny = true
          } catch (error) {
            console.warn('[timeline] AI merge skipped for a group:', error)
          }
        }
      }
      if (mergedAny) {
        invalidateProjectionScope('timeline', 'timeline-ai-regroup')
        invalidateProjectionScope('apps', 'timeline-ai-regroup')
        invalidateProjectionScope('insights', 'timeline-ai-regroup')
        payload = materialize()
        changed = true
        merged = true
      }
    } catch (error) {
      console.warn('[timeline] AI day regroup failed:', error)
    }
  }

  for (const block of payload.blocks) {
    if (!shouldReanalyzeBlockWithAI(block)) continue
    attempted++
    try {
      const insight = await blockInsight(
        { ...block, label: { ...block.label, override: null } },
        { jobType: 'block_cleanup_relabel', triggerSource, throwOnError: true, userHint },
      )
      changed = applyAIInsightToTimelineBlock(db, block, insight) || changed
    } catch (error) {
      console.warn(`[timeline] AI re-analysis failed for block ${block.id}:`, error)
      failures.push(error instanceof Error ? error.message : String(error))
    }
  }

  if ((deps.surfaceErrors ?? true) && attempted > 0 && !changed && failures.length > 0) {
    throw new Error(`AI re-analysis failed: ${failures[0]}`)
  }

  if (changed) {
    invalidateProjectionScope('timeline', 'timeline-ai-reanalysis')
    invalidateProjectionScope('apps', 'timeline-ai-reanalysis')
    invalidateProjectionScope('insights', 'timeline-ai-reanalysis')
  }

  const refreshed = materialize()
  return { payload: refreshed, changed, merged, attempted, failures }
}
