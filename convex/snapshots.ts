import {
  internalMutation,
  internalQuery,
  query,
  type QueryCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { requireSessionIdentity } from "./authHelpers";
import type { Doc, Id } from "./_generated/dataModel";
import {
  computeFocusScore,
  type AppSummary,
  type DaySnapshot,
  type DaySnapshotV1,
  type DaySnapshotV2,
  type Platform,
  type WorkstreamRollup,
  type ArtifactRollup,
  type EntityRollup,
  type RecapSummaryLite,
} from "../packages/snapshot-schema/snapshot";
import { daySnapshotValidator } from "./snapshotValidator";

const MAX_SNAPSHOT_DOCS = 3650;
const FOCUSED_CATEGORIES = new Set([
  "development",
  "research",
  "writing",
  "aiTools",
  "design",
  "productivity",
]);

type SnapshotDoc = Doc<"day_snapshots">;
type DeviceDoc = Doc<"devices">;
type WorkspacePreferencesDoc = Doc<"workspace_preferences"> | null;

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

type LegacyFocusSession = {
  appKey: string;
  startAt: string;
  endAt: string;
  durationSeconds: number;
};
type StoredFocusSession =
  | DaySnapshotV1["focusSessions"][number]
  | LegacyFocusSession;

function parseGeneratedAtMs(snapshot: unknown): number {
  if (
    !snapshot ||
    typeof snapshot !== "object" ||
    typeof (snapshot as { generatedAt?: unknown }).generatedAt !== "string"
  ) {
    return 0;
  }

  const parsed = Date.parse((snapshot as { generatedAt: string }).generatedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeFocusSession(
  session: StoredFocusSession
): DaySnapshotV1["focusSessions"][number] {
  if ("sourceId" in session) {
    return session;
  }

  return {
    sourceId: `${session.appKey}:${session.startAt}`,
    startAt: session.startAt,
    endAt: session.endAt,
    actualDurationSec: session.durationSeconds,
    targetMinutes: 0,
    status: "completed",
  };
}

function emptyRecapSummary(): RecapSummaryLite {
  return {
    headline: "",
    chapters: [],
    metrics: [],
    changeSummary: "",
    promptChips: [],
    hasData: false,
  };
}

function normalizeSnapshot(snapshot: unknown): DaySnapshot | null {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }

  const candidate = snapshot as Record<string, unknown>;
  const schemaVersion =
    candidate.schemaVersion === 2 ? 2 : candidate.schemaVersion === 1 ? 1 : null;
  const platform = candidate.platform;
  if (
    schemaVersion === null ||
    typeof candidate.deviceId !== "string" ||
    (platform !== "macos" && platform !== "windows" && platform !== "linux") ||
    typeof candidate.date !== "string" ||
    typeof candidate.generatedAt !== "string"
  ) {
    return null;
  }

  const base: DaySnapshotV1 = {
    schemaVersion: 1,
    deviceId: candidate.deviceId,
    platform,
    date: candidate.date,
    generatedAt: candidate.generatedAt,
    isPartialDay: candidate.isPartialDay === true,
    focusScore:
      typeof candidate.focusScore === "number" ? candidate.focusScore : 0,
    focusSeconds:
      typeof candidate.focusSeconds === "number" ? candidate.focusSeconds : 0,
    appSummaries: Array.isArray(candidate.appSummaries)
      ? (candidate.appSummaries as DaySnapshotV1["appSummaries"]).map((app) => ({
          ...app,
          iconBase64:
            typeof app.iconBase64 === "string" ? app.iconBase64 : undefined,
        }))
      : [],
    categoryTotals: Array.isArray(candidate.categoryTotals)
      ? (candidate.categoryTotals as DaySnapshotV1["categoryTotals"])
      : [],
    timeline: Array.isArray(candidate.timeline)
      ? (candidate.timeline as DaySnapshotV1["timeline"])
      : [],
    topDomains: Array.isArray(candidate.topDomains)
      ? (candidate.topDomains as DaySnapshotV1["topDomains"]).map((topDomain) => ({
          ...topDomain,
          topPages: Array.isArray(topDomain.topPages) ? topDomain.topPages : [],
        }))
      : [],
    categoryOverrides:
      candidate.categoryOverrides &&
      typeof candidate.categoryOverrides === "object" &&
      !Array.isArray(candidate.categoryOverrides)
        ? (candidate.categoryOverrides as DaySnapshotV1["categoryOverrides"])
        : {},
    aiSummary:
      typeof candidate.aiSummary === "string" ? candidate.aiSummary : null,
    focusSessions: Array.isArray(candidate.focusSessions)
      ? (candidate.focusSessions as StoredFocusSession[]).map(normalizeFocusSession)
      : [],
  };

  if (schemaVersion === 1) {
    return base;
  }

  return {
    ...base,
    schemaVersion: 2,
    focusScoreV2:
      candidate.focusScoreV2 &&
      typeof candidate.focusScoreV2 === "object"
        ? {
            deepWorkPct: focusScorePct(candidate.focusScoreV2, base.focusScore),
            longestStreakSeconds: longestStreakSeconds(candidate.focusScoreV2),
            switchCount: switchCount(candidate.focusScoreV2),
            deepWorkSessionCount: deepWorkSessionCount(candidate.focusScoreV2),
          }
        : {
            deepWorkPct: base.focusScore,
            longestStreakSeconds: 0,
            switchCount: 0,
            deepWorkSessionCount: 0,
          },
    workBlocks: Array.isArray(candidate.workBlocks)
      ? (candidate.workBlocks as DaySnapshotV2["workBlocks"])
      : [],
    recap:
      candidate.recap && typeof candidate.recap === "object"
        ? {
            day:
              (candidate.recap as { day?: RecapSummaryLite }).day ??
              emptyRecapSummary(),
            week:
              (candidate.recap as { week?: RecapSummaryLite | null }).week ?? null,
            month:
              (candidate.recap as { month?: RecapSummaryLite | null }).month ?? null,
          }
        : {
            day: emptyRecapSummary(),
            week: null,
            month: null,
          },
    coverage:
      candidate.coverage && typeof candidate.coverage === "object"
        ? (candidate.coverage as DaySnapshotV2["coverage"])
        : {
            attributedPct: 0,
            untitledPct: 0,
            activeDayCount: 0,
            quietDayCount: 0,
            hasComparison: false,
            coverageNote: null,
          },
    topWorkstreams: Array.isArray(candidate.topWorkstreams)
      ? (candidate.topWorkstreams as DaySnapshotV2["topWorkstreams"])
      : [],
    standoutArtifacts: Array.isArray(candidate.standoutArtifacts)
      ? (candidate.standoutArtifacts as DaySnapshotV2["standoutArtifacts"])
      : [],
    entities: Array.isArray(candidate.entities)
      ? (candidate.entities as DaySnapshotV2["entities"])
      : [],
    privacyFiltered:
      candidate.privacyFiltered === true ||
      candidate.hiddenByPreferences === true,
  };
}

function mergeTopPages(
  existingPages: NonNullable<DaySnapshotV1["topDomains"][number]["topPages"]>,
  nextPages: NonNullable<DaySnapshotV1["topDomains"][number]["topPages"]>
) {
  const pageMap = new Map<string, (typeof existingPages)[number]>();

  for (const page of [...existingPages, ...nextPages]) {
    const key = `${page.domain}|${page.label ?? ""}`;
    const existing = pageMap.get(key);
    if (existing) {
      existing.seconds += page.seconds;
      existing.label = existing.label || page.label || undefined;
    } else {
      pageMap.set(key, { ...page });
    }
  }

  return [...pageMap.values()]
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 5);
}

function mergeWorkstreams(snapshots: DaySnapshotV2[]): WorkstreamRollup[] {
  const workstreams = new Map<string, WorkstreamRollup>();
  for (const snapshot of snapshots) {
    for (const item of snapshot.topWorkstreams) {
      const existing = workstreams.get(item.label);
      if (existing) {
        existing.seconds += item.seconds;
        existing.blockCount += item.blockCount;
        existing.isUntitled = existing.isUntitled || item.isUntitled;
      } else {
        workstreams.set(item.label, { ...item });
      }
    }
  }
  return [...workstreams.values()]
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 8);
}

