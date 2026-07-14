import {
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { requireSessionIdentity } from "./authHelpers";
import type { Doc, Id } from "./_generated/dataModel";
import type {
  AppSummary,
  ArtifactRollup,
  CategoryTotal,
  DaySnapshotV2,
  EntityRollup,
  FocusScoreV2Snapshot,
  RecapCoverage,
  RemoteSyncPayload,
  SyncedDaySummary,
  TopDomain,
  WorkBlockSummary,
  WorkstreamRollup,
  WorkspaceLivePresence,
} from "@daylens/remote-contract";
import {
  remoteSyncPayloadValidator,
  syncFailureSummaryValidator,
  workspaceLivePresenceValidator,
} from "./snapshotValidator";

const LIVE_STALE_MS = 90_000;
const DEFAULT_RECAP = {
  day: {
    headline: "",
    chapters: [],
    metrics: [],
    changeSummary: "",
    promptChips: [],
    hasData: false,
  },
  week: null,
  month: null,
} satisfies DaySnapshotV2["recap"];

type SyncedDaySummaryDoc = Doc<"synced_day_summaries">;
type SyncedWorkBlockDoc = Doc<"synced_work_blocks">;
type SyncedEntityDoc = Doc<"synced_entities">;
type SyncedArtifactDoc = Doc<"synced_artifacts">;
type MaybeLegacySyncedDaySummary = Omit<SyncedDaySummary, "focusScoreV2"> & {
  focusScoreV2: unknown;
};
type MaybeLegacyRemoteSyncPayload = Omit<RemoteSyncPayload, "daySummary"> & {
  daySummary: MaybeLegacySyncedDaySummary;
};

function focusScorePct(value: unknown, fallback: number): number {
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as {
    deepWorkPct?: unknown;
    score?: unknown;
  };

  if (typeof candidate.deepWorkPct === "number") return candidate.deepWorkPct;
  if (candidate.deepWorkPct === null) return fallback;
  if (typeof candidate.score === "number") return candidate.score;
  return fallback;
}

function longestStreakSeconds(value: unknown): number {
  return value && typeof value === "object" && typeof (value as { longestStreakSeconds?: unknown }).longestStreakSeconds === "number"
    ? (value as { longestStreakSeconds: number }).longestStreakSeconds
    : 0;
}

function switchCount(value: unknown): number {
  return value && typeof value === "object" && typeof (value as { switchCount?: unknown }).switchCount === "number"
    ? (value as { switchCount: number }).switchCount
    : 0;
}

function deepWorkSessionCount(value: unknown): number {
  return value && typeof value === "object" && typeof (value as { deepWorkSessionCount?: unknown }).deepWorkSessionCount === "number"
    ? (value as { deepWorkSessionCount: number }).deepWorkSessionCount
    : 0;
}

function normalizeFocusScoreV2(value: unknown, fallback: number): FocusScoreV2Snapshot {
  return {
    deepWorkPct: focusScorePct(value, fallback),
    longestStreakSeconds: longestStreakSeconds(value),
    switchCount: switchCount(value),
    deepWorkSessionCount: deepWorkSessionCount(value),
  };
}

function blockDurationSeconds(block: Pick<WorkBlockSummary, "startAt" | "endAt">) {
  const duration = Date.parse(block.endAt) - Date.parse(block.startAt);
  return Number.isFinite(duration) && duration > 0
    ? Math.round(duration / 1_000)
    : 0;
}

function formatDuration(seconds: number) {
  const wholeSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function normalizeWhitespace(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function looksLikeRawPath(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value);
  return normalized.includes("/") || normalized.includes("\\");
}

function looksLikeUnknownLabel(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value).toLowerCase();
  return (
    !normalized ||
    /^unknown-\d+$/.test(normalized) ||
    /^unknown\s+\d+$/.test(normalized) ||
    /^[a-z]$/.test(normalized) ||
    /^pid-\d+$/.test(normalized)
  );
}

function looksLikePageTitleLeak(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value).toLowerCase();
  if (!normalized) return false;
  if (/(\s[|•·]\s.*\s[|•·]\s)/.test(value ?? "")) return true;
  if (/\b(youtube|x\.com|twitter|instagram|reddit|tiktok|facebook|linkedin)\b/.test(normalized)) return true;
  if (/\b(home|for you|feed|explore|notifications|watch|shorts|reels|login|sign in|new tab)\b/.test(normalized) && normalized.length <= 48) {
    return true;
  }
  return false;
}

