// Screen-context experiment (DEV-197) — the shared vocabulary of the frame
// lifecycle. Everything here is deliberately free of Electron and OS imports:
// the operating-system screen APIs and the local extraction model are injected
// at the two adapter seams (FrameFileStore / ScreenFrameExtractor), so the
// whole lifecycle is provable in a terminal harness with a fake frame source
// and a deterministic extractor before any real capture code exists.

// ─── Lifecycle ────────────────────────────────────────────────────────────────
//
//   captured → extracting → indexed → safe_to_delete → deleted
//                       ↘ failed → quarantined → extracting
//
// One durable state per frame. The invariant the whole experiment hangs on:
// a raw frame file is deleted ONLY after its derived evidence commits
// atomically (state 'indexed'), or after the person explicitly deletes it.

export type ScreenFrameState =
  | 'captured'
  | 'extracting'
  | 'indexed'
  | 'safe_to_delete'
  | 'deleted'
  | 'failed'
  | 'quarantined'

export type ScreenFrameTrigger = 'stability' | 'context_change' | 'interval' | 'diagnostic'

export interface ScreenFrameRecord {
  id: string
  capturedAt: number
  trigger: ScreenFrameTrigger
  appBundleId: string | null
  appName: string | null
  displayId: number | null
  exclusionPolicyVersion: number
  /** Path of the encrypted raw file; null once the file is gone. */
  localPath: string | null
  byteSize: number
  state: ScreenFrameState
  retryCount: number
  lastError: string | null
  nextRetryAt: number | null
  firstFailedAt: number | null
  /** 1 when the person deleted a failed frame and no derived evidence
   *  survived — the honest record the spec requires for explicit deletion. */
  deletedWithoutEvidence: boolean
  createdAt: number
  updatedAt: number
}

// ─── Derived evidence ─────────────────────────────────────────────────────────
// What extraction may keep (title, short OCR spans, subject references,
// provenance bounding, versions, confidence, a one-way digest) — and nothing
// it may not (no reconstructed image, thumbnail, full transcript, or hidden
// accessibility content). Always high sensitivity; local-only during the
// experiment.

export interface ScreenEvidenceRecord {
  id: string
  frameId: string
  capturedAt: number
  appBundleId: string | null
  appName: string | null
  docTitle: string | null
  ocrSpans: string[]
  subjectRefs: string[]
  bounding: unknown | null
  extractorModel: string
  extractorSchemaVersion: number
  confidence: number
  sensitivity: 'high'
  frameDigest: string
  intervalStartMs: number | null
  intervalEndMs: number | null
  createdAt: number
}

export interface ScreenExtractionResult {
  docTitle: string | null
  ocrSpans: string[]
  subjectRefs: string[]
  bounding?: unknown | null
  extractorModel: string
  extractorSchemaVersion: number
  confidence: number
}

// ─── Adapter seams ────────────────────────────────────────────────────────────

/** A frame as the (future) OS capture adapter or the diagnostic sampler hands
 *  it to the lifecycle — raw bytes plus the foreground context they belong to. */
export interface CapturedFrameInput {
  bytes: Uint8Array
  capturedAt: number
  trigger: ScreenFrameTrigger
  appBundleId: string | null
  appName: string | null
  displayId: number | null
}

/** Encrypted at-rest storage for raw frame files. The lifecycle never touches
 *  the filesystem directly, so the harness can prove every invariant against
 *  an in-memory or tmp-dir store. */
export interface FrameFileStore {
  write(id: string, bytes: Uint8Array): { localPath: string; byteSize: number }
  read(localPath: string): Uint8Array
  delete(localPath: string): void
  /** Every stored frame file path — the crash-recovery orphan scan input. */
  list(): string[]
}

/** The local extraction runtime (OCR + approved visual extraction), injected
 *  at the model boundary. Throwing marks the frame failed and quarantines it. */
export interface ScreenFrameExtractor {
  extract(input: {
    frameId: string
    bytes: Uint8Array
    capturedAt: number
    appBundleId: string | null
    appName: string | null
  }): Promise<ScreenExtractionResult>
}

