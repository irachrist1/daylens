// ---------------------------------------------------------------------------
// Shared types — imported by both main and renderer via path alias @shared/*
// ---------------------------------------------------------------------------

// Sentinel "days" value for the Apps view's All-time period. Large enough to
// span all captured history (~100 years) so the range reaches epoch, and shared
// so the renderer's range key and the main-process queries agree on the value.
export const ALL_TIME_DAYS = 36500

export interface AppSession {
  id: number
  bundleId: string          // exe name on Windows, bundle ID on macOS
  appName: string
  startTime: number         // Unix ms
  endTime: number | null
  durationSeconds: number
  category: AppCategory
  isFocused: boolean
  windowTitle?: string | null
  rawAppName?: string | null
  canonicalAppId?: string | null
  appInstanceId?: string | null
  captureSource?: string | null
  endedReason?: string | null
  captureVersion?: number
}

export interface AppUsageSummary {
  bundleId: string
  canonicalAppId?: string | null
  appName: string
  category: AppCategory
  totalSeconds: number
  isFocused: boolean
  sessionCount?: number   // populated from DB queries; absent for live/synthetic entries
}

// What a category relabel touched, so Settings can report its effect instead of
// changing silently (settings spec §4).
export interface CategoryOverrideEffect {
  daysAffected: number
  sessionsAffected: number
}

// D5: each Apps row leads with what was accomplished, not how long.
// This compact digest provides the headline activity per app over a range —
// the top work block the app participated in and the top artifact it touched.
export interface AppActivityDigest {
  canonicalAppId: string
  bundleId: string
  appName: string
  topBlockLabel: string | null
  topArtifactTitle: string | null
}

export type BlockConfidence = 'high' | 'medium' | 'low'

// The `kind` axis — orthogonal to AppCategory — answers "is this work at all?".
// Resolved from category + domain + app in src/shared/workKind.ts. This is the
// distinction that makes leisure first-class: a video is never a "work session".
export type WorkKind = 'work' | 'leisure' | 'personal' | 'idle'

export type WorkIntentRole =
  | 'execution'
  | 'research'
  | 'communication'
  | 'review'
  | 'coordination'
  | 'ambient'
  | 'ambiguous'

export type WorkIntentPageKind =
  | 'feed'
  | 'thread'
  | 'search'
  | 'article'
  | 'repo'
  | 'pull_request'
  | 'issue'
  | 'doc'
  | 'sheet'
  | 'slide'
  | 'chat'
  | 'video'
  | 'mailbox'
  | 'calendar'
  | 'meeting'
  | 'design'
  | 'website'
  | 'unknown'

export interface WorkIntentSummary {
  role: WorkIntentRole
  subject: string | null
  confidence: number
  summary: string
  rationale: string[]
  pageKinds: WorkIntentPageKind[]
}

// Why an intent episode begins or ends. Segmentation scores every candidate
// boundary from these signals; the winning reason(s) are recorded on the
// episode so each block can explain why it started and stopped. `day-start` /
// `day-end` are the implicit edges of the day; `none` is the placeholder for an
// edge that was never cut (kept here only for internal completeness).
export type BoundaryReason =
  | 'day-start'
  | 'day-end'
  | 'idle-gap'
  | 'meeting-start'
  | 'meeting-end'
  | 'artifact-change'
  | 'repo-change'
  | 'category-shift'
  | 'kind-shift'
  | 'research-to-execution'
  | 'detour-start'
  | 'detour-end'
  | 'subject-change'
  | 'user-merge'
  | 'user-cut'

// The boundary reasons that opened and closed a block/episode. Always
// populated (at minimum the day edges), so every block can explain itself.
export interface BlockBoundary {
  startReasons: BoundaryReason[]
  endReasons: BoundaryReason[]
}

export type TimelineBlockReviewState =
  | 'auto-approved'
  | 'pending'
  | 'approved'
  | 'corrected'
  | 'ignored'

export interface TimelineBlockReview {
  state: TimelineBlockReviewState
  source: 'default' | 'stored_block' | 'stored_evidence'
  originalBlockId: string | null
  originalLabel: string | null
  originalIntentRole: WorkIntentRole | null
  originalIntentSubject: string | null
  correctedLabel: string | null
  correctedIntentRole: WorkIntentRole | null
  correctedIntentSubject: string | null
  // A user recategorization (Edit → Type). Wins over the computed dominant
  // category on every read and recolors the block everywhere (invariant 8).
  correctedCategory: AppCategory | null
  updatedAt: number | null
}

export interface TimelineBlockReviewUpdate {
  blockId: string
  date?: string | null
  state: TimelineBlockReviewState
  correctedLabel?: string | null
  correctedIntentRole?: WorkIntentRole | null
  correctedIntentSubject?: string | null
  correctedCategory?: AppCategory | null
}

// Permanently delete a sensitive tracked record from the app — the underlying
// rows (sessions, visits, focus events, artifacts), not a display filter. Used
// by the block editor's per-entry remove; scoped to the block's time span so
// "this visit" disappears from every surface (timeline, apps, AI, wraps).
export interface PurgeTrackedEvidencePayload {
  kind: 'app' | 'site'
  bundleId?: string
  appName?: string
  domain?: string
  fromMs: number
  toMs: number
}

export interface FocusScoreBreakdown {
  deepWorkPct: number | null
  longestStreakSeconds: number
  switchCount: number
  deepWorkSessionCount: number
}

export interface WorkContextAppSummary {
  bundleId: string
  // Canonical app identity when known — how a site/page row finds the app it
  // happened inside when bundle ids differ across capture sources.
  canonicalAppId?: string | null
  appName: string
  category: AppCategory
  totalSeconds: number
  sessionCount: number
  isBrowser: boolean
}

export interface WorkContextBlock {
  id: string
  startTime: number
  endTime: number
  dominantCategory: AppCategory
  categoryDistribution: Partial<Record<AppCategory, number>>
  ruleBasedLabel: string
  aiLabel: string | null
  sessions: AppSession[]
  topApps: WorkContextAppSummary[]
  websites: WebsiteSummary[]
  keyPages: string[]
  pageRefs: PageRef[]
  documentRefs: DocumentRef[]
  topArtifacts: ArtifactRef[]
  workflowRefs: WorkflowRef[]
  label: BlockLabel
  focusOverlap: FocusOverlapSummary
  evidenceSummary: TimelineEvidenceSummary
  heuristicVersion: string
  computedAt: number
  switchCount: number
  confidence: BlockConfidence
  review: TimelineBlockReview
  isLive: boolean
  // The work/leisure/personal/idle axis for this block, resolved from
  // category + domain + app. Additive — older persisted/derived blocks that
  // predate the field fall back to a computed default (resolveBlockKind).
  kind?: WorkKind
  // Why this block started and stopped. Projected from the IntentEpisode the
  // block was built from; always non-empty (day edges at minimum). Additive —
  // older persisted/derived blocks fall back to a computed default.
  boundary?: BlockBoundary
  // The live day before it has been analyzed: one neutral provisional block per
  // idle-bounded stretch ("Active now"), never per-activity named. Set only on
  // the today view before Analyze Day / nightly finalize (timeline.md §4). The
  // renderer hides Rename/Merge/Hide and the category badge for these.
  provisional?: boolean
}

// A gap on the timeline always carries the reason it happened (founder
// decision, Jul 2, 2026) — looking at a day retroactively you can tell what
// kind of absence each blank stretch was, derived from the activity-state
// events that covered it:
//   asleep    — machine suspended / lid closed
//   locked    — screen locked; user confirmed not present
//   idle      — machine open and unlocked, but no input for a sustained stretch
//   passive   — no input but something was actively playing (video, meeting):
//               present, just not typing
//   paused    — the user paused tracking (settings/tray)
//   untracked — no signal at all: Daylens wasn't running
// The legacy kinds (idle_gap / away / machine_off) remain for older producers.
export interface TimelineGapSegment {
  kind: 'idle_gap' | 'away' | 'machine_off' | 'asleep' | 'locked' | 'idle' | 'passive' | 'paused' | 'untracked'
  startTime: number
  endTime: number
  label: string
  source: 'derived_gap' | 'activity_event'
}

