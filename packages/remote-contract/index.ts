export const REMOTE_CONTRACT_VERSION = "2026-04-20-r2";

export type Platform = "macos" | "windows" | "linux";

export type Category =
  | "development"
  | "communication"
  | "research"
  | "writing"
  | "aiTools"
  | "design"
  | "browsing"
  | "meetings"
  | "entertainment"
  | "email"
  | "productivity"
  | "social"
  | "system"
  | "uncategorized";

export type FocusSessionStatus = "completed" | "cancelled" | "active";

export interface AppSummary {
  appKey: string;
  bundleID?: string;
  displayName: string;
  category: Category;
  totalSeconds: number;
  sessionCount: number;
  iconBase64?: string;
}

export interface CategoryTotal {
  category: Category;
  totalSeconds: number;
}

export interface TimelineEntry {
  appKey: string;
  startAt: string;
  endAt: string;
}

export interface TopPage {
  domain: string;
  label?: string | null;
  seconds: number;
}

export interface TopDomain {
  domain: string;
  seconds: number;
  category: Category;
  topPages?: TopPage[];
}

export interface FocusSession {
  sourceId: string;
  startAt: string;
  endAt: string;
  actualDurationSec: number;
  targetMinutes: number;
  status: FocusSessionStatus;
}

export interface FocusScoreV2Snapshot {
  deepWorkPct: number | null;
  longestStreakSeconds: number;
  switchCount: number;
  deepWorkSessionCount: number;
}

export interface WorkBlockSummary {
  id: string;
  startAt: string;
  endAt: string;
  label: string;
  labelSource: "user" | "ai" | "rule";
  dominantCategory: Category;
  focusSeconds: number;
  switchCount: number;
  confidence: "high" | "medium" | "low";
  topApps: Array<{
    appKey: string;
    seconds: number;
  }>;
  topPages: Array<{
    domain: string;
    label: string | null;
    seconds: number;
  }>;
  artifactIds: string[];
}

export type RecapChapterId =
  | "headline"
  | "focus"
  | "artifacts"
  | "rhythm"
  | "change";

export interface RecapSummaryLite {
  headline: string;
  chapters: Array<{
    id: RecapChapterId;
    eyebrow: string;
    title: string;
    body: string;
  }>;
  metrics: Array<{
    label: string;
    value: string;
    detail: string;
  }>;
  changeSummary: string;
  promptChips: string[];
  hasData: boolean;
}

export interface RecapCoverage {
  attributedPct: number;
  untitledPct: number;
  activeDayCount: number;
  quietDayCount: number;
  hasComparison: boolean;
  coverageNote: string | null;
}

export interface WorkstreamRollup {
  label: string;
  seconds: number;
  blockCount: number;
  isUntitled: boolean;
}

export type ArtifactKind =
  | "markdown"
  | "csv"
  | "json_table"
  | "html_chart"
  | "report";

export interface ArtifactRollup {
  id: string;
  kind: ArtifactKind;
  title: string;
  byteSize: number;
  generatedAt: string;
  threadId: string | null;
}

export interface EntityRollup {
  id: string;
  label: string;
  kind: "client" | "project" | "repo" | "topic";
  secondsToday: number;
  blockCount: number;
}

export interface DaySnapshotV1 {
  schemaVersion: 1;
  deviceId: string;
  platform: Platform;
  date: string;
  generatedAt: string;
  isPartialDay: boolean;
  focusScore: number;
  focusSeconds: number;
  appSummaries: AppSummary[];
  categoryTotals: CategoryTotal[];
  timeline: TimelineEntry[];
  topDomains: TopDomain[];
  categoryOverrides: Record<string, Category>;
  aiSummary: string | null;
  focusSessions: FocusSession[];
}

export interface DaySnapshotV2 extends Omit<DaySnapshotV1, "schemaVersion"> {
  schemaVersion: 2;
  focusScoreV2: FocusScoreV2Snapshot;
  workBlocks: WorkBlockSummary[];
  recap: {
    day: RecapSummaryLite;
    week: RecapSummaryLite | null;
    month: RecapSummaryLite | null;
  };
  coverage: RecapCoverage;
  topWorkstreams: WorkstreamRollup[];
  standoutArtifacts: ArtifactRollup[];
  entities: EntityRollup[];
  privacyFiltered: boolean;
}

