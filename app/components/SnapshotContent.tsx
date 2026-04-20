import { ScoreRing } from "@/app/components/ScoreRing";
import { CategoryBar } from "@/app/components/CategoryBar";
import { formatDuration, CATEGORY_LABELS } from "@/app/lib/format";
import Link from "next/link";
import { AppIcon } from "@/app/components/AppIcon";
import { TopSitesList, type TopDomainItem } from "@/app/components/TopSitesList";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SnapshotShape = Record<string, any>;

interface SnapshotContentProps {
  snapshot: SnapshotShape;
  date: string;
  showAllApps?: boolean;
}

function blockDurationSeconds(block: {
  startAt?: string;
  endAt?: string;
}): number {
  const start = Date.parse(block.startAt ?? "");
  const end = Date.parse(block.endAt ?? "");
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 0;
  }
  return Math.round((end - start) / 1000);
}

function formatTimeRange(startAt?: string, endAt?: string): string {
  const start = startAt ? new Date(startAt) : null;
  const end = endAt ? new Date(endAt) : null;
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return "";
  }
  return `${start.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })} - ${end.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function readFocusScore(snapshot: SnapshotShape): number {
  return typeof snapshot.focusScoreV2?.score === "number"
    ? snapshot.focusScoreV2.score
    : snapshot.focusScore || 0;
}

function v2FocusMetric(snapshot: SnapshotShape, key: string): string | null {
  const value = snapshot.focusScoreV2?.[key];
  if (typeof value !== "number") return null;
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

export function SnapshotContent({
  snapshot,
  date,
  showAllApps = false,
}: SnapshotContentProps) {
  const allApps = snapshot.appSummaries || [];
  const topApps = showAllApps ? allApps : allApps.slice(0, 8);
  const categoryTotals = snapshot.categoryTotals || [];
  const topDomains: TopDomainItem[] = (snapshot.topDomains || []).slice(
    0,
    showAllApps ? 10 : 5
  );
  const focusSessions = snapshot.focusSessions || [];
  const workBlocks = snapshot.workBlocks || [];
  const topWorkstreams = snapshot.topWorkstreams || [];
  const entities = snapshot.entities || [];
  const recap = snapshot.recap?.day || null;
  const coverageNote = snapshot.coverage?.coverageNote || null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-6 rounded-2xl glass-card p-6">
        <ScoreRing score={readFocusScore(snapshot)} />
        <div className="flex-1 grid gap-3 sm:grid-cols-2">
          <div>
            <span className="text-[0.6875rem] font-semibold tracking-wide uppercase text-on-surface-variant">
              Focus Time
            </span>
            <p className="text-xl font-bold">{formatDuration(snapshot.focusSeconds || 0)}</p>
          </div>
          <div>
            <span className="text-[0.6875rem] font-semibold tracking-wide uppercase text-on-surface-variant">
              Work Blocks
            </span>
            <p className="text-xl font-bold">{workBlocks.length || 0}</p>
          </div>
          <div>
            <span className="text-[0.6875rem] font-semibold tracking-wide uppercase text-on-surface-variant">
              Top Workstream
            </span>
            <p className="text-base font-semibold">
              {topWorkstreams[0]?.label || "No named workstream yet"}
            </p>
          </div>
          <div>
            <span className="text-[0.6875rem] font-semibold tracking-wide uppercase text-on-surface-variant">
              Entities
            </span>
            <p className="text-xl font-bold">{entities.length}</p>
          </div>
          {snapshot.isPartialDay && (
            <span className="inline-block rounded bg-primary-container/20 px-2 py-0.5 text-[0.6875rem] font-medium text-primary">
              In progress
            </span>
          )}
          {snapshot.privacyFiltered && (
            <span className="inline-block rounded bg-warning/10 px-2 py-0.5 text-[0.6875rem] font-medium text-warning">
              Some synced evidence is privacy-limited
            </span>
          )}
        </div>
      </div>

      {recap?.hasData && (
        <section className="rounded-2xl glass-card p-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">Daily recap</h2>
              <p className="text-sm leading-relaxed text-on-surface/90">
                {recap.headline}
              </p>
            </div>
            <Link
              href={`/recap?date=${date}`}
              className="text-xs text-primary hover:underline"
            >
              Open recap
            </Link>
          </div>

          {coverageNote ? (
            <div className="rounded-xl bg-warning/10 px-3 py-2 text-sm text-on-surface/85">
              {coverageNote}
            </div>
          ) : null}

          <div className="space-y-3">
            {recap.chapters.map((chapter: SnapshotShape, index: number) => (
              <div key={`${chapter.id}-${index}`} className="rounded-xl bg-surface-low px-4 py-3">
                <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-on-surface-variant">
                  {chapter.eyebrow}
                </p>
                <p className="mt-1 text-sm font-semibold text-on-surface">{chapter.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-on-surface/85">{chapter.body}</p>
              </div>
            ))}
          </div>

          {Array.isArray(recap.metrics) && recap.metrics.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {recap.metrics.map((metric: SnapshotShape, index: number) => (
                <div key={`${metric.label}-${index}`} className="rounded-xl bg-surface-low px-4 py-3">
                  <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-on-surface-variant">
                    {metric.label}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-on-surface">{metric.value}</p>
                  <p className="mt-1 text-sm text-on-surface-variant">{metric.detail}</p>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      )}

      {workBlocks.length > 0 && (
        <section className="rounded-2xl glass-card p-6 space-y-3">
          <h2 className="text-lg font-semibold">Work Blocks</h2>
          <div className="space-y-3">
            {workBlocks.slice(0, 10).map((block: SnapshotShape) => {
              const duration = blockDurationSeconds(block);
              return (
                <div key={block.id} className="rounded-xl bg-surface-low px-4 py-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="break-words text-sm font-semibold text-on-surface">
                        {block.label}
                      </p>
                      <p className="mt-1 text-xs text-on-surface-variant">
                        {formatTimeRange(block.startAt, block.endAt)}
                        {duration > 0 ? ` · ${formatDuration(duration)}` : ""}
                        {typeof block.switchCount === "number"
                          ? ` · ${block.switchCount} switches`
                          : ""}
                      </p>
                    </div>
                    <span className="rounded-full bg-primary/10 px-2 py-1 text-[0.6875rem] font-medium text-primary">
                      {formatDuration(block.focusSeconds || 0)} focus
                    </span>
                  </div>

                  {(block.topApps?.length || block.topPages?.length) ? (
                    <div className="mt-3 space-y-1 text-xs text-on-surface-variant">
                      {block.topApps?.length ? (
                        <p>
                          Apps:{" "}
                          {block.topApps
                            .map((app: SnapshotShape) => app.appKey)
                            .join(", ")}
                        </p>
                      ) : null}
                      {block.topPages?.length ? (
                        <p>
                          Pages:{" "}
                          {block.topPages
                            .map((page: SnapshotShape) => page.label || page.domain)
                            .join(", ")}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {(topWorkstreams.length > 0 || entities.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-2">
          {topWorkstreams.length > 0 && (
            <section className="rounded-2xl glass-card p-6 space-y-3">
              <h2 className="text-lg font-semibold">Top Workstreams</h2>
              <div className="space-y-3">
                {topWorkstreams.slice(0, 6).map((item: SnapshotShape, index: number) => (
                  <div key={`${item.label}-${index}`} className="flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-on-surface">{item.label}</p>
                      <p className="text-[0.6875rem] text-on-surface-variant">
                        {item.blockCount} blocks
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-medium text-on-surface">
                      {formatDuration(item.seconds || 0)}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {entities.length > 0 && (
            <section className="rounded-2xl glass-card p-6 space-y-3">
              <h2 className="text-lg font-semibold">Entities</h2>
              <div className="space-y-3">
                {entities.slice(0, 6).map((entity: SnapshotShape, index: number) => (
                  <div key={`${entity.kind}-${entity.id}-${index}`} className="flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-on-surface">{entity.label}</p>
                      <p className="text-[0.6875rem] text-on-surface-variant">
                        {entity.kind}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-medium text-on-surface">
                      {formatDuration(entity.secondsToday || 0)}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {snapshot.focusScoreV2 && (
        <section className="rounded-2xl glass-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Focus Score V2</h2>
            <Link href={`/chat?date=${date}`} className="text-xs text-primary hover:underline">
              Ask AI about this
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Coherence", v2FocusMetric(snapshot, "coherence")],
              ["Deep work", v2FocusMetric(snapshot, "deepWorkDensity")],
              ["Artifact progress", v2FocusMetric(snapshot, "artifactProgress")],
              ["Switch penalty", v2FocusMetric(snapshot, "switchPenalty")],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-surface-low px-4 py-3">
                <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-on-surface-variant">
                  {label}
                </p>
                <p className="mt-1 text-lg font-semibold text-on-surface">{value || "0%"}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {categoryTotals.length > 0 && (
        <section className="rounded-2xl glass-card p-6 space-y-4">
          <h2 className="text-lg font-semibold">Categories</h2>
          <CategoryBar totals={categoryTotals} />
        </section>
      )}

      {topApps.length > 0 && (
        <section className="rounded-2xl glass-card p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              {showAllApps ? "All Apps" : "Supporting Apps"}
            </h2>
            {!showAllApps && (
              <Link href={`/apps/${date}`} className="text-xs text-primary hover:underline">
                View all
              </Link>
            )}
          </div>
          <div className="space-y-3">
            {topApps.map((app: SnapshotShape) => (
              <div key={app.appKey} className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <AppIcon
                    bundleID={app.bundleID || app.appKey}
                    displayName={app.displayName}
                    category={app.category}
                    iconBase64={app.iconBase64}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{app.displayName}</p>
                    <p className="text-[0.6875rem] text-on-surface-variant">
                      {CATEGORY_LABELS[app.category] || app.category}
                    </p>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-medium">{formatDuration(app.totalSeconds)}</p>
                  <p className="text-[0.6875rem] text-on-surface-variant">
                    {app.sessionCount} sessions
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {topDomains.length > 0 && (
        <section className="rounded-2xl glass-card p-6 space-y-3">
          <h2 className="text-lg font-semibold">Top Sites</h2>
          <TopSitesList domains={topDomains} showCategory={showAllApps} />
        </section>
      )}

      {focusSessions.length > 0 && (
        <Link
          href={`/focus/${date}`}
          className="block rounded-2xl glass-card p-6 card-hover"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Focus Sessions</h2>
            <span className="text-sm text-primary">{focusSessions.length} sessions</span>
          </div>
        </Link>
      )}

      {snapshot.aiSummary && (
        <section className="rounded-2xl glass-card p-6 space-y-3">
          <h2 className="text-lg font-semibold">AI Summary</h2>
          <p className="text-sm leading-relaxed text-on-surface/90">{snapshot.aiSummary}</p>
        </section>
      )}
    </div>
  );
}