function mergeArtifacts(snapshots: DaySnapshotV2[]): ArtifactRollup[] {
  const artifacts = new Map<string, ArtifactRollup>();
  for (const snapshot of snapshots) {
    for (const artifact of snapshot.standoutArtifacts) {
      const existing = artifacts.get(artifact.id);
      if (!existing) {
        artifacts.set(artifact.id, { ...artifact });
        continue;
      }
      if (artifact.generatedAt > existing.generatedAt) {
        artifacts.set(artifact.id, { ...artifact });
      }
    }
  }
  return [...artifacts.values()]
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
    .slice(0, 8);
}

function mergeEntities(snapshots: DaySnapshotV2[]): EntityRollup[] {
  const entities = new Map<string, EntityRollup>();
  for (const snapshot of snapshots) {
    for (const entity of snapshot.entities) {
      const key = `${entity.kind}:${entity.id}`;
      const existing = entities.get(key);
      if (existing) {
        existing.secondsToday += entity.secondsToday;
        existing.blockCount += entity.blockCount;
      } else {
        entities.set(key, { ...entity });
      }
    }
  }
  return [...entities.values()]
    .sort((a, b) => b.secondsToday - a.secondsToday)
    .slice(0, 12);
}

function mergeFocusScoreV2(
  snapshots: DaySnapshotV2[],
  mergedAppSummaries: AppSummary[]
): DaySnapshotV2["focusScoreV2"] {
  const weighted = {
    deepWorkPct: 0,
    longestStreakSeconds: 0,
    switchCount: 0,
    deepWorkSessionCount: 0,
  };
  let totalWeight = 0;

  for (const snapshot of snapshots) {
    const weight = Math.max(
      1,
      snapshot.appSummaries.reduce((sum, app) => sum + app.totalSeconds, 0)
    );
    totalWeight += weight;
    weighted.deepWorkPct += focusScorePct(snapshot.focusScoreV2, snapshot.focusScore) * weight;
    weighted.longestStreakSeconds = Math.max(weighted.longestStreakSeconds, longestStreakSeconds(snapshot.focusScoreV2));
    weighted.switchCount += switchCount(snapshot.focusScoreV2);
    weighted.deepWorkSessionCount += deepWorkSessionCount(snapshot.focusScoreV2);
  }

  const totalTrackedSeconds = mergedAppSummaries.reduce(
    (sum, app) => sum + app.totalSeconds,
    0
  );

  return {
    deepWorkPct: totalTrackedSeconds <= 0 || totalWeight <= 0
      ? null
      : Math.round(weighted.deepWorkPct / totalWeight),
    longestStreakSeconds: weighted.longestStreakSeconds,
    switchCount: weighted.switchCount,
    deepWorkSessionCount: weighted.deepWorkSessionCount,
  };
}