function titleCaseWords(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => (part[0] ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
    .join(" ");
}

const APP_DISPLAY_NAMES: Record<string, string> = {
  safari: "Safari",
  chrome: "Chrome",
  firefox: "Firefox",
  arc: "Arc",
  dia: "Dia",
  codex: "Codex",
  cursor: "Cursor",
  warp: "Warp",
  stable: "Warp",
  terminal: "Terminal",
  iterm: "iTerm",
  iterm2: "iTerm",
  finder: "Finder",
  claude: "Claude",
  chatgpt: "ChatGPT",
  slack: "Slack",
  figma: "Figma",
  linear: "Linear",
  notion: "Notion",
  daylens: "Daylens",
  discord: "Discord",
  spotify: "Spotify",
  teams: "Teams",
  outlook: "Outlook",
  obsidian: "Obsidian",
  xcode: "Xcode",
  github: "GitHub",
  youtube: "YouTube",
};

function humanizeAppKey(appKey: string): {
  key: string;
  label: string;
  meaningful: boolean;
} {
  const trimmed = normalizeWhitespace(appKey);
  if (!trimmed) {
    return { key: "", label: "", meaningful: false };
  }

  let base = trimmed.replace(/\\/g, "/");
  if (base.includes("/")) {
    base = base.split("/").filter(Boolean).pop() ?? base;
  }

  if (base.includes(".") && !base.includes(" ")) {
    base = base.split(".").filter(Boolean).pop() ?? base;
  }

  base = base
    .replace(/\.exe$/i, "")
    .replace(/\.app$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();

  const normalized = base.toLowerCase();
  if (looksLikeUnknownLabel(normalized)) {
    return { key: "", label: "", meaningful: false };
  }

  const label = APP_DISPLAY_NAMES[normalized] ?? titleCaseWords(base);
  return {
    key: label,
    label,
    meaningful: label.length > 1,
  };
}

function sanitizeTopApps(
  topApps: WorkBlockSummary["topApps"],
): WorkBlockSummary["topApps"] {
  const apps = new Map<string, WorkBlockSummary["topApps"][number]>();

  for (const app of topApps) {
    const normalized = humanizeAppKey(app.appKey);
    if (!normalized.meaningful) continue;

    const existing = apps.get(normalized.key);
    if (existing) {
      existing.seconds += app.seconds;
    } else {
      apps.set(normalized.key, {
        appKey: normalized.label,
        seconds: app.seconds,
      });
    }
  }

  return [...apps.values()]
    .sort((left, right) => right.seconds - left.seconds)
    .slice(0, 3);
}

function sanitizeBlockLabel(
  label: string,
  topApps: WorkBlockSummary["topApps"],
): string {
  const normalized = normalizeWhitespace(label);
  if (
    normalized &&
    !looksLikeRawPath(normalized) &&
    !looksLikeUnknownLabel(normalized) &&
    !looksLikePageTitleLeak(normalized)
  ) {
    return normalized;
  }

  if (topApps.length > 0) {
    return topApps.slice(0, 2).map((app) => app.appKey).join(" + ");
  }

  return "Work block";
}

function sanitizeWorkBlock(block: WorkBlockSummary): WorkBlockSummary {
  const topApps = sanitizeTopApps(block.topApps);

  return {
    ...block,
    label: sanitizeBlockLabel(block.label, topApps),
    topApps,
    artifactIds: [],
    topPages: block.topPages
      .map((page) => ({
        domain: normalizeWhitespace(page.domain).toLowerCase(),
        label: normalizeWhitespace(page.domain).toLowerCase(),
        seconds: page.seconds,
      }))
      .filter((page) => page.domain.length > 0)
      .slice(0, 3),
  };
}

function buildWorkstreamRollupsFromBlocks(blocks: WorkBlockSummary[]): WorkstreamRollup[] {
  const workstreams = new Map<string, WorkstreamRollup>();

  for (const block of blocks) {
    const label = normalizeWhitespace(block.label) || "Work block";
    const existing = workstreams.get(label) ?? {
      label,
      seconds: 0,
      blockCount: 0,
      isUntitled: label === "Work block",
    };
    existing.seconds += blockDurationSeconds(block);
    existing.blockCount += 1;
    workstreams.set(label, existing);
  }

  return [...workstreams.values()]
    .sort((left, right) => right.seconds - left.seconds)
    .slice(0, 8);
}

function buildSafeRecap(
  summary: MaybeLegacySyncedDaySummary,
  workBlocks: WorkBlockSummary[],
  topWorkstreams: WorkstreamRollup[],
  artifacts: ArtifactRollup[],
): DaySnapshotV2["recap"] {
  if (workBlocks.length === 0) {
    return DEFAULT_RECAP;
  }

  const mainWorkstream = topWorkstreams[0]?.label ?? "the visible work";
  const headline = `Tracked ${formatDuration(summary.focusSeconds)} across ${workBlocks.length} synced work blocks. Main thread: ${mainWorkstream}.`;

  return {
    day: {
      headline,
      chapters: [
        {
          id: "headline",
          eyebrow: "Timeline",
          title: "What the synced day shows",
          body: headline,
        },
        {
          id: "focus",
          eyebrow: "Focus",
          title: "Focus score",
          body: `Focus score was ${focusScorePct(summary.focusScoreV2, summary.focusScore)}/100. The remote view keeps only privacy-safe labels and evidence.`,
        },
        {
          id: "artifacts",
          eyebrow: "Evidence",
          title: "Approved synced evidence",
          body: artifacts.length > 0
            ? `${artifacts.length} synced artifact${artifacts.length === 1 ? "" : "s"} were available for this day.`
            : "No synced artifacts were available for this day.",
        },
      ],
      metrics: [
        {
          label: "Focus time",
          value: formatDuration(summary.focusSeconds),
          detail: `${workBlocks.length} synced work blocks`,
        },
        {
          label: "Focus score",
          value: `${focusScorePct(summary.focusScoreV2, summary.focusScore)}/100`,
          detail: topWorkstreams[0]?.label ?? "No named workstream yet",
        },
      ],
      changeSummary: summary.coverage.coverageNote ?? "",
      promptChips: [
        "What was I working on most today?",
        "Summarize the visible work blocks for this day.",
      ],
      hasData: true,
    },
    week: null,
    month: null,
  };
}

function recapLooksHealthy(recap: DaySnapshotV2["recap"] | null | undefined) {
  const day = recap?.day;
  if (!day || !day.hasData) return false;
  if (normalizeWhitespace(day.headline).length < 12) return false;
  return day.chapters.some(
    (chapter) =>
      normalizeWhitespace(chapter.eyebrow).length > 1 &&
      normalizeWhitespace(chapter.title).length > 3 &&
      normalizeWhitespace(chapter.body).length > 12,
  );
}

function sanitizePayloadForStorage(payload: MaybeLegacyRemoteSyncPayload): RemoteSyncPayload {
  const workBlocks = payload.workBlocks.map(sanitizeWorkBlock);
  const topWorkstreams = buildWorkstreamRollupsFromBlocks(workBlocks);
  const latestWorkBlock = [...workBlocks]
    .sort((left, right) => right.endAt.localeCompare(left.endAt))
    .at(0);
  const normalizedFocusScoreV2 = payload.daySummary.focusScoreV2 === null
    ? null
    : normalizeFocusScoreV2(payload.daySummary.focusScoreV2, payload.daySummary.focusScore);

  return {
    ...payload,
    workBlocks,
    daySummary: {
      ...payload.daySummary,
      focusScoreV2: normalizedFocusScoreV2,
      recap: buildSafeRecap(payload.daySummary, workBlocks, topWorkstreams, payload.artifacts),
      topWorkstreams,
      latestWorkBlockId: latestWorkBlock?.id ?? null,
      workBlockCount: workBlocks.length,
      entityCount: payload.entities.length,
      artifactCount: payload.artifacts.length,
      privacyFiltered: payload.daySummary.privacyFiltered,
    },
  };
}

function mergeFocusScoreV2(summaries: MaybeLegacySyncedDaySummary[]): FocusScoreV2Snapshot | null {
  const weighted = {
    deepWorkPct: 0,
    longestStreakSeconds: 0,
    switchCount: 0,
    deepWorkSessionCount: 0,
  };
  let totalWeight = 0;

  for (const summary of summaries) {
    if (!summary.focusScoreV2) continue;
    const weight = Math.max(summary.focusSeconds, 1);
    totalWeight += weight;
    weighted.deepWorkPct += focusScorePct(summary.focusScoreV2, summary.focusScore) * weight;
    weighted.longestStreakSeconds = Math.max(weighted.longestStreakSeconds, longestStreakSeconds(summary.focusScoreV2));
    weighted.switchCount += switchCount(summary.focusScoreV2);
    weighted.deepWorkSessionCount += deepWorkSessionCount(summary.focusScoreV2);
  }

  if (totalWeight === 0) return null;

  return {
    deepWorkPct: Math.round(weighted.deepWorkPct / totalWeight),
    longestStreakSeconds: weighted.longestStreakSeconds,
    switchCount: weighted.switchCount,
    deepWorkSessionCount: weighted.deepWorkSessionCount,
  };
}

function mergeWorkBlocks(blockDocs: SyncedWorkBlockDoc[]): WorkBlockSummary[] {
  const blocks = new Map<string, WorkBlockSummary>();
  for (const doc of blockDocs) {
    blocks.set(doc.blockId, doc.block);
  }
  return [...blocks.values()].sort((left, right) => left.startAt.localeCompare(right.startAt));
}

function mergeEntities(entityDocs: SyncedEntityDoc[]): EntityRollup[] {
  const entities = new Map<string, EntityRollup>();
  for (const doc of entityDocs) {
    const existing = entities.get(doc.entityKey);
    if (existing) {
      existing.secondsToday += doc.entity.secondsToday;
      existing.blockCount += doc.entity.blockCount;
    } else {
      entities.set(doc.entityKey, { ...doc.entity });
    }
  }
  return [...entities.values()]
    .sort((left, right) => right.secondsToday - left.secondsToday)
    .slice(0, 12);
}

function mergeArtifacts(artifactDocs: SyncedArtifactDoc[]): ArtifactRollup[] {
  const artifacts = new Map<string, ArtifactRollup>();
  for (const doc of artifactDocs) {
    const existing = artifacts.get(doc.artifactId);
    if (!existing || doc.artifact.generatedAt > existing.generatedAt) {
      artifacts.set(doc.artifactId, { ...doc.artifact });
    }
  }
  return [...artifacts.values()]
    .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))
    .slice(0, 12);
}