interface TimelineBlockSegment {
  kind: 'work_block'
  startTime: number
  endTime: number
  blockId: string
}

export type TimelineSegment = TimelineBlockSegment | TimelineGapSegment

export interface DayTimelinePayload {
  date: string
  sessions: AppSession[]
  websites: WebsiteSummary[]
  blocks: WorkContextBlock[]
  segments: TimelineSegment[]
  focusSessions: FocusSession[]
  computedAt: number
  version: string
  totalSeconds: number
  focusSeconds: number
  focusPct: number
  appCount: number
  siteCount: number
}

export type HistoryDayPayload = DayTimelinePayload

// One block as the calendar month grid reads it: the same persisted
// timeline_blocks truth the day view renders, reduced to what a day cell
// shows. Label resolution mirrors userVisibleBlockLabel — a user rename
// (block_label_overrides) always wins over label_current.
export interface CalendarRangeBlock {
  id: string
  date: string
  startTime: number
  endTime: number
  dominantCategory: AppCategory
  label: string
  kind: WorkKind
  activeSeconds: number
}

export interface CalendarRangeDay {
  date: string
  blocks: CalendarRangeBlock[]
  activeSeconds: number
}

export interface WorkContextInsight {
  label: string | null
  narrative: string | null
}

interface WorkMemoryPatternSummary {
  id: string
  label: string
  category: AppCategory | null
  confidence: number
  recallCount: number
  occurrenceCount: number
  updatedAt: number
}

export interface WorkMemorySettingsSummary {
  promotedCount: number
  totalOccurrences: number
  topPatterns: WorkMemoryPatternSummary[]
}

// Work memory as an editable, human-readable profile (ChatGPT-style) — replaces
// the opaque pattern table. See docs/specs/work-memory.md.
type WorkMemoryFactOrigin = 'drafted' | 'user'
// DEV-107: where a fact came from, shown in the Manage-memory view. Durability
// is keyed on origin, never source.
type WorkMemoryFactSource = 'evidence' | 'chat' | 'hand'
// DEV-107: which readable section a fact belongs to in the Manage-memory view
// (memory.md §3 — "general memory in its sections"). Derived deterministically
// from the fact, never persisted — grouping is cosmetic, never durability.
export type WorkMemoryCategory = 'work' | 'personal' | 'preferences'

export interface WorkMemoryFact {
  id: string
  text: string
  origin: WorkMemoryFactOrigin
  source: WorkMemoryFactSource
  category: WorkMemoryCategory
}

export interface WorkMemoryProfile {
  facts: WorkMemoryFact[]
}

// DEV-108: one client's scoped memory, shown under that client in the
// Manage-memory view (memory.md §2.2 / §3). A client is a named memory scope.
export interface ClientMemoryGroup {
  clientId: string
  clientName: string
  color: string | null
  facts: WorkMemoryFact[]
}

// The whole memory picture for the Manage-memory view: general memory plus each
// client's scoped memory.
export interface ScopedMemoryProfile {
  general: WorkMemoryFact[]
  clients: ClientMemoryGroup[]
}

// DEV-107: one plain-language entry in the memory audit (memory.md §3).
export interface MemoryAuditEntry {
  id: string
  action: 'remembered' | 'updated' | 'forgot'
  text: string
  source: 'chat' | 'hand'
  createdAt: number
}

// Rebuild / forget each report what changed in one plain-language line.
export interface WorkMemoryMutationResult {
  facts: WorkMemoryFact[]
  changeSummary: string
}

// Result of the one-shot work-memory backfill across the user's full history
// (R4). Returned to the renderer so the Settings panel can report what ran.
export interface MemoryBackfillResult {
  ran: boolean
  reason?: 'disabled' | 'no-tables' | 'no-history'
  fromDate: string | null
  throughDate: string | null
  daysProcessed: number
  daysArchived: number
  daysSkipped: number
  newCandidates: number
  promoted: number
  decayed: number
  backfilled: number
}

export interface AppCategorySuggestion {
  suggestedCategory: AppCategory | null
  reason: string | null
}

export interface FocusSession {
  id: number
  startTime: number
  endTime: number | null
  durationSeconds: number
  label: string | null
  targetMinutes: number | null
  plannedApps: string[]
  reflectionNote?: string | null
}

export interface FocusStartPayload {
  label?: string | null
  targetMinutes?: number | null
  plannedApps?: string[]
}

export interface FocusReflectionSavePayload {
  sessionId: number
  note: string
}

export interface AIDaySummaryResult {
  summary: string
  questionSuggestions: string[]
}

export type AIAnswerKind =
  | 'weekly_brief'
  | 'weekly_literal_list'
  | 'deterministic_stats'
  | 'day_summary_style'
  | 'generated_report'
  | 'freeform_chat'
  | 'error'

export type AIConversationSourceKind = 'weekly_brief' | 'deterministic' | 'freeform'

export type FollowUpAffordance =
  | 'deepen'
  | 'literalize'
  | 'narrow'
  | 'expand'
  | 'compare'
  | 'switch_topic'
  | 'switch_timeframe'
  | 'repair'

type FollowUpResolutionKind =
  | 'fresh_query'
  | 'followup_reuse_context'
  | 'followup_with_override'
  | 'followup_repair'

export type FollowUpClass =
  | 'deepen'
  | 'literalize'
  | 'narrow'
  | 'expand'
  | 'compare'
  | 'topic_pivot'
  | 'time_override'
  | 'repair'

export interface AIConversationDateRange {
  fromMs: number
  toMs: number
  label: string
}

export interface AIWeeklyBriefStateSnapshot {
  intent: string
  responseMode: string
  topic: string | null
  dateRange: AIConversationDateRange
  evidenceKey: string | null
}

export interface AIEntityStateSnapshot {
  entityId: string
  entityName: string
  entityType: 'client' | 'project' | 'evidence'
  rangeStartMs: number
  rangeEndMs: number
  rangeLabel: string
  intent: string
}

export interface AIRoutingContextSnapshot {
  dateMs: number
  timeWindowStartMs: number | null
  timeWindowEndMs: number | null
  weeklyBrief: AIWeeklyBriefStateSnapshot | null
  entity: AIEntityStateSnapshot | null
}

export interface AIConversationState {
  dateRange: AIConversationDateRange | null
  topic: string | null
  responseMode: string | null
  lastIntent: string | null
  evidenceKey: string | null
  answerKind: AIAnswerKind | null
  sourceKind: AIConversationSourceKind | null
  followUpAffordances: FollowUpAffordance[]
  routingContext: AIRoutingContextSnapshot | null
}

export interface FollowUpSuggestion {
  text: string
  source: 'model' | 'deterministic'
  affordance?: FollowUpAffordance | null
}

export interface FollowUpResolution {
  kind: FollowUpResolutionKind
  followUpClass: FollowUpClass | null
  effectivePrompt: string
  shouldReuseContext: boolean
  shouldResetContext: boolean
}

export type AIMessageRating = 'up' | 'down'

interface AIStartFocusAction {
  kind: 'start_focus_session'
  label: string
  payload: FocusStartPayload
}

interface AIStopFocusAction {
  kind: 'stop_focus_session'
  label: string
  sessionId: number
}

interface AIReviewFocusAction {
  kind: 'review_focus_session'
  label: string
  sessionId: number
  placeholder?: string | null
  suggestedNote?: string | null
}

export type AIMessageAction = AIStartFocusAction | AIStopFocusAction | AIReviewFocusAction