export type DaySnapshot = DaySnapshotV1 | DaySnapshotV2;

export const SNAPSHOT_SCHEMA_VERSION = 2;

export type SyncHealth =
  | "linked"
  | "pending_first_sync"
  | "healthy"
  | "stale"
  | "failed";

export type WorkspacePresenceState =
  | "active"
  | "idle"
  | "meeting"
  | "sleeping"
  | "offline"
  | "stale";

export interface WorkspaceSessionClaims {
  workspaceId: string;
  deviceId: string;
  sessionKind: "desktop" | "web";
  contractVersion: string;
}

export interface WorkspaceLivePresence {
  contractVersion: string;
  deviceId: string;
  localDate: string;
  state: WorkspacePresenceState;
  heartbeatAt: number;
  capturedAt: number;
  lastMeaningfulCaptureAt: number;
  currentBlockLabel: string | null;
  currentCategory: Category | null;
  currentAppKey: string | null;
  currentFocusSeconds: number | null;
}

export interface SyncedDaySummary {
  contractVersion: string;
  deviceId: string;
  localDate: string;
  generatedAt: string;
  isPartialDay: boolean;
  focusScore: number;
  focusSeconds: number;
  focusScoreV2: FocusScoreV2Snapshot | null;
  recap: DaySnapshotV2["recap"];
  coverage: RecapCoverage;
  topWorkstreams: WorkstreamRollup[];
  latestWorkBlockId: string | null;
  workBlockCount: number;
  entityCount: number;
  artifactCount: number;
  privacyFiltered: boolean;
}

export interface RemoteSyncPayload {
  contractVersion: string;
  deviceId: string;
  localDate: string;
  generatedAt: string;
  daySummary: SyncedDaySummary;
  workBlocks: WorkBlockSummary[];
  entities: EntityRollup[];
  artifacts: ArtifactRollup[];
}

export interface SyncRunSummary {
  contractVersion: string;
  deviceId: string;
  localDate: string;
  startedAt: number;
  finishedAt: number;
  status: "success" | "failed";
  workBlockCount: number;
  entityCount: number;
  artifactCount: number;
  message: string | null;
}

export interface SyncFailureSummary {
  contractVersion: string;
  deviceId: string;
  localDate: string | null;
  failedAt: number;
  reason: string;
  detail: string | null;
}

export type WorkspaceThreadSource = "desktop" | "web";

export interface WorkspaceAIThread {
  workspaceThreadId: string;
  title: string;
  source: WorkspaceThreadSource;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
}

export interface WorkspaceAIMessage {
  workspaceMessageId: string;
  workspaceThreadId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
  provider: string | null;
  model: string | null;
  failureReason: string | null;
}

export interface WorkspaceAIArtifact {
  workspaceArtifactId: string;
  workspaceThreadId: string;
  workspaceMessageId: string | null;
  title: string;
  kind: ArtifactKind;
  createdAt: number;
  storageId: string | null;
  textContent: string | null;
}

export function isSnapshotV2(snapshot: DaySnapshot): snapshot is DaySnapshotV2 {
  return snapshot.schemaVersion === 2;
}

export function readSnapshotFocusScore(snapshot: DaySnapshot): number {
  return snapshot.schemaVersion === 2
    ? snapshot.focusScoreV2.deepWorkPct ?? 0
    : snapshot.focusScore;
}

export function computeFocusScore(
  focusedSeconds: number,
  totalTrackedSeconds: number,
  switchesPerHour: number
): number {
  if (totalTrackedSeconds === 0) return 0;
  const focusedRatio = focusedSeconds / totalTrackedSeconds;
  const penalty = Math.min(switchesPerHour / 300, 0.15);
  return Math.round(100 * focusedRatio * (1 - penalty));
}

function createWorkspaceScopedId(prefix: string) {
  const timePart = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${timePart}${randomPart}`;
}

export function createWorkspaceThreadId(): string {
  return createWorkspaceScopedId("wth");
}

export function createWorkspaceMessageId(): string {
  return createWorkspaceScopedId("wmsg");
}

export function createWorkspaceArtifactId(): string {
  return createWorkspaceScopedId("wart");
}