function buildAppSummaries(blocks: WorkBlockSummary[]): AppSummary[] {
  const apps = new Map<string, AppSummary & {
    categoryWeights: Map<string, number>;
  }>();

  for (const block of blocks) {
    for (const app of block.topApps) {
      const normalized = humanizeAppKey(app.appKey);
      if (!normalized.meaningful) continue;

      const existing = apps.get(normalized.key) ?? {
        appKey: normalized.key,
        displayName: normalized.label,
        category: block.dominantCategory,
        totalSeconds: 0,
        sessionCount: 0,
        categoryWeights: new Map<string, number>(),
      };
      existing.totalSeconds += app.seconds;
      existing.sessionCount += 1;
      existing.categoryWeights.set(
        block.dominantCategory,
        (existing.categoryWeights.get(block.dominantCategory) ?? 0) + app.seconds,
      );
      apps.set(normalized.key, existing);
    }
  }

  return [...apps.values()]
    .map(({ categoryWeights, ...app }) => {
      const dominantCategory = [...categoryWeights.entries()]
        .sort((left, right) => right[1] - left[1])[0]?.[0];
      return {
        ...app,
        category: (dominantCategory ?? app.category) as AppSummary["category"],
      };
    })
    .sort((left, right) => right.totalSeconds - left.totalSeconds)
    .slice(0, 12);
}

