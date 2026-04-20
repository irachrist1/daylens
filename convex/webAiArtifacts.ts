import {
  action,
  internalMutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireSessionIdentity } from "./authHelpers";
import {
  createWorkspaceArtifactId,
  type DaySnapshotV2,
  type WorkspaceAIArtifact,
  type WorkspaceAIThread,
} from "../packages/remote-contract/index";

type GeneratedOutputKind = "report" | "csv" | "chart";
type GeneratedArtifactsResult = {
  threadId: string;
  userContent: string;
  assistantContent: string;
  artifacts: WorkspaceAIArtifact[];
};

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatLongDate(localDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${localDate}T12:00:00`));
}

function formatShortDate(localDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${localDate}T12:00:00`));
}

function formatTimeRange(startAt: string, endAt: string): string {
  const start = new Date(startAt);
  const end = new Date(endAt);
  return `${start.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })} - ${end.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function blockDurationMinutes(startAt: string, endAt: string): number {
  const durationMs = Date.parse(endAt) - Date.parse(startAt);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return 0;
  }
  return Math.round(durationMs / 60_000);
}

function csvCell(value: string | number): string {
  const raw = String(value ?? "");
  if (!/[",\n]/.test(raw)) return raw;
  return `"${raw.replace(/"/g, "\"\"")}"`;
}

function buildCsvContent(columns: string[], rows: Array<Record<string, string | number>>): string {
  const header = columns.map(csvCell).join(",");
  const body = rows.map((row) => columns.map((column) => csvCell(row[column] ?? "")).join(","));
  return [header, ...body].join("\n");
}