function normalizeDomain(domain: string): string {
  return domain.replace(/^www\./, "").toLowerCase();
}

function isDomainHidden(domain: string, hiddenDomains: Set<string>) {
  const normalized = normalizeDomain(domain);
  for (const hidden of hiddenDomains) {
    if (normalized === hidden || normalized.endsWith(`.${hidden}`)) {
      return true;
    }
  }
  return false;
}

function hideRecapText(summary: RecapSummaryLite): RecapSummaryLite {
  return {
    ...summary,
    headline:
      "Some synced evidence is hidden or generalized by Daylens privacy protections.",
    chapters: summary.hasData
      ? [
          {
            id: "headline",
            eyebrow: "Privacy",
            title: "This recap is partially hidden",
            body:
              "Some evidence is hidden or generalized by privacy protections, so web recap copy is suppressed for this day.",
          },
        ]
      : [],
    promptChips: [],
    changeSummary: summary.hasData
      ? "Open this day on desktop for the full local recap if you need the richer unsynced context."
      : summary.changeSummary,
  };
}

function filterSnapshotForPreferences(
  snapshot: DaySnapshot,
  prefs: WorkspacePreferencesDoc
): DaySnapshot {
  if (!prefs) {
    return snapshot;
  }

  const hiddenApps = new Set(prefs.hiddenApps);
  const hiddenDomains = new Set(prefs.hiddenDomains.map(normalizeDomain));

  if (hiddenApps.size === 0 && hiddenDomains.size === 0) {
    return snapshot;
  }

  const filteredApps = snapshot.appSummaries.filter(
    (app) => !hiddenApps.has(app.appKey)
  );
  const filteredTimeline = snapshot.timeline.filter(
    (entry) => !hiddenApps.has(entry.appKey)
  );
  const filteredTopDomains = snapshot.topDomains.filter(
    (domain) => !isDomainHidden(domain.domain, hiddenDomains)
  );
  const filteredCategoryTotals = (() => {
    const totals = new Map<string, number>();
    for (const app of filteredApps) {
      totals.set(app.category, (totals.get(app.category) ?? 0) + app.totalSeconds);
    }
    return [...totals.entries()]
      .map(([category, totalSeconds]) => ({
        category: category as DaySnapshot["categoryTotals"][number]["category"],
        totalSeconds,
      }))
      .sort((a, b) => b.totalSeconds - a.totalSeconds);
  })();

  const preferenceFiltered =
    filteredApps.length !== snapshot.appSummaries.length ||
    filteredTimeline.length !== snapshot.timeline.length ||
    filteredTopDomains.length !== snapshot.topDomains.length;

  const focusSeconds = filteredApps
    .filter((app) => FOCUSED_CATEGORIES.has(app.category))
    .reduce((sum, app) => sum + app.totalSeconds, 0);
  const totalTrackedSeconds = filteredApps.reduce(
    (sum, app) => sum + app.totalSeconds,
    0
  );

  let switches = 0;
  for (let index = 1; index < filteredTimeline.length; index += 1) {
    if (filteredTimeline[index]?.appKey !== filteredTimeline[index - 1]?.appKey) {
      switches += 1;
    }
  }
  const hours = totalTrackedSeconds / 3600;
  const switchesPerHour = hours > 0 ? switches / hours : 0;

  if (snapshot.schemaVersion === 1) {
    return {
      ...snapshot,
      focusScore: computeFocusScore(
        focusSeconds,
        totalTrackedSeconds,
        switchesPerHour
      ),
      focusSeconds,
      appSummaries: filteredApps,
      categoryTotals: filteredCategoryTotals,
      timeline: filteredTimeline,
      topDomains: filteredTopDomains,
    };
  }

  let removedFromBlocks = false;
  const filteredWorkBlocks = snapshot.workBlocks.map((block) => {
    const topApps = block.topApps.filter((app) => !hiddenApps.has(app.appKey));
    const topPages = block.topPages.filter(
      (page) => !isDomainHidden(page.domain, hiddenDomains)
    );
    if (
      topApps.length !== block.topApps.length ||
      topPages.length !== block.topPages.length
    ) {
      removedFromBlocks = true;
    }
    return {
      ...block,
      topApps,
      topPages,
    };
  });

  return {
    ...snapshot,
    focusScore: computeFocusScore(
      focusSeconds,
      totalTrackedSeconds,
      switchesPerHour
    ),
    focusSeconds,
    appSummaries: filteredApps,
    categoryTotals: filteredCategoryTotals,
    timeline: filteredTimeline,
    topDomains: filteredTopDomains,
    workBlocks: filteredWorkBlocks,
    recap: preferenceFiltered || removedFromBlocks
      ? {
          day: hideRecapText(snapshot.recap.day),
          week: snapshot.recap.week ? hideRecapText(snapshot.recap.week) : null,
          month: snapshot.recap.month ? hideRecapText(snapshot.recap.month) : null,
        }
      : snapshot.recap,
    privacyFiltered:
      snapshot.privacyFiltered || preferenceFiltered || removedFromBlocks,
  };
}