function buildCategoryTotals(blocks: WorkBlockSummary[]): CategoryTotal[] {
  const totals = new Map<string, number>();

  for (const block of blocks) {
    const duration = blockDurationSeconds(block);
    totals.set(
      block.dominantCategory,
      (totals.get(block.dominantCategory) ?? 0) + duration,
    );
  }

  return [...totals.entries()]
    .map(([category, totalSeconds]) => ({
      category: category as CategoryTotal["category"],
      totalSeconds,
    }))
    .sort((left, right) => right.totalSeconds - left.totalSeconds);
}

function buildTopDomains(blocks: WorkBlockSummary[]): TopDomain[] {
  const domains = new Map<string, TopDomain>();

  for (const block of blocks) {
    for (const page of block.topPages) {
      const existing = domains.get(page.domain) ?? {
        domain: page.domain,
        seconds: 0,
        category: "uncategorized",
        topPages: [],
      };
      existing.seconds += page.seconds;
      existing.topPages = [
        ...(existing.topPages ?? []),
        {
          domain: page.domain,
          label: page.label,
          seconds: page.seconds,
        },
      ]
        .sort((left, right) => right.seconds - left.seconds)
        .slice(0, 5);
      domains.set(page.domain, existing);
    }
  }

  return [...domains.values()]
    .sort((left, right) => right.seconds - left.seconds)
    .slice(0, 10);
}