// ── AI action widgets (DEV-109, ai-actions.md) ──────────────────────────────
// The AI chat can ACT, not just answer. When you tell it to change something —
// rename a block, remember a fact, attribute an afternoon to a client — the main
// process resolves the instruction into one of these *proposals* and the chat
// renders a preview widget. Nothing is written until you confirm; the commit
// then runs through the SAME manual-edit pipeline (invariants 1, 3, 5). This is
// separate from the read-only resolvers (ADR 0002) — acting is explicit.

// The model picks the surface per action: a small inline card for a one-line
// change, the side canvas for a richer multi-item edit.
export type AIActionSurface = 'card' | 'canvas'

interface AIActionProposalBase {
  /** Stable id within the message — keys confirm/cancel/committed state. */
  proposalId: string
  surface: AIActionSurface
  /** Confirm-button label, e.g. "Rename block" / "Save to memory". */
  confirmLabel: string
  /** Merge / forget / archive need the stronger confirm (invariant 6). */
  destructive?: boolean
}

// One memory change inside a memory proposal, shown as a readable preview line.
export interface AIMemoryOpPreview {
  op: 'add' | 'update' | 'delete'
  /** New text for add/update; the affected fact's text for delete. */
  text: string
  /** Current text being replaced/removed (update/delete). */
  previousText?: string | null
  /** Existing fact id for update/delete. */
  targetId?: string | null
  /** Scope label, e.g. "Work" (general memory for now). */
  scope?: string | null
}

export interface AIMemoryProposal extends AIActionProposalBase {
  kind: 'memory_write'
  ops: AIMemoryOpPreview[]
  /** The scope new facts commit to: a `client:<id>` string for a client-scoped
   *  write (memory.md §2.2), or null/absent for general memory. */
  scopeId?: string | null
}

export interface AIRenameBlockProposal extends AIActionProposalBase {
  kind: 'rename_block'
  blockId: string
  date: string
  previousLabel: string
  nextLabel: string
  /** Human time range for the card header, e.g. "2:00–5:30pm". */
  timeRange: string
}

export interface AIMergeBlocksProposal extends AIActionProposalBase {
  kind: 'merge_blocks'
  date: string
  /** Earlier block first, later block second. */
  blockIds: [string, string]
  firstLabel: string
  secondLabel: string
  firstRange: string
  secondRange: string
  /** The combined span the merged block will cover. */
  mergedRange: string
}

export type AIActionWidget = AIMemoryProposal | AIRenameBlockProposal | AIMergeBlocksProposal

// The result of committing a proposal — drives the card's committed state and
// the one-line confirmation / undo affordance.
export interface AIActionCommitResult {
  ok: boolean
  /** Plain-language confirmation, e.g. "Renamed to \"Networking\"." */
  summary: string
  /** Present when the change is reversible from the card. */
  undo?: AIActionUndo | null
  error?: string | null
}

export type AIActionUndo =
  | { kind: 'restore_block_label'; blockId: string; date: string; previousLabel: string; hadOverride: boolean }
  | { kind: 'forget_memory_fact'; factId: string }

type AIMessageArtifactKind = 'report' | 'table' | 'chart' | 'export'
type AIMessageArtifactFormat = 'markdown' | 'csv' | 'html' | 'json' | 'pdf' | 'docx'

export interface AIMessageArtifact {
  id: string
  kind: AIMessageArtifactKind
  title: string
  subtitle?: string | null
  format: AIMessageArtifactFormat
  path: string
  openTarget: OpenTarget
  createdAt: number
}

type AISurfaceSummaryScope = 'timeline_week' | 'app_detail'

export interface AISurfaceSummary {
  scope: AISurfaceSummaryScope
  scopeKey: string
  jobType: Extract<AIJobType, 'week_review' | 'app_narrative'>
  title?: string | null
  summary: string
  updatedAt: number
  stale?: boolean
}

export interface AIChatStreamEvent {
  requestId: string
  delta: string
  snapshot: string
}

export interface AIThreadMessageMetadata {
  answerKind?: AIAnswerKind | null
  suggestedFollowUps?: FollowUpSuggestion[]
  retryable?: boolean
  retrySourceUserMessageId?: number | null
  contextSnapshot?: AIConversationState | null
  providerError?: boolean
  actions?: AIMessageAction[]
  actionWidgets?: AIActionWidget[]
  artifacts?: AIMessageArtifact[]
  rating?: AIMessageRating | null
  ratingUpdatedAt?: number | null
}

export interface AIThreadMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  answerKind?: AIAnswerKind | null
  suggestedFollowUps?: FollowUpSuggestion[]
  retryable?: boolean
  retrySourceUserMessageId?: number | null
  contextSnapshot?: AIConversationState | null
  providerError?: boolean
  actions?: AIMessageAction[]
  actionWidgets?: AIActionWidget[]
  artifacts?: AIMessageArtifact[]
  rating?: AIMessageRating | null
  ratingUpdatedAt?: number | null
}

export interface AIChatTurnResult {
  assistantMessage: AIThreadMessage
  conversationState: AIConversationState | null
  // R1 instrumentation: number of provider HTTP calls this turn made
  // (tool-loop roundtrips + retries + prose pass). Used to keep the per-turn
  // median low; absent for deterministic turns that made no provider call.
  providerCallCount?: number
}

export interface AIStarterSuggestion {
  label: string
  prompt: string
  source: 'model' | 'recent'
}

export interface AIStarterSuggestionResult {
  suggestions: AIStarterSuggestion[]
  error: string | null
}

// FB7: post-answer transforms. The renderer signals the transform explicitly so
// the main process rewrites the SPECIFIC prior answer (with its grounded numbers)
// instead of mis-routing a disguised English prompt to the generic report bundle.
export type AIAnswerTransformKind = 'shorter' | 'checklist' | 'bullets' | 'report'

export interface AIChatSendRequest {
  message: string
  contextOverride?: AIConversationState | null
  clientRequestId?: string | null
  threadId?: number | null
  transform?: AIAnswerTransformKind | null
}

export interface AIDailyReportPreparationResult {
  date: string
  threadId: number | null
  artifactId: number | null
  prepared: boolean
  status: 'ready' | 'no_activity' | 'failed'
  error?: string | null
}

// ─── Threads & artifacts (AI surface) ────────────────────────────────────────
export interface AIThreadSummary {
  id: number
  title: string
  createdAt: number
  updatedAt: number
  lastMessageAt: number
  archived: boolean
  messageCount: number
  lastSnippet?: string | null
}

// D4: per-thread overrides, stored in ai_threads.metadata_json (no migration).
// `provider` + `model` are set together (a model picked from the catalog) and
// take precedence over the global chat provider for this thread's turns, but
// only when that provider actually has a key. `instructions` are appended to
// the system prompt. Empty/absent fields fall back to the global settings.
export interface AIThreadSettings {
  provider?: AIProviderMode | null
  model?: string | null
  instructions?: string | null
}

export type AIArtifactKind =
  | 'markdown'
  | 'csv'
  | 'html_chart'
  | 'json_table'
  | 'focus_session'
  | 'report'

export interface AIArtifactRecord {
  id: number
  threadId: number | null
  messageId: number | null
  kind: AIArtifactKind
  title: string
  summary: string | null
  filePath: string | null
  hasInline: boolean
  mimeType: string
  byteSize: number
  meta: Record<string, unknown>
  createdAt: number
}

export interface AIArtifactContent {
  record: AIArtifactRecord
  content: string | null
  // Set by the preview path (GET_ARTIFACT) when content was capped to the first
  // N bytes. Open/export read the full artifact and never set this.
  truncated?: boolean
}

export interface AIMessageFeedbackUpdate {
  messageId: number
  rating: AIMessageRating | null
}

export interface WebsiteSummary {
  domain: string
  totalSeconds: number
  visitCount: number
  topTitle: string | null
  browserBundleId: string | null
  canonicalBrowserId?: string | null
}

export type LabelSource = 'rule' | 'artifact' | 'workflow' | 'memory' | 'ai' | 'user'

export interface OpenTarget {
  kind: 'external_url' | 'local_path' | 'unsupported'
  value: string | null
}