async function loadWorkspaceDevices(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">
) {
  const devices = await ctx.db
    .query("devices")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .take(100);

  return new Map(devices.map((device) => [device.deviceId, device]));
}

async function loadWorkspacePreferences(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">
) {
  return await ctx.db
    .query("workspace_preferences")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .first();
}

function mergeSnapshots(
  docs: SnapshotDoc[],
  deviceMap: Map<string, DeviceDoc>
) {
  if (docs.length === 0) {
    return null;
  }

  const normalizedDocs = docs
    .map((doc) => ({ doc, snapshot: normalizeSnapshot(doc.snapshot) }))
    .filter(
      (entry): entry is { doc: SnapshotDoc; snapshot: DaySnapshot } =>
        entry.snapshot !== null
    )
    .sort((a, b) => parseGeneratedAtMs(a.snapshot) - parseGeneratedAtMs(b.snapshot));

  if (normalizedDocs.length === 0) {
    return null;
  }

  const latest = normalizedDocs[normalizedDocs.length - 1];
  const v2Snapshots = normalizedDocs
    .map(({ snapshot }) => snapshot)
    .filter((snapshot): snapshot is DaySnapshotV2 => snapshot.schemaVersion === 2);

  const appMap = new Map<string, DaySnapshot["appSummaries"][number]>();
  const topDomainMap = new Map<string, DaySnapshot["topDomains"][number]>();
  const categoryOverrides: DaySnapshot["categoryOverrides"] = {};
  const timeline = normalizedDocs
    .flatMap(({ snapshot }) => snapshot.timeline)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const focusSessions = normalizedDocs
    .flatMap(({ doc, snapshot }) =>
      snapshot.focusSessions.map((session) => ({
        ...session,
        sourceId: `${doc.deviceId}:${session.sourceId}`,
      }))
    )
    .sort((a, b) => a.startAt.localeCompare(b.startAt));

  for (const { snapshot } of normalizedDocs) {
    for (const app of snapshot.appSummaries) {
      const existing = appMap.get(app.appKey);
      if (existing) {
        existing.totalSeconds += app.totalSeconds;
        existing.sessionCount += app.sessionCount;
        existing.iconBase64 = existing.iconBase64 || app.iconBase64;
      } else {
        appMap.set(app.appKey, { ...app });
      }
    }

    for (const topDomain of snapshot.topDomains) {
      const key = `${topDomain.domain}:${topDomain.category}`;
      const existing = topDomainMap.get(key);
      if (existing) {
        existing.seconds += topDomain.seconds;
        existing.topPages = mergeTopPages(
          existing.topPages ?? [],
          topDomain.topPages ?? []
        );
      } else {
        topDomainMap.set(key, {
          ...topDomain,
          topPages: [...(topDomain.topPages ?? [])],
        });
      }
    }

    Object.assign(categoryOverrides, snapshot.categoryOverrides);
  }

  const appSummaries = [...appMap.values()].sort(
    (a, b) => b.totalSeconds - a.totalSeconds
  );
  const categoryTotalsMap = new Map<
    DaySnapshot["categoryTotals"][number]["category"],
    number
  >();
  for (const app of appSummaries) {
    categoryTotalsMap.set(
      app.category,
      (categoryTotalsMap.get(app.category) ?? 0) + app.totalSeconds
    );
  }
  const categoryTotals = [...categoryTotalsMap.entries()]
    .map(([category, totalSeconds]) => ({ category, totalSeconds }))
    .sort((a, b) => b.totalSeconds - a.totalSeconds);
  const topDomains = [...topDomainMap.values()]
    .map((topDomain) => ({
      ...topDomain,
      topPages: [...(topDomain.topPages ?? [])]
        .sort((a, b) => b.seconds - a.seconds)
        .slice(0, 5),
    }))
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 20);

  const focusSeconds = appSummaries
    .filter((app) => FOCUSED_CATEGORIES.has(app.category))
    .reduce((sum, app) => sum + app.totalSeconds, 0);
  const totalTrackedSeconds = appSummaries.reduce(
    (sum, app) => sum + app.totalSeconds,
    0
  );

  let switches = 0;
  for (let index = 1; index < timeline.length; index += 1) {
    if (timeline[index]?.appKey !== timeline[index - 1]?.appKey) {
      switches += 1;
    }
  }
  const hours = totalTrackedSeconds / 3600;
  const switchesPerHour = hours > 0 ? switches / hours : 0;
  const focusScore = computeFocusScore(
    focusSeconds,
    totalTrackedSeconds,
    switchesPerHour
  );

  const devices = normalizedDocs
    .map(({ doc, snapshot }) => {
      const device = deviceMap.get(doc.deviceId);
      return {
        deviceId: doc.deviceId,
        platform: (device?.platform ?? snapshot.platform) as Platform,
        displayName: device?.displayName ?? doc.deviceId,
        syncedAt: doc.syncedAt,
        generatedAt: snapshot.generatedAt,
      };
    })
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));

  const base = {
    _id: latest.doc._id,
    _creationTime: latest.doc._creationTime,
    workspaceId: latest.doc.workspaceId,
    localDate: latest.doc.localDate,
    syncedAt: Math.max(...normalizedDocs.map(({ doc }) => doc.syncedAt)),
    devices,
  };

  if (v2Snapshots.length === 0) {
    const mergedSnapshot: DaySnapshotV1 = {
      schemaVersion: 1,
      deviceId: latest.snapshot.deviceId,
      platform: latest.snapshot.platform,
      date: latest.snapshot.date,
      generatedAt: latest.snapshot.generatedAt,
      isPartialDay: normalizedDocs.some(({ snapshot }) => snapshot.isPartialDay),
      focusScore,
      focusSeconds,
      appSummaries,
      categoryTotals,
      timeline,
      topDomains,
      categoryOverrides,
      aiSummary:
        [...normalizedDocs]
          .reverse()
          .find(({ snapshot }) => snapshot.aiSummary)?.snapshot.aiSummary ?? null,
      focusSessions,
    };

    return {
      ...base,
      snapshot: mergedSnapshot,
    };
  }

  const workBlocks = v2Snapshots
    .flatMap((snapshot) => snapshot.workBlocks)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const latestV2 = v2Snapshots[v2Snapshots.length - 1]!;
  const mergedSnapshot: DaySnapshotV2 = {
    schemaVersion: 2,
    deviceId: latest.snapshot.deviceId,
    platform: latest.snapshot.platform,
    date: latest.snapshot.date,
    generatedAt: latest.snapshot.generatedAt,
    isPartialDay: normalizedDocs.some(({ snapshot }) => snapshot.isPartialDay),
    focusScore,
    focusSeconds,
    appSummaries,
    categoryTotals,
    timeline,
    topDomains,
    categoryOverrides,
    aiSummary:
      [...normalizedDocs]
        .reverse()
        .find(({ snapshot }) => snapshot.aiSummary)?.snapshot.aiSummary ?? null,
    focusSessions,
    focusScoreV2: mergeFocusScoreV2(v2Snapshots, appSummaries),
    workBlocks,
    recap: latestV2.recap,
    coverage: latestV2.coverage,
    topWorkstreams: mergeWorkstreams(v2Snapshots),
    standoutArtifacts: mergeArtifacts(v2Snapshots),
    entities: mergeEntities(v2Snapshots),
    privacyFiltered: false,
  };

  return {
    ...base,
    snapshot: mergedSnapshot,
  };
}