function mergeCoverage(summaries: MaybeLegacySyncedDaySummary[]): RecapCoverage {
  const latest = [...summaries].sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))[0];
  return latest?.coverage ?? {
    attributedPct: 0,
    untitledPct: 0,
    activeDayCount: 0,
    quietDayCount: 0,
    hasComparison: false,
    coverageNote: null,
  };
}

function mergeRecap(
  summaries: MaybeLegacySyncedDaySummary[],
  workBlocks: WorkBlockSummary[],
  topWorkstreams: WorkstreamRollup[],
  artifacts: ArtifactRollup[],
): DaySnapshotV2["recap"] {
  const latest = [...summaries].sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))[0];
  if (latest && recapLooksHealthy(latest.recap)) {
    return latest.recap;
  }
  if (!latest) {
    return DEFAULT_RECAP;
  }
  return buildSafeRecap(latest, workBlocks, topWorkstreams, artifacts);
}

function maxSyncedAt(
  summaryDocs: SyncedDaySummaryDoc[],
  blockDocs: SyncedWorkBlockDoc[],
  entityDocs: SyncedEntityDoc[],
  artifactDocs: SyncedArtifactDoc[],
): number {
  return Math.max(
    0,
    ...summaryDocs.map((doc) => doc.syncedAt),
    ...blockDocs.map((doc) => doc.syncedAt),
    ...entityDocs.map((doc) => doc.syncedAt),
    ...artifactDocs.map((doc) => doc.syncedAt),
  );
}

export async function loadRemoteDayForWorkspace(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  localDate: string,
) {
  const [summaryDocs, blockDocs, entityDocs, artifactDocs, devices] = await Promise.all([
    ctx.db
      .query("synced_day_summaries")
      .withIndex("by_workspace_date", (q) => q.eq("workspaceId", workspaceId).eq("localDate", localDate))
      .take(50),
    ctx.db
      .query("synced_work_blocks")
      .withIndex("by_workspace_date", (q) => q.eq("workspaceId", workspaceId).eq("localDate", localDate))
      .take(500),
    ctx.db
      .query("synced_entities")
      .withIndex("by_workspace_date", (q) => q.eq("workspaceId", workspaceId).eq("localDate", localDate))
      .take(500),
    ctx.db
      .query("synced_artifacts")
      .withIndex("by_workspace_date", (q) => q.eq("workspaceId", workspaceId).eq("localDate", localDate))
      .take(500),
    ctx.db
      .query("devices")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .take(50),
  ]);

  if (summaryDocs.length === 0 && blockDocs.length === 0 && entityDocs.length === 0 && artifactDocs.length === 0) {
    return null;
  }

  const summaries = summaryDocs.map((doc) => doc.summary);
  const workBlocks = mergeWorkBlocks(blockDocs).map(sanitizeWorkBlock);
  const entities = mergeEntities(entityDocs);
  const artifacts = mergeArtifacts(artifactDocs);
  const topWorkstreams = buildWorkstreamRollupsFromBlocks(workBlocks);
  const appSummaries = buildAppSummaries(workBlocks);
  const categoryTotals = buildCategoryTotals(workBlocks);
  const topDomains = buildTopDomains(workBlocks);
  const totalFocusWeight = summaries.reduce((sum, summary) => sum + Math.max(summary.focusSeconds, 1), 0);
  const devicePlatform = devices.find((device) => device.deviceId === summaries[0]?.deviceId)?.platform;
  const focusScore = totalFocusWeight > 0
    ? Math.round(summaries.reduce((sum, summary) => sum + summary.focusScore * Math.max(summary.focusSeconds, 1), 0) / totalFocusWeight)
    : 0;
  const focusSeconds = summaries.reduce((sum, summary) => sum + summary.focusSeconds, 0);
  const focusScoreV2 = mergeFocusScoreV2(summaries) ?? {
    deepWorkPct: focusScore,
    longestStreakSeconds: 0,
    switchCount: 0,
    deepWorkSessionCount: 0,
  };

  const snapshot: DaySnapshotV2 = {
    schemaVersion: 2,
    deviceId: summaries[0]?.deviceId ?? "remote",
    platform: devicePlatform === "linux" || devicePlatform === "windows" || devicePlatform === "macos"
      ? devicePlatform
      : "macos",
    date: localDate,
    generatedAt: summaries[0]?.generatedAt ?? new Date(maxSyncedAt(summaryDocs, blockDocs, entityDocs, artifactDocs)).toISOString(),
    isPartialDay: summaries.some((summary) => summary.isPartialDay),
    focusScore,
    focusSeconds,
    appSummaries,
    categoryTotals,
    timeline: workBlocks.map((block) => ({
      appKey: block.topApps[0]?.appKey ?? block.label,
      startAt: block.startAt,
      endAt: block.endAt,
    })),
    topDomains,
    categoryOverrides: {},
    aiSummary: null,
    focusSessions: [],
    focusScoreV2,
    workBlocks,
    recap: mergeRecap(summaries, workBlocks, topWorkstreams, artifacts),
    coverage: mergeCoverage(summaries),
    topWorkstreams,
    standoutArtifacts: artifacts,
    entities,
    privacyFiltered: summaries.some((summary) => summary.privacyFiltered),
  };

  return {
    _id: `remote:${localDate}`,
    localDate,
    syncedAt: maxSyncedAt(summaryDocs, blockDocs, entityDocs, artifactDocs),
    snapshot,
  };
}