export interface ArtifactRef {
  id: string
  artifactType: 'domain' | 'page' | 'document' | 'project' | 'repo' | 'window'
  displayTitle: string
  subtitle?: string | null
  totalSeconds: number
  confidence: number
  canonicalAppId?: string | null
  ownerBundleId?: string | null
  ownerAppName?: string | null
  ownerAppInstanceId?: string | null
  url?: string | null
  path?: string | null
  host?: string | null
  canonicalKey?: string
  openTarget: OpenTarget
  metadata?: Record<string, unknown> | null
}

export type ResolvedIconSource =
  | 'active_window'
  | 'app_file'
  | 'app_identity'
  | 'app_bundle'
  | 'uwp_manifest'
  | 'artifact_file'
  | 'artifact_app'
  | 'browser_cache'
  | 'site_origin'
  | 'site_fallback'
  | 'miss'

export type IconRequest =
  | {
      kind: 'app'
      bundleId?: string | null
      appName?: string | null
      canonicalAppId?: string | null
      appInstanceId?: string | null
    }
  | {
      kind: 'site'
      domain?: string | null
      pageUrl?: string | null
    }
  | {
      kind: 'artifact'
      artifactType?: ArtifactRef['artifactType']
      canonicalAppId?: string | null
      ownerBundleId?: string | null
      ownerAppName?: string | null
      ownerAppInstanceId?: string | null
      path?: string | null
      url?: string | null
      host?: string | null
      title?: string | null
    }

export interface ResolvedIconPayload {
  cacheKey: string
  dataUrl: string | null
  source: ResolvedIconSource
}

export interface PageRef extends ArtifactRef {
  artifactType: 'page'
  domain: string
  visitCount?: number
  browserBundleId?: string | null
  canonicalBrowserId?: string | null
  normalizedUrl?: string | null
  pageKey?: string | null
  pageTitle?: string | null
}

export interface DocumentRef extends ArtifactRef {
  artifactType: 'document' | 'project' | 'repo' | 'window'
  sourceSessionIds: number[]
}

export interface WorkflowRef {
  id: string
  signatureKey: string
  label: string
  confidence: number
  dominantCategory: AppCategory
  canonicalApps: string[]
  artifactKeys: string[]
}

interface BlockLabel {
  current: string
  source: LabelSource
  confidence: number
  narrative: string | null
  ruleBased: string
  aiSuggested: string | null
  override: string | null
}

interface FocusOverlapSummary {
  totalSeconds: number
  pct: number
  sessionIds: number[]
}

export interface TimelineEvidenceSummary {
  apps: WorkContextAppSummary[]
  pages: PageRef[]
  documents: DocumentRef[]
  domains: string[]
  windowTitles?: Array<{
    title: string
    bundleId: string
    appName: string
    startTime: number
    endTime: number
    totalSeconds: number
  }>
  sites?: PageRef[]
  files?: Array<{
    filename: string
    path: string | null
    appName: string
    windowTitle: string
    firstSeenAt: number
    totalSeconds: number
    inferred: true
  }>
}

export interface PeakHoursResult {
  peakStart: number
  peakEnd: number
  focusPct: number
}

export interface WeeklySummary {
  totalTrackedSeconds: number
  totalFocusSeconds: number
  focusPct: number
  avgFocusScore: number
  bestDay: { date: string; focusPct: number } | null
  mostActiveDay: { date: string; totalSeconds: number } | null
  topApps: { appName: string; bundleId: string; totalSeconds: number; category: AppCategory }[]
  dailyBreakdown: {
    date: string
    focusSeconds: number
    totalSeconds: number
    focusScore: number
  }[]
}

export const DISTRACTION_DOMAINS = [
  'youtube.com', 'x.com', 'twitter.com', 'instagram.com',
  'reddit.com', 'tiktok.com', 'netflix.com', 'facebook.com',
]

export interface DistractionCostPayload {
  daysTracked: number
  totalDistractionSeconds: number
  annualExtrapolatedSeconds: number
  byMonth: { month: string; totalSeconds: number }[]
  byHour: { hour: number; totalSeconds: number }[]
  byDomain: { domain: string; totalSeconds: number }[]
  peakHour: number | null
  trendDirection: 'improving' | 'worsening' | 'flat'
  previousPeriodSeconds: number
}

export interface AppCharacter {
  character:
    | 'deep_focus'
    | 'flow_compatible'
    | 'context_switching'
    | 'distraction'
    | 'communication'
    | 'neutral'
  label: string
  confidence: number
  avgSessionMinutes: number
  sessionCount: number
}

export interface AppProfile {
  canonicalAppId: string
  displayName: string
  roleSummary: string
  topArtifacts: ArtifactRef[]
  pairedApps: Array<{ canonicalAppId: string; bundleId: string | null; displayName: string; totalSeconds: number }>
  topBlockIds: string[]
  computedAt: number
}

export interface WorkflowPattern {
  id: string
  signatureKey: string
  label: string
  dominantCategory: AppCategory
  canonicalApps: string[]
  artifactKeys: string[]
  occurrenceCount: number
  lastSeenAt: number
}

export interface AppDetailPayload {
  canonicalAppId: string
  displayName: string
  appCharacter: AppCharacter | null
  profile: AppProfile
  totalSeconds: number
  sessionCount: number
  topArtifacts: ArtifactRef[]
  topPages: PageRef[]
  /**
   * Per-domain time for browser apps only. When the selected app is a
   * browser (Chrome, Safari, Arc, Firefox, Edge, etc.), this surfaces the
   * domains the user actually spent time on inside that browser, ranked by
   * duration. Omitted for non-browser apps — the renderer should hide the
   * section when the array is absent or empty. Derived from
   * `website_visits.browser_bundle_id` via
   * `getWebsiteSummariesForRange(db, fromMs, toMs, bundleId)`.
   */
  topDomains?: Array<{
    domain: string
    totalSeconds: number
    visitCount: number
    topTitle: string | null
  }>
  pairedApps: Array<{ canonicalAppId: string; bundleId: string | null; displayName: string; totalSeconds: number }>
  blockAppearances: Array<{
    blockId: string
    startTime: number
    endTime: number
    label: string
    dominantCategory: AppCategory
  }>
  /**
   * Memory-pattern rollup of the same blocks: when several
   * `blockAppearances` share a promoted memory pattern (e.g. Tonny renamed
   * three Ghostty blocks to "Daylens development" so all three matched the
   * same `context_patterns` row), the renderer can collapse them under the
   * pattern label instead of listing near-identical rows.
   *
   * `patternLabel` is the promoted pattern's `label_suggestion`. Rows with
   * no matching pattern keep `patternId: null` and one row per block.
   */
  blockMemoryRollups?: Array<{
    patternId: string | null
    patternLabel: string
    sessionCount: number
    totalSeconds: number
    earliestStart: number
    latestEnd: number
    sampleBlockIds: string[]
  }>
  workflowAppearances: WorkflowRef[]
  timeOfDayDistribution: Array<{ hour: number; totalSeconds: number }>
  computedAt: number
  rangeKey: string
}

export interface BreakRecommendation {
  triggerReason: 'sustained_focus'
  focusedMinutes: number
  currentApp: string | null
  message: string
  urgency: 'medium' | 'high'
}

export type AIProvider = 'anthropic' | 'openai' | 'google' | 'openrouter'
export type AIProviderMode = AIProvider | 'claude-cli' | 'codex-cli'
export type AIJobType =
  | 'block_label_preview'
  | 'block_label_finalize'
  | 'block_cleanup_relabel'
  | 'day_summary'
  | 'week_review'
  | 'app_narrative'
  | 'chat_answer'
  | 'chat_followup_suggestions'
  | 'report_generation'
  | 'attribution_assist'
  | 'wrapped_narrative'
  | 'wrapped_period_narrative'
  | 'search_intent'
  | 'memory_write'
  | 'weekly_brief'

