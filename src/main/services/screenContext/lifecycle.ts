// Screen-context experiment (DEV-197) — the lifecycle orchestrator.
//
//   captured → extracting → indexed → safe_to_delete → deleted
//                       ↘ failed → quarantined → extracting
//
// The invariants, in one place:
//   - privacy gates and rate limits apply BEFORE capture, never after;
//   - a raw file is deleted only after the derived-evidence transaction
//     committed, or on the person's explicit deletion;
//   - failures quarantine with bounded retries inside the raw safety window,
//     then wait, visible, for an explicit Retry or Delete;
//   - the raw backlog is capped; reaching the cap pauses sampling and says so;
//   - deleting a frame, source, period, or everything removes raw AND derived
//     records; the ledger keeps only that a frame existed and is gone;
//   - measurements never carry content: every emitted property is drawn from
//     a closed enum/bucket vocabulary, enforced structurally here.
//
// The OS screen APIs and the extraction model are NOT imported — they arrive
// as injected adapters, so this whole file is provable in the terminal
// harness with a fake frame source and a deterministic extractor.

import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import {
  RAW_BACKLOG_STATES,
  SCREEN_CONTEXT_POLICY,
  type CapturedFrameInput,
  type FrameFileStore,
  type ScreenCaptureGateContext,
  type ScreenEvidenceRecord,
  type ScreenFrameExtractor,
  type ScreenFrameRecord,
  type ScreenSamplingEnvironment,
} from './types'
import {
  createSamplingSchedulerState,
  evaluateCaptureGate,
  evaluateSamplingSchedule,
  noteContextChange,
  recordCapture,
  type SamplingSchedulerState,
} from './scheduler'
import {
  commitExtractionResult,
  deleteEvidenceRows,
  getBacklogTotals,
  getEvidenceForFrame,
  getFrameRecord,
  insertFrameRecord,
  listAllEvidence,
  listAllFrames,
  listFramesForSource,
  listFramesInPeriod,
  listFramesInState,
  transitionFrameState,
} from './repository'

// ─── Measurement contract ─────────────────────────────────────────────────────
// Closed vocabulary only. No image, OCR text, title, URL, domain, application
// name, filename, person, project, client, evidence id, or exact activity
// timestamp may ever appear — enforced by construction: only these keys, with
// enum/bucket/boolean/count values, can leave this module.

export type ScreenContextMeasureEvent =
  | 'screen_context_consent'
  | 'screen_context_capture'
  | 'screen_context_extraction'
  | 'screen_context_backlog'

export interface ScreenContextMeasureProps {
  action?: 'enabled' | 'paused' | 'resumed' | 'revoked'
  outcome?: 'attempted' | 'blocked' | 'succeeded' | 'failed' | 'retried' | 'quarantined'
  blocked_reason?: string
  trigger?: string
  latency_bucket?: string
  byte_bucket?: string
  backlog_bucket?: string
  retry_count?: number
  added_new_fact?: boolean
}

const MEASURE_KEYS: ReadonlySet<keyof ScreenContextMeasureProps> = new Set([
  'action', 'outcome', 'blocked_reason', 'trigger',
  'latency_bucket', 'byte_bucket', 'backlog_bucket',
  'retry_count', 'added_new_fact',
])

export type ScreenContextMeasure = (
  event: ScreenContextMeasureEvent,
  props: ScreenContextMeasureProps,
) => void

function latencyBucket(ms: number): string {
  if (ms < 1_000) return '<1s'
  if (ms < 5_000) return '1-5s'
  if (ms < 15_000) return '5-15s'
  if (ms < 60_000) return '15-60s'
  return '>60s'
}

function byteBucket(bytes: number): string {
  if (bytes < 256 * 1024) return '<256KB'
  if (bytes < 1024 * 1024) return '256KB-1MB'
  if (bytes < 4 * 1024 * 1024) return '1-4MB'
  return '>4MB'
}