export async function loadRemoteSummariesForWorkspace(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
) {
  const docs = await ctx.db
    .query("synced_day_summaries")
    .withIndex("by_workspace_date", (q) => q.eq("workspaceId", workspaceId))
    .take(500);

  const dates = [...new Set(docs.map((doc) => doc.localDate))].sort((left, right) => right.localeCompare(left));
  const merged = await Promise.all(dates.map((date) => loadRemoteDayForWorkspace(ctx, workspaceId, date)));

  return merged
    .filter((doc): doc is NonNullable<typeof doc> => doc !== null)
    .map((doc) => ({
      _id: doc._id,
      localDate: doc.localDate,
      syncedAt: doc.syncedAt,
      snapshot: {
        schemaVersion: doc.snapshot.schemaVersion,
        focusScore: focusScorePct(doc.snapshot.focusScoreV2, doc.snapshot.focusScore),
        focusSeconds: doc.snapshot.focusSeconds,
        appSummaries: doc.snapshot.appSummaries.map((app) => ({ appKey: app.appKey })),
        workBlocks: doc.snapshot.workBlocks.map((block) => ({ id: block.id })),
      },
    }));
}

export async function loadRemoteRangeForWorkspace(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  startDate: string,
  endDate: string,
) {
  const docs = await ctx.db
    .query("synced_day_summaries")
    .withIndex("by_workspace_date", (q) => q.eq("workspaceId", workspaceId))
    .take(500);

  const dates = [...new Set(
    docs
      .map((doc) => doc.localDate)
      .filter((localDate) => localDate >= startDate && localDate <= endDate),
  )].sort((left, right) => right.localeCompare(left));

  const merged = await Promise.all(dates.map((date) => loadRemoteDayForWorkspace(ctx, workspaceId, date)));
  return merged.filter((doc): doc is NonNullable<typeof doc> => doc !== null);
}

async function pruneMissingByKey(
  ctx: MutationCtx,
  docs: Array<{ _id: Id<any> } & Record<string, unknown>>,
  keepKeys: Set<string>,
  readKey: (doc: Record<string, unknown>) => string,
) {
  for (const doc of docs) {
    const key = readKey(doc as Record<string, unknown>);
    if (!keepKeys.has(key)) {
      await ctx.db.delete(doc._id);
    }
  }
}