export interface AIWrappedNarrative {
  /** The hook: a one-line read on the shape of the day. Always present, and
   *  reused verbatim as the morning/evening notification one-liner. */
  lead: string
  /** The day as a story: morning / midday / evening, narrated like a friend who
   *  was there. Each beat is null when that part of the day was thin. */
  story: {
    morning: string | null
    midday: string | null
    evening: string | null
  }
  /** One short caption under the "where the time went" app/site chart. */
  whereLine: string | null
  /** The wildcard: one surprising true thing, phrased from a candidate hook. */
  wildcard: string | null
  /** A quiet factual sign-off for the finale. */
  closing: string | null
  /** Tracks whether this came from a validated AI response or the deterministic fallback. */
  source: 'ai' | 'fallback'
  factsHash: string
  /** When this wrap was generated (epoch ms). Set when the wrap is persisted, so
   *  the UI shows an honest "generated <when>" marker instead of "just now" on
   *  every open. Absent only for a transient, un-persisted result. */
  generatedAt?: number
}

// ─── Frozen daily snapshots (Briefs & Wraps, invariant 4) ──────────────────────
// A day's numbers, frozen once the day is finalized. Weekly/monthly/annual wraps
// SUM these frozen snapshots instead of re-summarizing — so the stat card and the
// narrative on a wrap can never disagree (the 20h7m-vs-20h53m bug). Every number
// here comes from the same trusted timeline blocks the Timeline view reads.

export interface DaySnapshotThread {
  /** What the user was doing, named for the work — never a raw app/page title. */
  subject: string
  role: WorkIntentRole
  seconds: number
}

export interface DaySnapshot {
  date: string
  /** Total active seconds across trusted blocks — the load-bearing day total. */
  totalActiveSeconds: number
  /** The one reconciled kind split. work+leisure+personal+idle. */
  kind: { work: number; leisure: number; personal: number; idle: number }
  /** Dominant WORK category — never leisure. null when no real work. */
  dominantWorkCategory: AppCategory | null
  /** Per-category active seconds (work-relevant categories), most time first. */
  categories: Array<{ category: AppCategory; seconds: number }>
  /** Top apps by active seconds, most first. */
  apps: Array<{ appName: string; seconds: number; category: AppCategory; isBrowser: boolean }>
  /** Top domains by active seconds, most first. */
  domains: Array<{ domain: string; seconds: number }>
  /** Friendly leisure surfaces ("YouTube", "Netflix"), most time first. */
  leisureSurfaces: string[]
  /** Named work threads (what mattered), most time first. */
  threads: DaySnapshotThread[]
  /** The single longest trusted work stretch of the day. */
  longestBlock: { label: string; seconds: number; startClock: string } | null
  /** Hash of the source facts — lets us detect when a frozen day needs refreezing. */
  factsHash: string
  /** ms epoch when frozen; 0 means provisional (today, still live). */
  finalizedAt: number
}

export type WrappedPeriod = 'week' | 'month' | 'year'

export interface WrappedPeriodThread {
  subject: string
  seconds: number
  /** How many days in the period this thread showed up — "across four days". */
  daysActive: number
}

export interface WrappedPeriodFacts {
  period: WrappedPeriod
  /** Any date inside the period; the period is derived from it. */
  anchorDate: string
  /** Human label for the range, e.g. "Jun 16 – Jun 22" or "June 2026". */
  rangeLabel: string
  /** SUM of the frozen day totals — this is THE stat-card number. */
  totalSeconds: number
  workSeconds: number
  leisureSeconds: number
  personalSeconds: number
  previousPeriodSeconds: number
  daysWithActivity: number
  /** Main mode = the dominant WORK category, never leisure. */
  dominantWorkCategory: AppCategory | 'unknown'
  dominantWorkCategoryPct: number
  /** Where the work time went, most time first — for the "story", with a legend. */
  categories: Array<{ category: AppCategory; seconds: number }>
  topApps: Array<{ appName: string; seconds: number }>
  /** The biggest named threads — what mattered. */
  threads: WrappedPeriodThread[]
  leisureSurfaces: string[]
  busiestDay: { dateStr: string; dayLabel: string; totalSeconds: number } | null
  quietestActiveDay: { dateStr: string; dayLabel: string; totalSeconds: number } | null
  /** Longest single work stretch in the period — a real superlative. */
  longestStretch: { dateStr: string; dayLabel: string; seconds: number; label: string } | null
  /** Sub-rollup: week → 7 days; month → weeks; year → months. */
  buckets: Array<{ label: string; totalSeconds: number; dominantWorkCategory: AppCategory | 'unknown' }>
  busiestBucket: { label: string; totalSeconds: number } | null
}

export interface WrappedPeriodNarrative {
  period: WrappedPeriod
  /** The period in one line — the headline story. Always present. */
  lead: string
  slides: {
    /** What mattered — the biggest threads, named for the work. */
    whatMattered: string | null
    /** Where the time went, as a story (not a chart readout). */
    whereTimeWent: string | null
    /** A real superlative — the standout. */
    standout: string | null
    /** The nitty-gritty: which apps and sites actually held the time. */
    distribution: string | null
  }
  source: 'ai' | 'fallback'
  factsHash: string
}

/** The no-credits rule (briefs-wraps.md §7): with no provider connected, no brief
 *  or wrap is generated — the surface shows one message pointing to Settings and
 *  nothing else. The renderer reads this before rendering any wrap. */
export interface WrapProviderState {
  /** A provider/model is configured for the wrapped job. */
  connected: boolean
  /** The provider name to show in the "connect" / error message. */
  provider: string | null
}

export type AISurface =
  | 'timeline_day'
  | 'timeline_week'
  | 'apps_list'
  | 'app_detail'
  | 'ai_chat'
  | 'settings'
  | 'background'

export type AIInvocationSource = 'user' | 'background' | 'system'
export type AIModelStrategy = 'balanced' | 'quality' | 'economy' | 'custom'

export interface ProcessSnapshot {
  pid: number
  name: string
  cpuPercent: number
  memoryMb: number
  capturedAt: number
}

export type AppTheme = 'system' | 'light' | 'dark'

export type OnboardingPlatform = 'macos' | 'windows' | 'linux'

export type TrackingPermissionState =
  | 'granted'
  | 'missing'
  | 'awaiting_relaunch'
  | 'unsupported_or_unknown'

export type CapturePermissionStatus = 'granted' | 'missing' | 'unsupported_or_unknown'

export interface TrackingPermissionDetails {
  accessibility: CapturePermissionStatus
  screenRecording: CapturePermissionStatus
  combined: TrackingPermissionState
  platformNote?: string | null
  captureHelperRunning?: boolean | null
}

export type OnboardingStage =
  | 'welcome'
  | 'why'
  | 'permission'
  | 'relaunch_required'
  | 'verifying_permission'
  | 'proof'
  | 'tour'
  | 'superpowers'
  | 'about'
  | 'voice'
  | 'work'
  | 'connections'
  | 'privacy'
  | 'personalize'   // legacy: split into about/work/connections/privacy; kept so stale state migrates cleanly
  | 'ai_setup'
  | 'ready'
  | 'complete'

/** How the user's working day is shaped — tunes brief timing and day boundaries.
 *  Captured in onboarding ("when do you work?"). */
export type WorkRhythm = 'early' | 'standard' | 'night' | 'always'

/** How Daylens's written summaries should sound. Chosen in onboarding, applied
 *  to every recap / wrap / brief prompt (`src/shared/summaryVoice.ts`). */
export type SummaryVoice = 'straight' | 'warm' | 'witty'

export type ProofState = 'idle' | 'collecting' | 'ready'
type PersonalizationState = 'pending' | 'completed'
type AISetupState = 'pending' | 'dismissed' | 'connected'

export interface OnboardingState {
  flowVersion: number
  platform: OnboardingPlatform
  stage: OnboardingStage
  trackingPermissionState: TrackingPermissionState
  permissionRequestedAt: number | null
  proofState: ProofState
  personalizationState: PersonalizationState
  aiSetupState: AISetupState
  completedAt: number | null
}