function backlogBucket(frames: number): string {
  if (frames === 0) return '0'
  if (frames <= 10) return '1-10'
  if (frames <= 50) return '11-50'
  if (frames < 100) return '51-99'
  return 'at_cap'
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

export type ScreenContextNotice = 'backlog_cap_reached' | 'quarantine_needs_attention'

export interface ScreenContextLifecycleDeps {
  db: Database.Database
  frameStore: FrameFileStore
  extractor: ScreenFrameExtractor
  /** Injectable clock so retries, safety windows, and rate limits are testable. */
  now?: () => number
  /** Tester-facing notices (backlog cap, quarantine waiting) — UI hook. */
  notify?: (notice: ScreenContextNotice) => void
  /** Measurement sink (PostHog in production, an assertion buffer in tests). */
  measure?: ScreenContextMeasure
  exclusionPolicyVersion?: number
}

export interface CaptureAttemptResult {
  captured: boolean
  reason: string | null
  frame: ScreenFrameRecord | null
}

export class ScreenContextLifecycle {
  private readonly db: Database.Database
  private readonly frameStore: FrameFileStore
  private readonly extractor: ScreenFrameExtractor
  private readonly now: () => number
  private readonly notify: (notice: ScreenContextNotice) => void
  private readonly measureSink: ScreenContextMeasure
  private readonly exclusionPolicyVersion: number
  readonly scheduler: SamplingSchedulerState
  /** Set when the backlog cap paused sampling; cleared as the backlog drains. */
  private backlogPaused = false

  constructor(deps: ScreenContextLifecycleDeps) {
    this.db = deps.db
    this.frameStore = deps.frameStore
    this.extractor = deps.extractor
    this.now = deps.now ?? (() => Date.now())
    this.notify = deps.notify ?? (() => {})
    this.measureSink = deps.measure ?? (() => {})
    this.exclusionPolicyVersion = deps.exclusionPolicyVersion ?? 1
    this.scheduler = createSamplingSchedulerState()
  }

  private measure(event: ScreenContextMeasureEvent, props: ScreenContextMeasureProps): void {
    const clean: ScreenContextMeasureProps = {}
    for (const [key, value] of Object.entries(props) as Array<[keyof ScreenContextMeasureProps, never]>) {
      if (MEASURE_KEYS.has(key) && value !== undefined) clean[key] = value
    }
    this.measureSink(event, clean)
  }

  backlogCapReached(): boolean {
    const totals = getBacklogTotals(this.db)
    return (
      totals.frames >= SCREEN_CONTEXT_POLICY.MAX_BACKLOG_FRAMES
      || totals.bytes >= SCREEN_CONTEXT_POLICY.MAX_BACKLOG_BYTES
    )
  }

  /** The tester-visible backlog: every frame whose raw file still exists. */
  backlog(): { frames: ScreenFrameRecord[]; totals: { frames: number; bytes: number } } {
    return {
      frames: listFramesInState(this.db, RAW_BACKLOG_STATES),
      totals: getBacklogTotals(this.db),
    }
  }

  quarantined(): ScreenFrameRecord[] {
    return listFramesInState(this.db, ['failed', 'quarantined'])
  }

  /** Attempt a capture. Privacy gate first, then scheduler, then backlog cap —
   *  each refusal is measured by reason (a closed enum), never by content. */
  captureFrame(
    input: CapturedFrameInput,
    gate: ScreenCaptureGateContext,
    environment: ScreenSamplingEnvironment,
  ): CaptureAttemptResult {
    this.measure('screen_context_capture', { outcome: 'attempted', trigger: input.trigger })

    const gateDecision = evaluateCaptureGate(gate)
    if (!gateDecision.allowed) {
      this.measure('screen_context_capture', {
        outcome: 'blocked', blocked_reason: gateDecision.reason ?? 'unknown', trigger: input.trigger,
      })
      return { captured: false, reason: gateDecision.reason, frame: null }
    }

    const schedule = evaluateSamplingSchedule(this.scheduler, this.now(), input.trigger, environment)
    if (!schedule.allowed) {
      this.measure('screen_context_capture', {
        outcome: 'blocked', blocked_reason: schedule.reason ?? 'unknown', trigger: input.trigger,
      })
      return { captured: false, reason: schedule.reason, frame: null }
    }

    if (this.backlogCapReached()) {
      if (!this.backlogPaused) {
        this.backlogPaused = true
        this.notify('backlog_cap_reached')
      }
      this.measure('screen_context_capture', {
        outcome: 'blocked', blocked_reason: 'backlog_cap', trigger: input.trigger,
        backlog_bucket: backlogBucket(getBacklogTotals(this.db).frames),
      })
      return { captured: false, reason: 'backlog_cap', frame: null }
    }

    const stored = this.frameStore.write(`pending_${input.capturedAt}`, input.bytes)
    const frame = insertFrameRecord(this.db, {
      capturedAt: input.capturedAt,
      trigger: input.trigger,
      appBundleId: input.appBundleId,
      appName: input.appName,
      displayId: input.displayId,
      exclusionPolicyVersion: this.exclusionPolicyVersion,
      localPath: stored.localPath,
      byteSize: stored.byteSize,
    })
    recordCapture(this.scheduler, this.now(), input.trigger)
    this.measure('screen_context_capture', {
      outcome: 'succeeded', trigger: input.trigger,
      byte_bucket: byteBucket(stored.byteSize),
      backlog_bucket: backlogBucket(getBacklogTotals(this.db).frames),
    })
    return { captured: true, reason: null, frame }
  }

  noteContextChange(): void {
    noteContextChange(this.scheduler, this.now())
  }

  /** Extract one frame end to end: extracting → atomic evidence commit →
   *  safe_to_delete → raw file gone → deleted. Failure quarantines. */
  async processFrame(frameId: string): Promise<ScreenEvidenceRecord | null> {
    const frame = getFrameRecord(this.db, frameId)
    if (!frame) return null
    if (frame.state !== 'captured' && frame.state !== 'quarantined') return null
    if (!frame.localPath) return null

    const startedAt = this.now()
    const extracting = transitionFrameState(this.db, frame.id, 'extracting')
    let bytes: Uint8Array
    try {
      bytes = this.frameStore.read(extracting.localPath!)
    } catch (error) {
      this.recordExtractionFailure(extracting, error)
      return null
    }

    try {
      const result = await this.extractor.extract({
        frameId: frame.id,
        bytes,
        capturedAt: frame.capturedAt,
        appBundleId: frame.appBundleId,
        appName: frame.appName,
      })
      const digest = createHash('sha256').update(bytes).digest('hex')
      // The atomic commit: evidence + 'indexed' in one transaction. Only after
      // it returns is the raw file eligible for deletion.
      const evidence = commitExtractionResult(this.db, extracting, result, digest)
      transitionFrameState(this.db, frame.id, 'safe_to_delete')
      this.deleteRawFile(frame.id)
      this.measure('screen_context_extraction', {
        outcome: 'succeeded',
        latency_bucket: latencyBucket(this.now() - startedAt),
        retry_count: frame.retryCount,
        added_new_fact: Boolean(evidence.docTitle || evidence.ocrSpans.length > 0 || evidence.subjectRefs.length > 0),
      })
      if (this.backlogPaused && !this.backlogCapReached()) this.backlogPaused = false
      return evidence
    } catch (error) {
      this.recordExtractionFailure(extracting, error)
      return null
    }
  }

  /** Extract everything eligible: fresh captures plus quarantined frames whose
   *  bounded retry is due and still inside the raw safety window. */
  async processBacklog(): Promise<void> {
    const nowMs = this.now()
    const eligible = [
      ...listFramesInState(this.db, ['captured']),
      ...listFramesInState(this.db, ['quarantined']).filter((f) =>
        f.retryCount < SCREEN_CONTEXT_POLICY.MAX_EXTRACTION_RETRIES
        && f.nextRetryAt != null && f.nextRetryAt <= nowMs
        && nowMs - f.capturedAt < SCREEN_CONTEXT_POLICY.RAW_SAFETY_WINDOW_MS,
      ),
    ]
    for (const frame of eligible) {
      const wasRetry = frame.state === 'quarantined'
      if (wasRetry) this.measure('screen_context_extraction', { outcome: 'retried', retry_count: frame.retryCount })
      await this.processFrame(frame.id)
    }
    // Anything past the safety window with retries left burns no more attempts
    // on its own: it waits, visible, for an explicit Retry or Delete.
    const waiting = listFramesInState(this.db, ['quarantined']).filter((f) =>
      f.retryCount >= SCREEN_CONTEXT_POLICY.MAX_EXTRACTION_RETRIES
      || nowMs - f.capturedAt >= SCREEN_CONTEXT_POLICY.RAW_SAFETY_WINDOW_MS,
    )
    if (waiting.length > 0) this.notify('quarantine_needs_attention')
  }

  /** The tester's explicit Retry — always allowed, even past the automatic
   *  retry budget; the person outranks the backoff schedule. */
  async retryFrame(frameId: string): Promise<ScreenEvidenceRecord | null> {
    const frame = getFrameRecord(this.db, frameId)
    if (!frame || frame.state !== 'quarantined') return null
    return this.processFrame(frameId)
  }

  /** The tester's explicit Delete. Removes the raw file AND every derived
   *  record; when nothing was ever derived, the ledger records exactly that. */
  deleteFrame(frameId: string): boolean {
    const frame = getFrameRecord(this.db, frameId)
    if (!frame || frame.state === 'deleted') return false
    const evidence = getEvidenceForFrame(this.db, frameId)
    const remove = this.db.transaction(() => {
      if (evidence) deleteEvidenceRows(this.db, [evidence.id])
      transitionFrameState(this.db, frameId, 'deleted', {
        localPath: null,
        deletedWithoutEvidence: !evidence,
      })
    })
    // Record first, then remove the file: a crash in between leaves an orphan
    // file with no claiming record, which the recovery scan deletes.
    remove()
    if (frame.localPath) {
      try { this.frameStore.delete(frame.localPath) } catch { /* already gone */ }
    }
    if (this.backlogPaused && !this.backlogCapReached()) this.backlogPaused = false
    return true
  }

  /** Revoking permission closes the experiment: every unprocessed frame (raw
   *  backlog without committed evidence) is deleted immediately. */
  revokeConsent(): void {
    const unprocessed = listFramesInState(this.db, ['captured', 'extracting', 'failed', 'quarantined'])
    for (const frame of unprocessed) this.deleteFrame(frame.id)
    this.measure('screen_context_consent', { action: 'revoked' })
  }

  /** Adding an exclusion offers deletion of prior screen-derived evidence for
   *  that source — raw files, extraction records, everything. A frame whose
   *  raw file is already gone still surrenders its derived evidence. */
  deleteForSource(source: { bundleId?: string | null; appName?: string | null }): number {
    return this.deleteFrames(listFramesForSource(this.db, source))
  }

  deleteForPeriod(fromMs: number, toMs: number): number {
    return this.deleteFrames(listFramesInPeriod(this.db, fromMs, toMs))
  }

  /** Delete every raw and derived screen-context record. */
  deleteAll(): number {
    const deleted = this.deleteFrames(listAllFrames(this.db))
    // Belt: no evidence row may survive its frame.
    deleteEvidenceRows(this.db, listAllEvidence(this.db).map((e) => e.id))
    return deleted
  }

  private deleteFrames(frames: readonly ScreenFrameRecord[]): number {
    let deleted = 0
    for (const frame of frames) {
      if (frame.state !== 'deleted') {
        if (this.deleteFrame(frame.id)) deleted += 1
        continue
      }
      // Terminal frame, but its derived evidence may still exist — a
      // source/period/history deletion owns that evidence too.
      const evidence = getEvidenceForFrame(this.db, frame.id)
      if (evidence) {
        deleteEvidenceRows(this.db, [evidence.id])
        deleted += 1
      }
    }
    return deleted
  }

  /** Crash recovery. Restores the lifecycle invariant after any interruption:
   *  orphan files with no valid record are deleted; interrupted extractions
   *  re-quarantine for retry; frames whose evidence committed but whose raw
   *  deletion was interrupted finish deleting; frames whose raw file vanished
   *  are closed out honestly. */
  recoverOrphans(): void {
    const frames = listAllFrames(this.db)
    const knownPaths = new Set(frames.map((f) => f.localPath).filter((p): p is string => Boolean(p)))

    // Files on disk that no lifecycle record claims → no valid record → delete.
    for (const path of this.frameStore.list()) {
      if (!knownPaths.has(path)) {
        try { this.frameStore.delete(path) } catch { /* already gone */ }
      }
    }

    const nowMs = this.now()
    const remainingPaths = new Set(this.frameStore.list())
    for (const frame of frames) {
      const fileExists = Boolean(frame.localPath) && remainingPaths.has(frame.localPath!)

      if ((frame.state === 'indexed' || frame.state === 'safe_to_delete')) {
        // Evidence is committed — finishing the raw deletion is always safe.
        if (frame.state === 'indexed') transitionFrameState(this.db, frame.id, 'safe_to_delete')
        this.deleteRawFile(frame.id)
        continue
      }

      if (frame.state === 'extracting') {
        // Interrupted mid-extraction. The raw copy is the only copy: never
        // silently delete it — quarantine for retry (file present) or record
        // the loss (file gone).
        if (fileExists) {
          transitionFrameState(this.db, frame.id, 'failed', { lastError: 'extraction interrupted' })
          this.quarantine(frame.id, frame.retryCount)
        } else {
          transitionFrameState(this.db, frame.id, 'deleted', {
            localPath: null, deletedWithoutEvidence: true, lastError: 'raw file missing after interruption',
          })
        }
        continue
      }

      if ((frame.state === 'captured' || frame.state === 'failed' || frame.state === 'quarantined') && !fileExists && frame.localPath) {
        // The raw file disappeared out from under an unprocessed record —
        // close the ledger honestly: gone, and nothing derived survived.
        transitionFrameState(this.db, frame.id, 'deleted', {
          localPath: null, deletedWithoutEvidence: true, lastError: 'raw file missing',
        })
        continue
      }

      if (frame.state === 'quarantined' && nowMs - frame.capturedAt >= SCREEN_CONTEXT_POLICY.RAW_SAFETY_WINDOW_MS) {
        this.notify('quarantine_needs_attention')
      }
    }
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private deleteRawFile(frameId: string): void {
    const frame = getFrameRecord(this.db, frameId)
    if (!frame || frame.state !== 'safe_to_delete') return
    if (frame.localPath) {
      try { this.frameStore.delete(frame.localPath) } catch { /* already gone */ }
    }
    transitionFrameState(this.db, frameId, 'deleted', { localPath: null })
  }

  private quarantine(frameId: string, priorRetries: number): void {
    const frame = getFrameRecord(this.db, frameId)
    if (!frame || frame.state !== 'failed') return
    const retryCount = priorRetries + 1
    const withinBudget = retryCount < SCREEN_CONTEXT_POLICY.MAX_EXTRACTION_RETRIES
      && this.now() - frame.capturedAt < SCREEN_CONTEXT_POLICY.RAW_SAFETY_WINDOW_MS
    const backoff = SCREEN_CONTEXT_POLICY.RETRY_BACKOFF_MS[
      Math.min(retryCount - 1, SCREEN_CONTEXT_POLICY.RETRY_BACKOFF_MS.length - 1)
    ]
    transitionFrameState(this.db, frameId, 'quarantined', {
      retryCount,
      nextRetryAt: withinBudget ? this.now() + backoff : null,
      firstFailedAt: frame.firstFailedAt ?? this.now(),
    })
    this.measure('screen_context_extraction', { outcome: 'quarantined', retry_count: retryCount })
    if (!withinBudget) this.notify('quarantine_needs_attention')
  }

  private recordExtractionFailure(frame: ScreenFrameRecord, error: unknown): void {
    // The stored error is bounded and structural — never frame content.
    const message = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 200) : 'extraction failed'
    transitionFrameState(this.db, frame.id, 'failed', { lastError: message })
    this.measure('screen_context_extraction', { outcome: 'failed', retry_count: frame.retryCount })
    this.quarantine(frame.id, frame.retryCount)
  }
}