export const recordHeartbeat = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    deviceId: v.string(),
    presence: workspaceLivePresenceValidator,
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("workspace_live_presence")
      .withIndex("by_workspace_device", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("deviceId", args.deviceId)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        presence: args.presence,
        heartbeatAt: args.presence.heartbeatAt,
      });
    } else {
      await ctx.db.insert("workspace_live_presence", {
        workspaceId: args.workspaceId,
        deviceId: args.deviceId,
        presence: args.presence,
        heartbeatAt: args.presence.heartbeatAt,
      });
    }

  },
});

export const recordFailure = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    deviceId: v.string(),
    failure: syncFailureSummaryValidator,
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("sync_failures", {
      workspaceId: args.workspaceId,
      deviceId: args.deviceId,
      localDate: args.failure.localDate,
      contractVersion: args.failure.contractVersion,
      failedAt: args.failure.failedAt,
      reason: args.failure.reason,
      detail: args.failure.detail,
    });
  },
});

export const syncDay = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    deviceId: v.string(),
    payload: remoteSyncPayloadValidator,
  },
  handler: async (ctx, args) => {
    const startedAt = Date.now();
    const syncedAt = Date.now();
    const { workspaceId, deviceId } = args;
    const payload = sanitizePayloadForStorage(args.payload);

    const existingSummary = await ctx.db
      .query("synced_day_summaries")
      .withIndex("by_workspace_device_date", (q) =>
        q.eq("workspaceId", workspaceId).eq("deviceId", deviceId).eq("localDate", payload.localDate)
      )
      .unique();

    if (existingSummary) {
      await ctx.db.patch(existingSummary._id, {
        summary: payload.daySummary,
        syncedAt,
      });
    } else {
      await ctx.db.insert("synced_day_summaries", {
        workspaceId,
        deviceId,
        localDate: payload.localDate,
        summary: payload.daySummary,
        syncedAt,
      });
    }

    const [existingBlocks, existingEntities, existingArtifacts] = await Promise.all([
      ctx.db
        .query("synced_work_blocks")
        .withIndex("by_workspace_device_date", (q) =>
          q.eq("workspaceId", workspaceId).eq("deviceId", deviceId).eq("localDate", payload.localDate)
        )
        .take(500),
      ctx.db
        .query("synced_entities")
        .withIndex("by_workspace_device_date", (q) =>
          q.eq("workspaceId", workspaceId).eq("deviceId", deviceId).eq("localDate", payload.localDate)
        )
        .take(500),
      ctx.db
        .query("synced_artifacts")
        .withIndex("by_workspace_device_date", (q) =>
          q.eq("workspaceId", workspaceId).eq("deviceId", deviceId).eq("localDate", payload.localDate)
        )
        .take(500),
    ]);

    const keepBlockIds = new Set(payload.workBlocks.map((block) => block.id));
    const keepEntityKeys = new Set(payload.entities.map((entity) => entity.id));
    const keepArtifactIds = new Set(payload.artifacts.map((artifact) => artifact.id));

    await Promise.all([
      pruneMissingByKey(ctx, existingBlocks, keepBlockIds, (doc) => String(doc.blockId)),
      pruneMissingByKey(ctx, existingEntities, keepEntityKeys, (doc) => String(doc.entityKey)),
      pruneMissingByKey(ctx, existingArtifacts, keepArtifactIds, (doc) => String(doc.artifactId)),
    ]);

    for (const block of payload.workBlocks) {
      const existing = existingBlocks.find((doc) => doc.blockId === block.id);
      if (existing) {
        await ctx.db.patch(existing._id, { block, syncedAt });
      } else {
        await ctx.db.insert("synced_work_blocks", {
          workspaceId,
          deviceId,
          localDate: payload.localDate,
          blockId: block.id,
          block,
          syncedAt,
        });
      }
    }

    for (const entity of payload.entities) {
      const existing = existingEntities.find((doc) => doc.entityKey === entity.id);
      if (existing) {
        await ctx.db.patch(existing._id, { entity, syncedAt });
      } else {
        await ctx.db.insert("synced_entities", {
          workspaceId,
          deviceId,
          localDate: payload.localDate,
          entityKey: entity.id,
          entity,
          syncedAt,
        });
      }
    }

    for (const artifact of payload.artifacts) {
      const existing = existingArtifacts.find((doc) => doc.artifactId === artifact.id);
      if (existing) {
        await ctx.db.patch(existing._id, { artifact, syncedAt });
      } else {
        await ctx.db.insert("synced_artifacts", {
          workspaceId,
          deviceId,
          localDate: payload.localDate,
          artifactId: artifact.id,
          artifact,
          syncedAt,
        });
      }
    }

    await ctx.db.insert("sync_runs", {
      workspaceId,
      deviceId,
      localDate: payload.localDate,
      contractVersion: payload.contractVersion,
      startedAt,
      finishedAt: Date.now(),
      status: "success",
      workBlockCount: payload.workBlocks.length,
      entityCount: payload.entities.length,
      artifactCount: payload.artifacts.length,
      message: null,
    });

    const device = await ctx.db
      .query("devices")
      .withIndex("by_workspace_and_device", (q) =>
        q.eq("workspaceId", workspaceId).eq("deviceId", deviceId)
      )
      .unique();
    if (device) {
      await ctx.db.patch(device._id, { lastSyncAt: syncedAt });
    }
  },
});