type ProviderConnectionStatus =
  | 'valid'
  | 'invalid_credentials'
  | 'unsupported_format'
  | 'provider_unreachable'

export interface ProviderConnectionResult {
  status: ProviderConnectionStatus
  provider: AIProvider
  detectedProvider: AIProvider | null
  message: string
  canSaveAnyway: boolean
}

export interface WorkspaceResult {
  workspaceId: string
  mnemonic: string
  linkCode: string
  linkToken: string
}

export interface BrowserLinkResult {
  displayCode: string
  fullToken: string
}

export interface SyncStatus {
  isLinked: boolean
  workspaceId: string | null
  lastHeartbeatAt: number | null
  lastSuccessfulSyncAt: number | null
  state: 'local_only' | 'linked' | 'pending_first_sync' | 'healthy' | 'stale' | 'failed'
  lastFailureAt?: number | null
  lastFailureMessage?: string | null
}

export interface AppSettings {
  // Provider API keys are stored in OS keychain via keytar (never in plain-text)
  analyticsOptIn: boolean       // false = no telemetry (default)
  shareAIFeedbackExamples: boolean // legacy setting; cloud feedback upload is disabled in local-only builds
  launchOnLogin: boolean
  theme: AppTheme
  onboardingComplete: boolean
  onboardingState: OnboardingState
  userName: string
  userGoals: string[]
  userIntent: string            // why the user is here, captured in onboarding; fed to AI suggestions
  summaryVoice?: SummaryVoice   // how recaps/wraps/briefs should sound; default 'warm'
  focusApps?: string[]          // apps the user counts as "real work" (bundle ids and/or names)
  interestedCategories?: AppCategory[] // categories the user said they care about; fed to AI context
  userRole?: string             // what the user does (e.g. "Designer"); seeds suggestions + AI context
  userClients?: string[]        // clients/projects the user works with; helps AI recognise & attribute work
  workRhythm?: WorkRhythm       // shape of the working day; tunes brief timing / day boundaries
  firstLaunchDate: number       // Unix ms — set on first launch, used for day-7 feedback prompt
  feedbackPromptShown: boolean  // true once the day-7 prompt has been shown
  aiProvider: AIProviderMode
  anthropicModel: string
  openaiModel: string
  googleModel: string
  openrouterModel: string
  aiFallbackOrder: AIProvider[]
  aiModelStrategy: AIModelStrategy
  // The only per-surface provider override left: an explicit, user-chosen
  // provider for the AI chat tab. Every other surface follows `aiProvider`
  // (invariant #12). When unset, chat follows `aiProvider` too.
  aiChatProvider?: AIProviderMode
  aiBackgroundEnrichment?: boolean
  aiActiveBlockPreview?: boolean
  aiPromptCachingEnabled?: boolean
  aiSpendSoftLimitUsd?: number
  aiRedactFilePaths?: boolean
  aiRedactEmails?: boolean
  allowThirdPartyWebsiteIconFallback?: boolean // false = keep website icons local/browser-cache only
  aiReportPersonalizationEnabled?: boolean
  dailySummaryEnabled?: boolean
  morningNudgeEnabled?: boolean
  distractionAlertThresholdMinutes?: number
  distractionAlertsEnabled?: boolean
  mcpServerEnabled?: boolean
  workMemoryConsolidationEnabled?: boolean   // Evening consolidation: archive the day, score and promote patterns, decay stale ones.
  useRemoteAI?: boolean   // legacy setting; remote workspace AI is disabled in local-only builds.
  // T3 — Tracking Controls (opt-in, OFF by default). When disabled and not
  // paused, capture is unchanged. See src/shared/trackingControls.ts.
  trackingControlsEnabled?: boolean
  trackingExcludedApps?: string[]   // bundle ids and/or app names
  trackingExcludedSites?: string[]  // hosts/domains
  trackingSkipIncognito?: boolean   // effective only when controls enabled; defaults on
  trackingPaused?: boolean          // ad-hoc pause; blocks capture regardless of the master switch
  billingInstallationId?: string    // random local install identity; raw activity never leaves with it
  // Appearance (Settings → General). Colors are per-category overrides of the
  // shared activityColors palette — set via the grouped picker, validated to
  // #rrggbb + known categories on write (see shared/activityColors.ts).
  activityColorOverrides?: Partial<Record<AppCategory, string>>
  dimLeisureBlocks?: boolean        // fade non-work blocks on the calendar; default true
}

export type BillingAccessMode = 'free_credit' | 'subscription' | 'local_pass' | 'own_key' | 'none' | 'unavailable'
export type BillingUsageType = 'free_credit' | 'subscription' | 'local_pass' | 'own_key'

export interface PaymentRecord {
  provider: string
  txRef: string
  amount: number
  currency: string
  status: string
  providerReference: string | null
  createdAt: number
  updatedAt: number
}

export interface BillingAccessSnapshot {
  mode: BillingAccessMode
  canUseAI: boolean
  managed: boolean
  creditGrantedUsd: number
  creditRemainingUsd: number
  periodSpendUsd: number
  paidSpendUsd: number
  renewalAt: number | null
  localPassExpiresAt: number | null
  fairUseRemainingUsd: number | null
  subscriptionStatus: string | null
  providerLabel: string | null
  checkoutAvailable: boolean
  localCheckoutAvailable: boolean
  portalAvailable: boolean
  message: string
}

export type BillingUsageCostSource = 'provider' | 'estimated' | 'unknown'

export interface BillingUsageRow {
  id: string
  occurredAt: number
  type: BillingUsageType
  feature: string
  screen?: string | null
  triggerSource?: string | null
  provider: string | null
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens?: number | null
  cacheWriteTokens?: number | null
  tokens: number | null
  costUsd: number | null
  costSource?: BillingUsageCostSource
  success: boolean
}

export interface BillingUsagePoint {
  day: string
  model: string
  feature?: string
  spendUsd: number
  tokens: number
}

export type BillingUsageSource = 'local_meter' | 'daylens_managed'

export interface BillingUsageJobSummary {
  feature: string
  screen: string | null
  triggerSource: string | null
  provider: string | null
  model: string | null
  calls: number
  successes: number
  failures: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  tokens: number
  costUsd: number | null
}

export interface BillingUsageHourlyPoint {
  hour: number
  label: string
  feature: string
  model: string | null
  calls: number
  tokens: number
  costUsd: number | null
}

export interface BillingUsageReport {
  from: number
  to: number
  source?: BillingUsageSource
  sourceLabel?: string
  totalSpendUsd: number
  totalTokens: number
  totalCalls?: number
  failedCalls?: number
  backgroundCalls?: number
  backgroundTokens?: number
  freeCreditUsedUsd: number
  paidSpendUsd: number
  points: BillingUsagePoint[]
  featurePoints?: BillingUsagePoint[]
  rows: BillingUsageRow[]
  jobSummaries?: BillingUsageJobSummary[]
  hourlyPoints?: BillingUsageHourlyPoint[]
}

// In-flight session that has not yet been flushed to the DB.
// Exposed via IPC so the renderer can merge it into Today's display totals.
export interface LiveSession {
  bundleId: string
  appName: string
  startTime: number   // Unix ms
  category: AppCategory
  windowTitle?: string | null
  rawAppName?: string | null
  canonicalAppId?: string | null
  appInstanceId?: string | null
  captureSource?: string | null
}

export type TrackingModuleSource = 'package' | 'unpacked' | 'hyprctl' | 'swaymsg' | 'xdotool' | 'xprop'
type LinuxTrackingSupportLevel = 'ready' | 'limited' | 'unsupported'

interface LinuxTrackingHelperCommands {
  hyprctl: boolean
  swaymsg: boolean
  xdotool: boolean
  xprop: boolean
}