// ─── Capture gate ─────────────────────────────────────────────────────────────
// Every reason sampling stops BEFORE capture. Reasons are a closed enum so the
// measurement contract can report them without ever carrying content.

export type ScreenCaptureBlockReason =
  | 'consent_missing'
  | 'screen_context_paused'
  | 'tracking_paused'
  | 'excluded_app'
  | 'excluded_site'
  | 'private_browser'
  | 'protected_surface'
  | 'screen_share'
  | 'protected_media'
  | 'backlog_cap'
  | 'rate_min_interval'
  | 'rate_hourly_cap'
  | 'context_not_stable'
  | 'bounded_interval'
  | 'power_backoff'

export interface ScreenCaptureGateDecision {
  allowed: boolean
  reason: ScreenCaptureBlockReason | null
}

/** Everything the gate needs to decide, resolved by the caller — the gate
 *  itself is pure and provable. */
export interface ScreenCaptureGateContext {
  consentEnabled: boolean
  screenContextPaused: boolean
  trackingPaused: boolean
  /** Foreground app/site exclusion, resolved through the same Tracking
   *  Controls matching normal capture uses. */
  foregroundExcluded: boolean
  /** true, false, or 'unknown' — unknown blocks, never guesses. */
  privateBrowser: boolean | 'unknown'
  /** Password, authentication, payment, keychain, permission, or OS security
   *  surface detected in the foreground. */
  protectedSurface: boolean
  screenShareActive: boolean
  protectedMediaActive: boolean
}

/** Environment inputs the sampling scheduler backs off on. */
export interface ScreenSamplingEnvironment {
  onBattery: boolean
  cpuPressure: boolean
  locked: boolean
  idle: boolean
  asleep: boolean
  fullScreenMedia: boolean
}

// ─── Policy constants (the spec's numbers, named once) ───────────────────────

export const SCREEN_CONTEXT_POLICY = {
  /** Foreground context must be stable at least this long before a frame. */
  STABILITY_MS: 2_000,
  /** Bounded re-sample interval while the same context stays active. */
  SAME_CONTEXT_INTERVAL_MS: 60_000,
  /** No more than one automatic frame per this interval. */
  MIN_AUTOMATIC_INTERVAL_MS: 30_000,
  /** Hard hourly ceiling on automatic frames. */
  MAX_FRAMES_PER_HOUR: 120,
  /** Raw backlog caps — reaching either pauses sampling and notifies. */
  MAX_BACKLOG_FRAMES: 100,
  MAX_BACKLOG_BYTES: 250 * 1024 * 1024,
  /** Bounded extraction retries inside the safety window. */
  MAX_EXTRACTION_RETRIES: 5,
  /** Maximum raw-image lifetime; past it a failing frame stays quarantined
   *  until the person chooses Retry or Delete. */
  RAW_SAFETY_WINDOW_MS: 24 * 60 * 60 * 1000,
  /** Retry backoff schedule (bounded, sums well inside the safety window). */
  RETRY_BACKOFF_MS: [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 4 * 60 * 60_000] as readonly number[],
} as const

/** States whose raw file still exists on disk — the backlog the caps count. */
export const RAW_BACKLOG_STATES: readonly ScreenFrameState[] = [
  'captured', 'extracting', 'failed', 'quarantined', 'indexed', 'safe_to_delete',
]

/** The legal transitions of the lifecycle — everything else is a bug the
 *  repository refuses, so an illegal hop can never be written durably. */
export const SCREEN_FRAME_TRANSITIONS: Readonly<Record<ScreenFrameState, readonly ScreenFrameState[]>> = {
  captured: ['extracting', 'deleted'],
  extracting: ['indexed', 'failed', 'deleted'],
  indexed: ['safe_to_delete', 'deleted'],
  safe_to_delete: ['deleted'],
  deleted: [],
  failed: ['quarantined', 'deleted'],
  quarantined: ['extracting', 'deleted'],
}