function buildBarChartHtml(
  title: string,
  subtitle: string,
  valueLabel: string,
  rows: Array<{ label: string; value: number }>,
): string {
  const maxValue = Math.max(1, ...rows.map((row) => row.value));
  const rowMarkup = rows
    .slice(0, 10)
    .map((row) => {
      const widthPct = Math.max(6, Math.round((row.value / maxValue) * 100));
      return `
        <div class="row">
          <div class="label">${row.label}</div>
          <div class="bar-wrap"><div class="bar" style="width:${widthPct}%"></div></div>
          <div class="value">${row.value.toFixed(1)} ${valueLabel}</div>
        </div>
      `;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f3eb;
        --surface: #ffffff;
        --text: #171717;
        --muted: #666052;
        --primary: #0f766e;
        --border: rgba(23, 23, 23, 0.08);
      }
      body {
        margin: 0;
        font-family: "SF Pro Text", "Segoe UI", sans-serif;
        background: linear-gradient(180deg, #fbfaf7 0%, var(--bg) 100%);
        color: var(--text);
      }
      main {
        max-width: 920px;
        margin: 0 auto;
        padding: 32px 24px 40px;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 28px;
        line-height: 1.1;
      }
      p {
        margin: 0;
        color: var(--muted);
        line-height: 1.6;
      }
      .chart {
        margin-top: 24px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 20px;
        padding: 18px;
        box-shadow: 0 18px 40px rgba(23, 23, 23, 0.06);
      }
      .row {
        display: grid;
        grid-template-columns: 170px minmax(0, 1fr) 92px;
        gap: 14px;
        align-items: center;
        margin-bottom: 14px;
      }
      .label, .value {
        font-size: 13px;
      }
      .bar-wrap {
        height: 20px;
        border-radius: 999px;
        background: #ebe6d9;
        overflow: hidden;
      }
      .bar {
        height: 100%;
        border-radius: 999px;
        background: linear-gradient(90deg, #14b8a6 0%, var(--primary) 100%);
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${subtitle}</p>
      <section class="chart">
        ${rowMarkup || "<p>No chartable workstream data was available for this day.</p>"}
      </section>
    </main>
  </body>
</html>`;
}

function buildReportMarkdown(snapshot: DaySnapshotV2, localDate: string): string {
  const topWorkstreams = snapshot.topWorkstreams.slice(0, 5);
  const entities = snapshot.entities.slice(0, 5);
  const standoutArtifacts = snapshot.standoutArtifacts.slice(0, 5);
  const workBlocks = snapshot.workBlocks.slice(0, 8);
  const headline = snapshot.recap.day.hasData
    ? snapshot.recap.day.headline
    : `Daylens tracked ${formatDuration(snapshot.focusSeconds)} of focused work across ${snapshot.workBlocks.length} work blocks.`;

  return [
    `# ${formatLongDate(localDate)} work report`,
    "",
    headline,
    "",
    "## At a glance",
    `- Focus time: ${formatDuration(snapshot.focusSeconds)}`,
    `- Focus score: ${snapshot.focusScoreV2.score}/100`,
    `- Work blocks: ${snapshot.workBlocks.length}`,
    `- Top workstream: ${topWorkstreams[0]?.label ?? "No named workstream yet"}`,
    "",
    "## Top workstreams",
    ...(topWorkstreams.length > 0
      ? topWorkstreams.map((item) => `- ${item.label}: ${formatDuration(item.seconds)} across ${item.blockCount} blocks`)
      : ["- No named workstreams were synced for this day."]),
    "",
    "## Key blocks",
    ...(workBlocks.length > 0
      ? workBlocks.map((block) =>
          `- ${formatTimeRange(block.startAt, block.endAt)} — ${block.label} (${formatDuration(block.focusSeconds)} focus, ${block.topApps.map((app) => app.appKey).slice(0, 3).join(", ") || "no clear app mix"})`
        )
      : ["- No synced work blocks were available."]),
    "",
    "## Entities",
    ...(entities.length > 0
      ? entities.map((entity) => `- ${entity.label} (${entity.kind}): ${formatDuration(entity.secondsToday)} across ${entity.blockCount} blocks`)
      : ["- No routed entities were available for this day."]),
    "",
    "## Standout artifacts",
    ...(standoutArtifacts.length > 0
      ? standoutArtifacts.map((artifact) => `- ${artifact.title} (${artifact.kind})`)
      : ["- No standout artifacts were synced for this day."]),
    "",
    "Generated remotely from synced Daylens evidence.",
  ].join("\n");
}

function buildBlockCsv(snapshot: DaySnapshotV2): string {
  const columns = [
    "block_id",
    "start_at",
    "end_at",
    "duration_minutes",
    "label",
    "focus_minutes",
    "dominant_category",
    "confidence",
    "top_apps",
    "top_pages",
    "artifact_ids",
  ];
  const rows = snapshot.workBlocks.map((block) => ({
    block_id: block.id,
    start_at: block.startAt,
    end_at: block.endAt,
    duration_minutes: blockDurationMinutes(block.startAt, block.endAt),
    label: block.label,
    focus_minutes: Math.round((block.focusSeconds ?? 0) / 60),
    dominant_category: block.dominantCategory,
    confidence: block.confidence,
    top_apps: block.topApps.map((app) => app.appKey).join(" | "),
    top_pages: block.topPages.map((page) => page.label || page.domain).join(" | "),
    artifact_ids: block.artifactIds.join(" | "),
  }));
  return buildCsvContent(columns, rows);
}

function buildAssistantSummary(
  snapshot: DaySnapshotV2,
  localDate: string,
  outputs: GeneratedOutputKind[],
): string {
  const created = outputs.map((output) => {
    switch (output) {
      case "csv":
        return "a CSV export";
      case "chart":
        return "an HTML workstream chart";
      default:
        return "a shareable Markdown report";
    }
  });
  const artifactLabel = created.length === 1
    ? created[0]
    : `${created.slice(0, -1).join(", ")}, and ${created[created.length - 1]}`;

  return [
    `I generated ${artifactLabel} for ${formatLongDate(localDate)}.`,
    `The export covers ${formatDuration(snapshot.focusSeconds)} of focused work across ${snapshot.workBlocks.length} synced work blocks.`,
    snapshot.topWorkstreams.length > 0
      ? `Top workstreams: ${snapshot.topWorkstreams.slice(0, 3).map((item) => item.label).join(", ")}.`
      : "No strong named workstreams were synced for that day, so the exports stay conservative.",
  ].join(" ");
}

function buildUserRequest(localDate: string, outputs: GeneratedOutputKind[]) {
  const parts = outputs.map((output) => {
    switch (output) {
      case "csv":
        return "CSV export";
      case "chart":
        return "HTML chart";
      default:
        return "shareable report";
    }
  });
  return `Create a ${parts.join(" and ")} for ${formatShortDate(localDate)}.`;
}

export const storeArtifact = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    workspaceThreadId: v.string(),
    artifact: v.object({
      workspaceArtifactId: v.string(),
      workspaceThreadId: v.string(),
      workspaceMessageId: v.union(v.string(), v.null()),
      title: v.string(),
      kind: v.union(
        v.literal("markdown"),
        v.literal("csv"),
        v.literal("json_table"),
        v.literal("html_chart"),
        v.literal("report"),
      ),
      createdAt: v.number(),
      storageId: v.union(v.string(), v.null()),
      textContent: v.union(v.string(), v.null()),
    }),
  },
  handler: async (ctx, args): Promise<WorkspaceAIArtifact> => {
    await ctx.db.insert("web_ai_artifacts", {
      workspaceId: args.workspaceId,
      threadId: args.workspaceThreadId,
      artifactId: args.artifact.workspaceArtifactId,
      createdAt: args.artifact.createdAt,
      artifact: args.artifact,
    });
    return args.artifact;
  },
});

export const listRecent = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireSessionIdentity(ctx);
    const docs = await ctx.db
      .query("web_ai_artifacts")
      .withIndex("by_workspace_created", (q) => q.eq("workspaceId", identity.workspaceId))
      .order("desc")
      .take(20);
    return docs.map((doc) => doc.artifact);
  },
});