export interface LinuxTrackingDiagnostics {
  supportLevel: LinuxTrackingSupportLevel
  supportMessage: string
  sessionType: string
  desktop: string
  helperCommands: LinuxTrackingHelperCommands
  display: string | null
  waylandDisplay: string | null
}

interface TrackingRawWindowDiagnostics {
  title: string
  application: string
  path: string
  pid: number
  isUWPApp: boolean
  uwpPackage: string
}

interface TrackingResolvedWindowDiagnostics {
  backend: string
  bundleId: string
  appName: string
  title: string
  pid: number
  path: string
}

interface TrackingStatusDiagnostics {
  moduleSource: TrackingModuleSource | null
  loadError: string | null
  pollError: string | null
  backendTrace: string[]
  lastRawWindow: TrackingRawWindowDiagnostics | null
  lastResolvedWindow: TrackingResolvedWindowDiagnostics | null
}

type LinuxPackageType = 'appimage' | 'deb' | 'rpm' | 'pacman' | 'unknown' | null

interface LinuxDesktopDiagnostics {
  sessionType: string | null
  display: string | null
  waylandDisplay: string | null
  desktop: string | null
  packageType: LinuxPackageType
  packageDetectionSource: 'appimage-env' | 'dpkg-query' | 'rpm-query' | 'pacman-query' | 'unresolved' | null
  packageOwner: string | null
  packageManagerCommand: 'dpkg-query' | 'rpm' | 'pacman' | null
  packageMatchedPath: string | null
  packageDetectionErrors: string[]
  appImage: string | null
  autostartPath: string
  autostartEnabled: boolean
  notificationSupported: boolean
  secureStoreAvailable: boolean
  secureStoreError: string | null
  secureStoreHint: string | null
  dbusSessionBusAddress: string | null
  dbusSessionBusAddressInferred: boolean
  secretServiceReachable: boolean | null
}

export interface TrackingDiagnosticsPayload {
  platform: NodeJS.Platform
  trackingStatus: TrackingStatusDiagnostics
  captureHealth: {
    permissions: TrackingPermissionDetails
    windowTitles: {
      status: 'healthy' | 'waiting' | 'missing'
      recentSamples: number
      recentSamplesWithTitle: number
      lastCapturedAt: number | null
    }
    browsers?: {
      discoveredCount: number
      names: string[]
    }
    captureHelperRunning?: boolean | null
  }
  linuxTracking: LinuxTrackingDiagnostics | null
  linuxDesktop: LinuxDesktopDiagnostics | null
}

export type AppCategory =
  | 'development'
  | 'communication'
  | 'research'
  | 'writing'
  | 'aiTools'
  | 'design'
  | 'browsing'
  | 'meetings'
  | 'entertainment'
  | 'email'
  | 'productivity'
  | 'social'
  | 'system'
  | 'uncategorized'

// The full set of valid categories, for validating untrusted input (e.g. an
// IPC payload) before it's persisted or cast to AppCategory.
const APP_CATEGORIES: readonly AppCategory[] = [
  'development', 'communication', 'research', 'writing', 'aiTools', 'design',
  'browsing', 'meetings', 'entertainment', 'email', 'productivity', 'social',
  'system', 'uncategorized',
]

export function isAppCategory(value: unknown): value is AppCategory {
  return typeof value === 'string' && (APP_CATEGORIES as readonly string[]).includes(value)
}

export const FOCUSED_CATEGORIES: AppCategory[] = [
  'development',
  'research',
  'writing',
  'aiTools',
  'design',
  'productivity',
]

// ─── Attribution / Work Session types for renderer ───────────────────────────

type AttributionStatus = 'attributed' | 'ambiguous' | 'unattributed'

interface ClientSummary {
  id: string
  name: string
  color: string | null
  status: string
  projectCount: number
}

export interface ClientRecord {
  id: string
  name: string
  color: string | null
  status: 'active' | 'archived'
  created_at: number
  updated_at: number
  projectCount: number
}

export interface ProjectSummary {
  id: string
  client_id: string
  name: string
  color: string | null
}

export interface WorkSessionApp {
  app_name: string
  duration_ms: number
  role: string // primary | supporting | ambient
}

interface WorkSessionEvidence {
  type: string   // domain | file_path | title | repo_remote | email_domain | sequence
  value: string
  weight: number
}

export interface WorkSessionPayload {
  id: string
  started_at: number
  ended_at: number
  duration_ms: number
  active_ms: number
  idle_ms: number
  client_id: string | null
  client_name: string | null
  client_color: string | null
  project_id: string | null
  project_name: string | null
  attribution_status: AttributionStatus
  attribution_confidence: number | null
  title: string | null
  apps: WorkSessionApp[]
  evidence: WorkSessionEvidence[]
}

export interface ActivitySegmentPayload {
  id: string
  started_at: number
  ended_at: number
  duration_ms: number
  primary_app_name: string
  class: string // focused | supporting | ambient | idle
}

export interface RollupEntry {
  day_local: string
  client_id: string | null
  project_id: string | null
  attributed_ms: number
  ambiguous_ms: number
  session_count: number
}

export interface ClientDetailPayload {
  client: ClientSummary
  projects: ProjectSummary[]
  rollups: RollupEntry[]
  sessions: WorkSessionPayload[]
  ambiguous_sessions: WorkSessionPayload[]
}

export interface TimelineWorkSession extends WorkSessionPayload {
  is_live?: boolean
}

export interface DayWorkSessionsPayload {
  date: string
  sessions: TimelineWorkSession[]
  total_attributed_ms: number
  total_ambiguous_ms: number
  total_unattributed_ms: number
}