async function loadMergedSnapshotsForWorkspace(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">
) {
  const [docs, deviceMap, prefs] = await Promise.all([
    ctx.db
      .query("day_snapshots")
      .withIndex("by_workspace_date", (q) => q.eq("workspaceId", workspaceId))
      .take(MAX_SNAPSHOT_DOCS),
    loadWorkspaceDevices(ctx, workspaceId),
    loadWorkspacePreferences(ctx, workspaceId),
  ]);

  const grouped = new Map<string, SnapshotDoc[]>();
  for (const doc of docs) {
    const bucket = grouped.get(doc.localDate) ?? [];
    bucket.push(doc);
    grouped.set(doc.localDate, bucket);
  }

  return [...grouped.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([, dayDocs]) => mergeSnapshots(dayDocs, deviceMap))
    .filter((doc): doc is NonNullable<typeof doc> => doc !== null)
    .map((doc) => ({
      ...doc,
      snapshot: filterSnapshotForPreferences(doc.snapshot, prefs),
    }));
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireSessionIdentity(ctx);
    return await loadMergedSnapshotsForWorkspace(ctx, identity.workspaceId);
  },
});

export const listSummaries = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireSessionIdentity(ctx);
    const docs = await loadMergedSnapshotsForWorkspace(ctx, identity.workspaceId);

    return docs.map((doc) => ({
      _id: doc._id,
      localDate: doc.localDate,
      syncedAt: doc.syncedAt,
      snapshot: {
        schemaVersion: doc.snapshot.schemaVersion,
        focusScore:
          doc.snapshot.schemaVersion === 2
            ? focusScorePct(doc.snapshot.focusScoreV2, doc.snapshot.focusScore)
            : doc.snapshot.focusScore,
        focusSeconds: doc.snapshot.focusSeconds,
        appSummaries: doc.snapshot.appSummaries.map((app) => ({
          appKey: app.appKey,
        })),
        workBlocks:
          doc.snapshot.schemaVersion === 2
            ? doc.snapshot.workBlocks.map((block) => ({ id: block.id }))
            : [],
      },
    }));
  },
});

