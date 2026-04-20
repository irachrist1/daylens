import { getSession } from "@/app/lib/session";
import { getConvexClient } from "@/app/lib/convex";
import { api } from "../../../../convex/_generated/api";
import { redirect } from "next/navigation";
import { ScoreRing } from "@/app/components/ScoreRing";
import { CategoryBar } from "@/app/components/CategoryBar";
import {
  formatDuration,
  formatFullDate,
  CATEGORY_LABELS,
} from "@/app/lib/format";
import Link from "next/link";
import { AppIcon } from "@/app/components/AppIcon";
import { TopSitesList } from "@/app/components/TopSitesList";

export default async function AppsPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const session = await getSession();
  if (!session) redirect("/");

  const client = getConvexClient(session.token);
  const snapshotDoc = await client.query(api.remoteSync.getTimelineDay, {
    localDate: date,
  });

  const snapshot = snapshotDoc?.snapshot;

  if (!snapshot) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 px-4 py-4 sm:px-6 sm:py-8 sm:space-y-6">
        <Link href="/dashboard" className="text-sm text-primary hover:underline">
          &larr; Timeline
        </Link>
        <h1 className="text-2xl font-bold">{formatFullDate(date)}</h1>
        <div className="rounded-2xl glass-card p-8 text-center">
          <p className="text-on-surface-variant">No data for this day.</p>
        </div>
      </div>
    );
  }

  const apps = snapshot.appSummaries || [];
  const categoryTotals = snapshot.categoryTotals || [];
  const topDomains = (snapshot.topDomains || []).slice(0, 10);

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-4 sm:px-6 sm:py-8 sm:space-y-6">
      <Link href="/dashboard" className="text-sm text-primary hover:underline">
        &larr; Timeline
      </Link>
      <h1 className="text-2xl font-bold">{formatFullDate(date)}</h1>

      {/* Score + Stats */}
      <div className="flex items-center gap-4 sm:gap-6 rounded-2xl glass-card p-4 sm:p-6">
        <ScoreRing score={snapshot.focusScore || 0} />
        <div className="flex-1 space-y-3">
          <div>
            <span className="text-[0.6875rem] font-semibold tracking-wide uppercase text-on-surface-variant">
              Focus Time
            </span>
            <p className="text-xl font-bold">
              {formatDuration(snapshot.focusSeconds || 0)}
            </p>
          </div>
          <div>
            <span className="text-[0.6875rem] font-semibold tracking-wide uppercase text-on-surface-variant">
              Total Apps
            </span>
            <p className="text-xl font-bold">{apps.length}</p>
          </div>
          {(snapshot.focusSessions?.length || 0) > 0 && (
            <Link
              href={`/focus/${date}`}
              className="inline-block text-xs text-primary hover:underline"
            >
              {snapshot.focusSessions.length} focus sessions &rarr;
            </Link>
          )}
        </div>
      </div>

      {/* Categories */}
      {categoryTotals.length > 0 && (
        <section className="rounded-2xl glass-card p-4 sm:p-6 space-y-4">
          <h2 className="text-lg font-semibold">Categories</h2>
          <CategoryBar totals={categoryTotals} />
        </section>
      )}

      {/* All Apps */}
      <section className="rounded-2xl glass-card p-4 sm:p-6 space-y-3">
        <h2 className="text-lg font-semibold">All Apps</h2>
        <div className="space-y-3">
          {apps.map(
            (app: {
              appKey: string;
              bundleID?: string;
              displayName: string;
              category: string;
              totalSeconds: number;
              sessionCount: number;
              iconBase64?: string | null;
            }) => (
              <div
                key={app.appKey}
                className="flex items-center justify-between gap-4"
              >
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
                  <p className="text-sm font-medium">
                    {formatDuration(app.totalSeconds)}
                  </p>
                  <p className="text-[0.6875rem] text-on-surface-variant">
                    {app.sessionCount} sessions
                  </p>
                </div>
              </div>
            )
          )}
        </div>
      </section>

      {/* Top Domains */}
      {topDomains.length > 0 && (
        <section className="rounded-2xl glass-card p-4 sm:p-6 space-y-3">
          <h2 className="text-lg font-semibold">Top Sites</h2>
          <TopSitesList domains={topDomains} showCategory />
        </section>
      )}

      {/* AI Summary */}
      {snapshot.aiSummary && (
        <section className="rounded-2xl glass-card p-4 sm:p-6 space-y-3">
          <h2 className="text-lg font-semibold">AI Summary</h2>
          <p className="text-sm leading-relaxed text-on-surface/90">
            {snapshot.aiSummary}
          </p>
        </section>
      )}

    </div>
  );
}