export const listByThread = query({
  args: {
    workspaceThreadId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await requireSessionIdentity(ctx);
    const docs = await ctx.db
      .query("web_ai_artifacts")
      .withIndex("by_workspace_thread_created", (q) =>
        q.eq("workspaceId", identity.workspaceId).eq("threadId", args.workspaceThreadId)
      )
      .order("desc")
      .take(20);
    return docs.map((doc) => doc.artifact);
  },
});

export const getArtifact = query({
  args: {
    workspaceArtifactId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await requireSessionIdentity(ctx);
    const doc = await ctx.db
      .query("web_ai_artifacts")
      .withIndex("by_workspace_artifact", (q) =>
        q.eq("workspaceId", identity.workspaceId).eq("artifactId", args.workspaceArtifactId)
      )
      .unique();
    return doc?.artifact ?? null;
  },
});

export const generateDayArtifacts = action({
  args: {
    localDate: v.string(),
    workspaceThreadId: v.optional(v.string()),
    outputs: v.optional(v.array(v.union(v.literal("report"), v.literal("csv"), v.literal("chart")))),
  },
  handler: async (ctx, args): Promise<GeneratedArtifactsResult> => {
    const identity = await requireSessionIdentity(ctx);
    const snapshotDoc = await ctx.runQuery(internal.remoteSync.getTimelineDayForWorkspace, {
      workspaceId: identity.workspaceId,
      localDate: args.localDate,
    });

    if (!snapshotDoc?.snapshot || snapshotDoc.snapshot.schemaVersion !== 2) {
      throw new Error("No synced activity data is available for that day.");
    }

    const snapshot = snapshotDoc.snapshot;
    const requestedOutputs = Array.from(new Set((args.outputs ?? ["report"]) as GeneratedOutputKind[]));
    const thread: WorkspaceAIThread = await ctx.runMutation(internal.webAiThreads.ensureThread, {
      workspaceId: identity.workspaceId,
      workspaceThreadId: args.workspaceThreadId,
      title: `Reports for ${formatShortDate(args.localDate)}`,
      source: "web",
    });

    const userContent = buildUserRequest(args.localDate, requestedOutputs);
    const assistantContent = buildAssistantSummary(snapshot, args.localDate, requestedOutputs);
    const appendedTurn = await ctx.runMutation(internal.webAiThreads.appendTurn, {
      workspaceId: identity.workspaceId,
      workspaceThreadId: thread.workspaceThreadId,
      userContent,
      assistantContent,
      provider: null,
      model: null,
      failureReason: null,
    });
    const assistantMessageId = appendedTurn.messages[1]?.workspaceMessageId ?? null;
    const createdAt = Date.now();
    const artifacts: WorkspaceAIArtifact[] = [];

    if (requestedOutputs.includes("report")) {
      artifacts.push(await ctx.runMutation(internal.webAiArtifacts.storeArtifact, {
        workspaceId: identity.workspaceId,
        workspaceThreadId: thread.workspaceThreadId,
        artifact: {
          workspaceArtifactId: createWorkspaceArtifactId(),
          workspaceThreadId: thread.workspaceThreadId,
          workspaceMessageId: assistantMessageId,
          title: `${formatShortDate(args.localDate)} shareable report`,
          kind: "report",
          createdAt,
          storageId: null,
          textContent: buildReportMarkdown(snapshot, args.localDate),
        },
      }));
    }

    if (requestedOutputs.includes("csv")) {
      artifacts.push(await ctx.runMutation(internal.webAiArtifacts.storeArtifact, {
        workspaceId: identity.workspaceId,
        workspaceThreadId: thread.workspaceThreadId,
        artifact: {
          workspaceArtifactId: createWorkspaceArtifactId(),
          workspaceThreadId: thread.workspaceThreadId,
          workspaceMessageId: assistantMessageId,
          title: `${formatShortDate(args.localDate)} work blocks`,
          kind: "csv",
          createdAt: createdAt + 1,
          storageId: null,
          textContent: buildBlockCsv(snapshot),
        },
      }));
    }

    if (requestedOutputs.includes("chart")) {
      artifacts.push(await ctx.runMutation(internal.webAiArtifacts.storeArtifact, {
        workspaceId: identity.workspaceId,
        workspaceThreadId: thread.workspaceThreadId,
        artifact: {
          workspaceArtifactId: createWorkspaceArtifactId(),
          workspaceThreadId: thread.workspaceThreadId,
          workspaceMessageId: assistantMessageId,
          title: `${formatShortDate(args.localDate)} workstreams chart`,
          kind: "html_chart",
          createdAt: createdAt + 2,
          storageId: null,
          textContent: buildBarChartHtml(
            `${formatShortDate(args.localDate)} workstreams`,
            `Generated from synced Daylens evidence for ${formatLongDate(args.localDate)}.`,
            "min",
            snapshot.topWorkstreams.slice(0, 8).map((item: DaySnapshotV2["topWorkstreams"][number]) => ({
              label: item.label,
              value: Number((item.seconds / 60).toFixed(1)),
            })),
          ),
        },
      }));
    }
    return {
      threadId: thread.workspaceThreadId,
      userContent,
      assistantContent,
      artifacts,
    };
  },
});