export const getByDate = query({
  args: {
    localDate: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await requireSessionIdentity(ctx);
    const [docs, deviceMap, prefs] = await Promise.all([
      ctx.db
        .query("day_snapshots")
        .withIndex("by_workspace_date", (q) =>
          q.eq("workspaceId", identity.workspaceId).eq("localDate", args.localDate)
        )
        .take(50),
      loadWorkspaceDevices(ctx, identity.workspaceId),
      loadWorkspacePreferences(ctx, identity.workspaceId),
    ]);

    const merged = mergeSnapshots(docs, deviceMap);
    if (!merged) {
      return null;
    }

    return {
      ...merged,
      snapshot: filterSnapshotForPreferences(merged.snapshot, prefs),
    };
  },
});

export const latestDate = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireSessionIdentity(ctx);
    const latest = await ctx.db
      .query("day_snapshots")
      .withIndex("by_workspace_date", (q) =>
        q.eq("workspaceId", identity.workspaceId)
      )
      .order("desc")
      .take(1);

    return latest[0]?.localDate ?? null;
  },
});

export const getAllByDate = query({
  args: {
    localDate: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await requireSessionIdentity(ctx);
    return await ctx.db
      .query("day_snapshots")
      .withIndex("by_workspace_date", (q) =>
        q.eq("workspaceId", identity.workspaceId).eq("localDate", args.localDate)
      )
      .take(50);
  },
});