export const getTimelineDay = query({
  args: {
    localDate: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await requireSessionIdentity(ctx);
    return loadRemoteDayForWorkspace(ctx, identity.workspaceId, args.localDate);
  },
});

export const listTimelineSummaries = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireSessionIdentity(ctx);
    return loadRemoteSummariesForWorkspace(ctx, identity.workspaceId);
  },
});

export const latestTimelineDate = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireSessionIdentity(ctx);
    const docs = await ctx.db
      .query("synced_day_summaries")
      .withIndex("by_workspace_date", (q) => q.eq("workspaceId", identity.workspaceId))
      .order("desc")
      .take(20);
    return docs[0]?.localDate ?? null;
  },
});

export const getTimelineRange = query({
  args: {
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await requireSessionIdentity(ctx);
    return loadRemoteRangeForWorkspace(ctx, identity.workspaceId, args.startDate, args.endDate);
  },
});

export const getWorkspaceStatus = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireSessionIdentity(ctx);
    const [presenceDocs, latestRun, latestFailure] = await Promise.all([
      ctx.db
        .query("workspace_live_presence")
        .withIndex("by_workspace_heartbeat", (q) => q.eq("workspaceId", identity.workspaceId))
        .order("desc")
        .take(20),
      ctx.db
        .query("sync_runs")
        .withIndex("by_workspace_finished", (q) => q.eq("workspaceId", identity.workspaceId))
        .order("desc")
        .take(1),
      ctx.db
        .query("sync_failures")
        .withIndex("by_workspace_failed_at", (q) => q.eq("workspaceId", identity.workspaceId))
        .order("desc")
        .take(1),
    ]);

    const latestPresence = presenceDocs[0]?.presence ?? null;
    const lastHeartbeatAt = latestPresence?.heartbeatAt ?? null;
    const lastSuccessfulSyncAt = latestRun[0]?.finishedAt ?? null;
    const now = Date.now();
    const hasSyncedData = !!latestRun[0];
    const hasRecentFailure =
      !!latestFailure[0] &&
      (!latestRun[0] || latestFailure[0]!.failedAt >= latestRun[0]!.finishedAt);

    let health: "pending_first_sync" | "healthy" | "stale" | "failed";
    if (hasRecentFailure) {
      health = "failed";
    } else if (!hasSyncedData) {
      health = "pending_first_sync";
    } else if (!latestPresence || now - latestPresence.heartbeatAt > LIVE_STALE_MS) {
      health = "stale";
    } else {
      health = "healthy";
    }

    return {
      health,
      lastHeartbeatAt,
      lastSuccessfulSyncAt,
      latestPresence: latestPresence
        ? {
            ...latestPresence,
            state:
              latestPresence.state !== "offline" &&
              now - latestPresence.heartbeatAt > LIVE_STALE_MS
                ? "stale"
                : latestPresence.state,
          }
        : null,
      latestRun: latestRun[0] ?? null,
      latestFailure: latestFailure[0] ?? null,
    };
  },
});

export const getTimelineDayForWorkspace = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    localDate: v.string(),
  },
  handler: async (ctx, args) => {
    return loadRemoteDayForWorkspace(ctx, args.workspaceId, args.localDate);
  },
});

export const getTimelineRangeForWorkspace = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, args) => {
    return loadRemoteRangeForWorkspace(ctx, args.workspaceId, args.startDate, args.endDate);
  },
});