// IPC channel names — single source of truth
export const IPC = {
  DB: {
    GET_TODAY: 'db:get-today',
    GET_HISTORY: 'db:get-history',
    GET_HISTORY_DAY: 'db:get-history-day',
    GET_TIMELINE_DAY: 'db:get-timeline-day',
    REBUILD_TIMELINE_DAY: 'db:rebuild-timeline-day',
    GET_APP_SUMMARIES: 'db:get-app-summaries',
    GET_APP_SUMMARIES_FOR_DATE: 'db:get-app-summaries-for-date',
    GET_ALL_APPS_FOR_LABELING: 'db:get-all-apps-for-labeling',
    GET_CATEGORY_OVERRIDES: 'db:get-category-overrides',
    SET_CATEGORY_OVERRIDE: 'db:set-category-override',
    CLEAR_CATEGORY_OVERRIDE: 'db:clear-category-override',
    GET_APP_SESSIONS: 'db:get-app-sessions',
    GET_WEBSITE_SUMMARIES: 'db:get-website-summaries',
    GET_PEAK_HOURS: 'db:get-peak-hours',
    GET_WEEKLY_SUMMARY: 'db:get-weekly-summary',
    GET_APP_CHARACTER: 'db:get-app-character',
    GET_APP_DETAIL: 'db:get-app-detail',
    GET_APP_ACTIVITY_DIGEST: 'db:get-app-activity-digest',
    GET_WORK_MEMORY_SUMMARY: 'db:get-work-memory-summary',
    FORGET_WORK_MEMORY_PATTERN: 'db:forget-work-memory-pattern',
    FORGET_ALL_WORK_MEMORY: 'db:forget-all-work-memory',
    BACKFILL_WORK_MEMORY: 'db:backfill-work-memory',
    GET_WORK_MEMORY_PROFILE: 'db:get-work-memory-profile',
    UPDATE_WORK_MEMORY_FACT: 'db:update-work-memory-fact',
    ADD_WORK_MEMORY_FACT: 'db:add-work-memory-fact',
    FORGET_WORK_MEMORY_FACT: 'db:forget-work-memory-fact',
    REBUILD_WORK_MEMORY: 'db:rebuild-work-memory',
    GET_MEMORY_AUDIT: 'db:get-memory-audit',
    GET_SCOPED_MEMORY_PROFILE: 'db:get-scoped-memory-profile',
    ADD_CLIENT_MEMORY_FACT: 'db:add-client-memory-fact',
    GET_BLOCK_DETAIL: 'db:get-block-detail',
    GET_WORKFLOW_SUMMARIES: 'db:get-workflow-summaries',
    GET_ARTIFACT_DETAILS: 'db:get-artifact-details',
    SET_BLOCK_LABEL_OVERRIDE: 'db:set-block-label-override',
    CLEAR_BLOCK_LABEL_OVERRIDE: 'db:clear-block-label-override',
    SET_BLOCK_REVIEW: 'db:set-block-review',
    DELETE_TIMELINE_BLOCK: 'db:delete-timeline-block',
    MERGE_TIMELINE_EPISODES: 'db:merge-timeline-episodes',
    SET_BLOCK_SPAN: 'db:set-block-span',
    PURGE_TRACKED_EVIDENCE: 'db:purge-tracked-evidence',
    PURGE_TIMELINE_BLOCK: 'db:purge-timeline-block',
    GET_DISTRACTION_COST: 'db:get-distraction-cost',
    GET_RECAP_RANGE: 'db:get-recap-range',
    GET_TIMELINE_RANGE_BLOCKS: 'db:get-timeline-range-blocks',
  },
  DEBUG: {
    GET_INFO: 'debug:get-info',
  },
  FOCUS: {
    START: 'focus:start',
    STOP: 'focus:stop',
    GET_ACTIVE: 'focus:get-active',
    GET_RECENT: 'focus:get-recent',
    GET_BY_DATE_RANGE: 'focus:get-by-date-range',
    GET_BREAK_RECOMMENDATION: 'focus:get-break-recommendation',
    SAVE_REFLECTION: 'focus:save-reflection',
    GET_DISTRACTION_COUNT: 'focus:get-distraction-count',
  },
  AI: {
    SEND_MESSAGE: 'ai:send-message',
    STREAM_EVENT: 'ai:stream-event',
    GET_STARTER_SUGGESTIONS: 'ai:get-starter-suggestions',
    COMMIT_ACTION: 'ai:commit-action',
    UNDO_ACTION: 'ai:undo-action',
    SET_MESSAGE_FEEDBACK: 'ai:set-message-feedback',
    GENERATE_DAY_SUMMARY: 'ai:generate-day-summary',
    GET_WEEK_REVIEW: 'ai:get-week-review',
    GET_APP_NARRATIVE: 'ai:get-app-narrative',
    PREPARE_DAILY_REPORT: 'ai:prepare-daily-report',
    GET_WRAPPED_NARRATIVE: 'ai:get-wrapped-narrative',
    GET_WRAPPED_PERIOD_NARRATIVE: 'ai:get-wrapped-period-narrative',
    GET_WRAP_PROVIDER_STATE: 'ai:get-wrap-provider-state',
    GET_HISTORY: 'ai:get-history',
    CLEAR_HISTORY: 'ai:clear-history',
    GENERATE_BLOCK_INSIGHT: 'ai:generate-block-insight',
    REGENERATE_BLOCK_LABEL: 'ai:regenerate-block-label',
    SUGGEST_APP_CATEGORY: 'ai:suggest-app-category',
    DETECT_CLI_TOOLS: 'ai:detect-cli-tools',
    TEST_CLI_TOOL: 'ai:test-cli-tool',
    LIST_THREADS: 'ai:list-threads',
    GET_THREAD: 'ai:get-thread',
    CREATE_THREAD: 'ai:create-thread',
    ARCHIVE_THREAD: 'ai:archive-thread',
    RENAME_THREAD: 'ai:rename-thread',
    DELETE_THREAD: 'ai:delete-thread',
    GET_THREAD_SETTINGS: 'ai:get-thread-settings',
    SET_THREAD_SETTINGS: 'ai:set-thread-settings',
    LIST_ARTIFACTS: 'ai:list-artifacts',
    GET_ARTIFACT: 'ai:get-artifact',
    OPEN_ARTIFACT: 'ai:open-artifact',
    EXPORT_ARTIFACT: 'ai:export-artifact',
  },
  SETTINGS: {
    GET: 'settings:get',
    SET: 'settings:set',
    HAS_API_KEY: 'settings:has-api-key',
    SET_API_KEY: 'settings:set-api-key',
    CLEAR_API_KEY: 'settings:clear-api-key',
    VALIDATE_API_KEY: 'settings:validate-api-key',
  },
  BILLING: {
    GET_ACCESS: 'billing:get-access',
    GET_USAGE: 'billing:get-usage',
    CREATE_POLAR_CHECKOUT: 'billing:create-polar-checkout',
    CREATE_FLUTTERWAVE_CHECKOUT: 'billing:create-flutterwave-checkout',
    OPEN_PORTAL: 'billing:open-portal',
    EXPORT_USAGE_CSV: 'billing:export-usage-csv',
    REFRESH: 'billing:refresh',
    GET_PAYMENTS: 'billing:get-payments',
  },
  PROJECTIONS: {
    INVALIDATED: 'projections:invalidated',
  },
  ICONS: {
    RESOLVE: 'icons:resolve',
  },
  TRACKING: {
    GET_LIVE: 'tracking:get-live',
    GET_DIAGNOSTICS: 'tracking:get-diagnostics',
    GET_PROCESS_METRICS: 'tracking:get-process-metrics',
    GET_PERMISSION_STATE: 'tracking:get-permission-state',
    GET_PERMISSION_DETAILS: 'tracking:get-permission-details',
    REQUEST_SCREEN_PERMISSION: 'tracking:request-screen-permission',
    // T3: delete already-captured history for an excluded app/site.
    DELETE_APP_HISTORY: 'tracking:delete-app-history',
    DELETE_SITE_HISTORY: 'tracking:delete-site-history',
    DELETE_ACTIVITY: 'tracking:delete-activity',
  },
  APP: {
    RELAUNCH: 'app:relaunch',
    COMPLETE_ONBOARDING: 'app:complete-onboarding',
    GET_COMPUTER_NAME: 'app:get-computer-name',
  },
  SYNC: {
    GET_STATUS: 'sync:get-status',
    LINK: 'sync:link',
    CREATE_BROWSER_LINK: 'sync:create-browser-link',
    DISCONNECT: 'sync:disconnect',
    GET_MNEMONIC: 'sync:get-mnemonic',
  },
  ATTRIBUTION: {
    GET_CLIENT_QUERY: 'attribution:get-client-query',
    GET_DAY_CONTEXT: 'attribution:get-day-context',
    FIND_CLIENT: 'attribution:find-client',
    LIST_CLIENTS: 'attribution:list-clients',
    LIST_CLIENTS_DETAILED: 'attribution:list-clients-detailed',
    CREATE_CLIENT: 'attribution:create-client',
    UPDATE_CLIENT: 'attribution:update-client',
    ARCHIVE_CLIENT: 'attribution:archive-client',
    RESTORE_CLIENT: 'attribution:restore-client',
    DELETE_CLIENT: 'attribution:delete-client',
    RUN_FOR_RANGE: 'attribution:run-for-range',
    GET_CLIENT_DETAIL: 'attribution:get-client-detail',
    GET_WORK_SESSIONS_FOR_DAY: 'attribution:get-work-sessions-for-day',
    GET_WORK_SESSION_SEGMENTS: 'attribution:get-work-session-segments',
    GET_ROLLUPS: 'attribution:get-rollups',
    GET_APP_WORK_SESSIONS: 'attribution:get-app-work-sessions',
    REASSIGN_SESSION: 'attribution:reassign-session',
    REASSIGN_RANGE: 'attribution:reassign-range',
  },
  SHELL: {
    OPEN_EXTERNAL: 'shell:open-external',
    OPEN_PATH: 'shell:open-path',
  },
  MCP: {
    GET_CONFIG: 'mcp:get-config',
  },
  SYSTEM: {
    THEME_CHANGED: 'system:theme-changed',
  },
} as const