export const getDateRange = query({
  args: {
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await requireSessionIdentity(ctx);
    const all = await loadMergedSnapshotsForWorkspace(ctx, identity.workspaceId);

    return all.filter(
      (snapshotDoc) =>
        snapshotDoc.localDate >= args.startDate &&
        snapshotDoc.localDate <= args.endDate
    );
  },
});

export const getByWorkspaceAndDate = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    localDate: v.string(),
  },
  handler: async (ctx, args) => {
    const [docs, deviceMap, prefs] = await Promise.all([
      ctx.db
        .query("day_snapshots")
        .withIndex("by_workspace_date", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("localDate", args.localDate)
        )
        .take(50),
      loadWorkspaceDevices(ctx, args.workspaceId),
      loadWorkspacePreferences(ctx, args.workspaceId),
    ]);

    const merged = mergeSnapshots(docs, deviceMap);
    if (!merged) {
      return null;
    }
    return {
      ...merged,
      snapshot: filterSnapshotForPreferences(merged.snapshot, prefs),
    };
  },
});

export const upload = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    deviceId: v.string(),
    localDate: v.string(),
    snapshot: daySnapshotValidator,
  },
  handler: async (ctx, args): Promise<string> => {
    const existing = await ctx.db
      .query("day_snapshots")
      .withIndex("by_workspace_device_date", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .eq("deviceId", args.deviceId)
          .eq("localDate", args.localDate)
      )
      .unique();

    if (existing) {
      const existingTs = parseGeneratedAtMs(existing.snapshot);
      const newTs = parseGeneratedAtMs(args.snapshot);
      if (newTs >= existingTs) {
        await ctx.db.patch(existing._id, {
          snapshot: args.snapshot,
          syncedAt: Date.now(),
        });
      }
      return existing._id;
    }

    return await ctx.db.insert("day_snapshots", {
      workspaceId: args.workspaceId,
      deviceId: args.deviceId,
      localDate: args.localDate,
      snapshot: args.snapshot,
      syncedAt: Date.now(),
    });
  },
});

export const recordSync = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    deviceId: v.string(),
  },
  handler: async (ctx, args) => {
    const device = await ctx.db
      .query("devices")
      .withIndex("by_workspace_and_device", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("deviceId", args.deviceId)
      )
      .unique();

    if (device) {
      await ctx.db.patch(device._id, { lastSyncAt: Date.now() });
    }
  },
});
