"use client";

import { useEffect, useState } from "react";
import { ScoreRing } from "@/app/components/ScoreRing";
import { CategoryBar } from "@/app/components/CategoryBar";
import {
  formatDate,
  formatDuration,
  formatRelativeTime,
  CATEGORY_LABELS,
} from "@/app/lib/format";
import { AppIcon } from "@/app/components/AppIcon";
import { TopSitesList, type TopDomainItem } from "@/app/components/TopSitesList";
import Link from "next/link";

interface AppSummary {
  appKey: string;
  bundleID?: string;
  displayName: string;
  category: string;
  totalSeconds: number;
  sessionCount: number;
  iconBase64?: string | null;
}

interface Snapshot {
  schemaVersion?: number;
  focusScore: number;
  focusSeconds: number;
  isPartialDay?: boolean;
  hiddenByPreferences?: boolean;
  appSummaries: AppSummary[];
  categoryTotals: { category: string; totalSeconds: number }[];
  topDomains: TopDomainItem[];
  focusSessions?: { sourceId: string }[];
  focusScoreV2?: {
    score: number;
    coherence: number;
    deepWorkDensity: number;
    artifactProgress: number;
    switchPenalty: number;
  };
  workBlocks?: Array<{
    id: string;
    startAt: string;
    endAt: string;
    label: string;
    focusSeconds: number;
    switchCount: number;
    topApps: Array<{ appKey: string; seconds: number }>;
    topPages: Array<{ domain: string; title: string | null; seconds: number }>;
  }>;
  recap?: {
    day?: {
      headline: string;
      hasData: boolean;
      chapters: Array<{ id: string; eyebrow: string; title: string; body: string }>;
      metrics: Array<{ label: string; value: string; detail: string }>;
    };
  };
  coverage?: {
    coverageNote?: string | null;
  };
  topWorkstreams?: Array<{ label: string; seconds: number; blockCount: number }>;
  entities?: Array<{ id: string; label: string; kind: string; secondsToday: number }>;
}

interface SnapshotDoc {
  snapshot: Snapshot;
  syncedAt?: number;
  localDate: string;
}

interface SnapshotSummaryDoc {
  _id: string;
  localDate: string;
  syncedAt?: number;
  snapshot: {
    schemaVersion?: number;
    focusScore: number;
    focusSeconds: number;
    appSummaries: { appKey: string }[];
    workBlocks?: { id: string }[];
  } | null;
}

function getLocalDate(): string {
  return new Date().toLocaleDateString("en-CA");
}

/** Strip www. and lowercase so "www.YouTube.com" → "youtube.com" */
function normalizeDomain(domain: string): string {
  return domain.replace(/^www\./, "").toLowerCase();
}

/**
 * Returns true if `domain` should be hidden.
 * Hiding "youtube.com" also hides "music.youtube.com", "m.youtube.com", etc.
 */
function isDomainHidden(domain: string, hiddenDomains: Set<string>): boolean {
  const normalized = normalizeDomain(domain);
  for (const hidden of hiddenDomains) {
    const h = normalizeDomain(hidden);
    if (normalized === h) return true;
    if (normalized.endsWith(`.${h}`)) return true;
  }
  return false;
}

function shiftDate(date: string, deltaDays: number) {
  const nextDate = new Date(`${date}T12:00:00`);
  nextDate.setDate(nextDate.getDate() + deltaDays);
  return nextDate.toLocaleDateString("en-CA");
}

function readFocusScore(snapshot: Snapshot | null | undefined): number {
  return snapshot?.focusScoreV2?.score ?? snapshot?.focusScore ?? 0;
}

function blockDurationSeconds(block: { startAt: string; endAt: string }) {
  const duration = Date.parse(block.endAt) - Date.parse(block.startAt);
  return Number.isFinite(duration) && duration > 0 ? Math.round(duration / 1000) : 0;
}

export function DashboardClient() {
  const [today] = useState(getLocalDate);
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [data, setData] = useState<SnapshotDoc | null | undefined>(undefined);
  const [isInitialLatestFallback, setIsInitialLatestFallback] = useState(false);
  const [hiddenApps, setHiddenApps] = useState<Set<string>>(new Set());
  const [hiddenDomains, setHiddenDomains] = useState<Set<string>>(new Set());

  useEffect(() => {
    void fetch("/api/preferences")
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({})) as { error?: string };
          console.error("[preferences] load failed:", body.error ?? r.status);
          return null;
        }
        return r.json() as Promise<{ hiddenApps: string[]; hiddenDomains: string[] }>;
      })
      .then((prefs) => {
        if (prefs) {
          setHiddenApps(new Set(prefs.hiddenApps ?? []));
          setHiddenDomains(new Set((prefs.hiddenDomains ?? []).map(normalizeDomain)));
        }
      })
      .catch(() => {});
  }, []);

  function hideApp(appKey: string) {
    setHiddenApps((prev) => new Set([...prev, appKey]));
    void fetch("/api/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "hideApp", appKey }),
    }).then((res) => {
      if (!res.ok) {
        console.error("[hideApp] save failed: HTTP", res.status);
        throw new Error("save failed");
      }
    }).catch(() => {
      setHiddenApps((prev) => {
        const next = new Set(prev);
        next.delete(appKey);
        return next;
      });
    });
  }

  function hideCurrentDomain(domain: string) {
    const normalized = normalizeDomain(domain);
    setHiddenDomains((prev) => new Set([...prev, normalized]));
    void fetch("/api/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "hideDomain", domain: normalized }),
    }).then((res) => {
      if (!res.ok) {
        console.error("[hideDomain] save failed: HTTP", res.status);
        throw new Error("save failed");
      }
    }).catch(() => {
      setHiddenDomains((prev) => {
        const next = new Set(prev);
        next.delete(normalized);
        return next;
      });
    });
  }

  useEffect(() => {
    let cancelled = false;

    void fetch("/api/snapshots")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled) return;

        const summaries: SnapshotSummaryDoc[] = Array.isArray(json?.summaries)
          ? [...json.summaries].sort((a, b) => b.localDate.localeCompare(a.localDate))
          : [];

        setAvailableDates(summaries.map((snapshot) => snapshot.localDate));

        if (summaries.length === 0) {
          setSelectedDate(today);
          setData(null);
          setIsInitialLatestFallback(false);
          return;
        }

        const todaySnapshot = summaries.find((snapshot) => snapshot.localDate === today);
        const initialDate = todaySnapshot?.localDate ?? summaries[0]!.localDate;
        setSelectedDate(initialDate);
        setData(undefined);
        setIsInitialLatestFallback(initialDate !== today);
      })
      .catch(() => {
        if (cancelled) return;
        setAvailableDates([]);
        setSelectedDate(today);
        setData(null);
        setIsInitialLatestFallback(false);
      });

    return () => {
      cancelled = true;
    };
  }, [today]);

  useEffect(() => {
    if (!selectedDate) {
      return;
    }

    if (data && data.localDate === selectedDate) {
      return;
    }

    let cancelled = false;
    setData(undefined);

    void fetch(`/api/snapshots?date=${selectedDate}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled) return;
        setData(json?.snapshot ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setData(null);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedDate]);

  // Poll for fresh data every 60s
  useEffect(() => {
    if (!selectedDate) return;

    const poll = () => {
      void fetch(`/api/snapshots?date=${selectedDate}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (json?.snapshot) {
            setData(json.snapshot);
            if (json.snapshot.localDate === today) {
              setIsInitialLatestFallback(false);
            }
            // Add to available dates if new
            setAvailableDates((prev) =>
              prev.includes(selectedDate) ? prev : [...prev, selectedDate].sort((a, b) => b.localeCompare(a))
            );
          }
        })
        .catch(() => {});
    };

    const interval = window.setInterval(poll, 60_000);
    return () => window.clearInterval(interval);
  }, [selectedDate, today]);

  if (!selectedDate || data === undefined) {
    return (
      <div className="px-4 sm:px-6 py-6 sm:py-8 max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
        <div className="rounded-2xl glass-card p-4 sm:p-6 animate-pulse h-40" />
      </div>
    );
  }

  const snapshot = data?.snapshot;
  const isToday = selectedDate === today;
  const topApps = (snapshot?.appSummaries || [])
    .filter((app) => !hiddenApps.has(app.appKey))
    .slice(0, 8);
  const categoryTotals = snapshot?.categoryTotals || [];
  const topDomains = (snapshot?.topDomains || [])
    .filter((d) => !isDomainHidden(d.domain, hiddenDomains))
    .slice(0, 5);
  const hiddenCount = hiddenApps.size + hiddenDomains.size;
  const earliestDate =
    availableDates.length > 0 ? availableDates[availableDates.length - 1]! : today;
  const canGoPrev = selectedDate > earliestDate;
  const canGoNext = selectedDate < today;

  function selectDate(nextDate: string) {
    setIsInitialLatestFallback(false);
    setSelectedDate(nextDate);
  }

  if (!snapshot) {
    return (
      <div className="px-4 sm:px-6 py-6 sm:py-8 max-w-2xl mx-auto space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">
              {isToday ? "Today" : formatDate(selectedDate)}
            </h1>
            <p className="text-sm text-on-surface-variant mt-1">
              No activity data for {selectedDate}.
            </p>
          </div>
          <Link
            href={`/chat?date=${selectedDate}`}
            className="rounded-full border border-outline-variant/20 px-3 py-1.5 text-sm text-on-surface hover:bg-surface-low"
          >
            Ask AI
          </Link>
        </div>

        <div className="flex items-center justify-between rounded-2xl glass-card p-3">
          <button
            type="button"
            onClick={() => selectDate(shiftDate(selectedDate, -1))}
            disabled={!canGoPrev}
            className="rounded-full px-3 py-1.5 text-sm text-on-surface hover:bg-surface-high disabled:opacity-40"
          >
            Previous day
          </button>
          <span className="text-sm font-medium text-on-surface">
            {isToday ? "Today" : formatDate(selectedDate)}
          </span>
          <button
            type="button"
            onClick={() => selectDate(shiftDate(selectedDate, 1))}
            disabled={!canGoNext}
            className="rounded-full px-3 py-1.5 text-sm text-on-surface hover:bg-surface-high disabled:opacity-40"
          >
            Next day
          </button>
        </div>

        <div className="rounded-2xl glass-card p-4 sm:p-6 text-center space-y-2">
          {availableDates.length > 0 ? (
            <p className="text-on-surface-variant">
              No activity was synced for this day.
            </p>
          ) : (
            <>
              <p className="text-on-surface-variant">
                Daylens hasn&apos;t synced any days yet.
              </p>
              <p className="text-sm text-on-surface-variant/60">
                Keep the desktop app running and linked to start syncing.
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 py-4 sm:py-8 max-w-2xl mx-auto space-y-4 sm:space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {isToday ? "Today" : formatDate(selectedDate)}
          </h1>
          {isInitialLatestFallback ? (
            <p className="text-xs text-on-surface-variant mt-0.5">
              No data for {today}. Showing the latest synced day instead.
            </p>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <Link
              href={`/chat?date=${selectedDate}`}
              className="rounded-full border border-outline-variant/20 px-3 py-1.5 text-sm text-on-surface hover:bg-surface-low"
            >
              Ask AI
            </Link>
            <Link
              href={`/recap?date=${selectedDate}`}
              className="rounded-full border border-outline-variant/20 px-3 py-1.5 text-sm text-on-surface hover:bg-surface-low"
            >
              Recap
            </Link>
          </div>
          {data.syncedAt ? (
            <span className="text-xs text-on-surface-variant">
              Synced {formatRelativeTime(data.syncedAt)}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-between rounded-2xl glass-card p-3">
        <button
          type="button"
          onClick={() => selectDate(shiftDate(selectedDate, -1))}
          disabled={!canGoPrev}
          className="rounded-full px-3 py-1.5 text-sm text-on-surface hover:bg-surface-high disabled:opacity-40"
        >
          Previous day
        </button>
        <span className="text-sm font-medium text-on-surface">
          {isToday ? "Today" : formatDate(selectedDate)}
        </span>
        <button
          type="button"
          onClick={() => selectDate(shiftDate(selectedDate, 1))}
          disabled={!canGoNext}
          className="rounded-full px-3 py-1.5 text-sm text-on-surface hover:bg-surface-high disabled:opacity-40"
        >
          Next day
        </button>
      </div>

      <div className="flex items-center gap-4 sm:gap-6 rounded-2xl glass-card p-4 sm:p-6">
        <ScoreRing score={readFocusScore(snapshot)} size={100} />
        <div className="flex-1 space-y-3">
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
            <p className="text-xl font-bold">{snapshot.workBlocks?.length ?? 0}</p>
          </div>
          {snapshot.isPartialDay && (
            <span className="inline-block rounded bg-primary-container/20 px-2 py-0.5 text-[0.6875rem] font-medium text-primary">
              In progress
            </span>
          )}
          {snapshot.hiddenByPreferences && (
            <span className="inline-block rounded bg-warning/10 px-2 py-0.5 text-[0.6875rem] font-medium text-warning">
              Some apps and sites are hidden
            </span>
          )}
        </div>
      </div>

      {snapshot.recap?.day?.hasData && (
        <section className="rounded-2xl glass-card p-4 sm:p-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Daily Recap</h2>
              <p className="mt-1 text-sm leading-relaxed text-on-surface/90">
                {snapshot.recap.day.headline}
              </p>
            </div>
            <Link href={`/recap?date=${selectedDate}`} className="text-xs text-primary hover:underline">
              Open full recap
            </Link>
          </div>
          {snapshot.coverage?.coverageNote ? (
            <div className="rounded-xl bg-warning/10 px-3 py-2 text-sm text-on-surface/85">
              {snapshot.coverage.coverageNote}
            </div>
          ) : null}
          <div className="space-y-3">
            {snapshot.recap.day.chapters.slice(0, 3).map((chapter) => (
              <div key={chapter.id} className="rounded-xl bg-surface-low px-4 py-3">
                <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-on-surface-variant">
                  {chapter.eyebrow}
                </p>
                <p className="mt-1 text-sm font-semibold text-on-surface">{chapter.title}</p>
                <p className="mt-1 text-sm text-on-surface/85">{chapter.body}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {(snapshot.workBlocks?.length || 0) > 0 && (
        <section className="rounded-2xl glass-card p-4 sm:p-6 space-y-3">
          <h2 className="text-lg font-semibold">Work Blocks</h2>
          <div className="space-y-3">
            {snapshot.workBlocks!.slice(0, 8).map((block) => (
              <div key={block.id} className="rounded-xl bg-surface-low px-4 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-on-surface">{block.label}</p>
                    <p className="mt-1 text-[0.6875rem] text-on-surface-variant">
                      {formatDuration(blockDurationSeconds(block))} · {block.switchCount} switches
                    </p>
                  </div>
                  <span className="rounded-full bg-primary/10 px-2 py-1 text-[0.6875rem] font-medium text-primary">
                    {formatDuration(block.focusSeconds)} focus
                  </span>
                </div>
                {(block.topApps.length || block.topPages.length) > 0 && (
                  <div className="mt-3 space-y-1 text-[0.6875rem] text-on-surface-variant">
                    {block.topApps.length > 0 && (
                      <p>Apps: {block.topApps.map((app) => app.appKey).join(", ")}</p>
                    )}
                    {block.topPages.length > 0 && (
                      <p>
                        Pages: {block.topPages.map((page) => page.title || page.domain).join(", ")}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {((snapshot.topWorkstreams?.length || 0) > 0 || (snapshot.entities?.length || 0) > 0) && (
        <div className="grid gap-4 sm:gap-6 sm:grid-cols-2">
          {(snapshot.topWorkstreams?.length || 0) > 0 && (
            <section className="rounded-2xl glass-card p-4 sm:p-6 space-y-3">
              <h2 className="text-lg font-semibold">Top Workstreams</h2>
              <div className="space-y-3">
                {snapshot.topWorkstreams!.slice(0, 5).map((item) => (
                  <div key={item.label} className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-on-surface">{item.label}</p>
                      <p className="text-[0.6875rem] text-on-surface-variant">
                        {item.blockCount} blocks
                      </p>
                    </div>
                    <p className="text-sm font-medium text-on-surface">
                      {formatDuration(item.seconds)}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {(snapshot.entities?.length || 0) > 0 && (
            <section className="rounded-2xl glass-card p-4 sm:p-6 space-y-3">
              <h2 className="text-lg font-semibold">Entities</h2>
              <div className="space-y-3">
                {snapshot.entities!.slice(0, 5).map((entity) => (
                  <div key={`${entity.kind}-${entity.id}`} className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-on-surface">{entity.label}</p>
                      <p className="text-[0.6875rem] text-on-surface-variant">{entity.kind}</p>
                    </div>
                    <p className="text-sm font-medium text-on-surface">
                      {formatDuration(entity.secondsToday)}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {categoryTotals.length > 0 && (
        <section className="rounded-2xl glass-card p-4 sm:p-6 space-y-4">
          <h2 className="text-lg font-semibold">Categories</h2>
          <CategoryBar totals={categoryTotals} />
        </section>
      )}

      {topApps.length > 0 && (
        <section className="rounded-2xl glass-card p-4 sm:p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Supporting Apps</h2>
            <Link
              href={`/apps/${selectedDate}`}
              className="text-xs text-primary hover:underline"
            >
              View all
            </Link>
          </div>
          <div className="space-y-3">
            {topApps.map((app) => (
              <div key={app.appKey} className="group flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <AppIcon
                    bundleID={app.bundleID || app.appKey}
                    displayName={app.displayName}
                    category={app.category}
                    iconBase64={app.iconBase64}
                  />
                  <div>
                    <p className="text-sm font-medium">{app.displayName}</p>
                    <p className="text-[0.6875rem] text-on-surface-variant">
                      {CATEGORY_LABELS[app.category] || app.category}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => hideApp(app.appKey)}
                    className="rounded px-2 py-0.5 text-[0.6875rem] text-on-surface-variant opacity-0 transition-opacity hover:text-error group-hover:opacity-100"
                    aria-label={`Hide ${app.displayName}`}
                  >
                    Hide
                  </button>
                  <div className="text-right">
                    <p className="text-sm font-medium">{formatDuration(app.totalSeconds)}</p>
                    <p className="text-[0.6875rem] text-on-surface-variant">
                      {app.sessionCount} sessions
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {hiddenCount > 0 && (
            <p className="text-center text-[0.6875rem] text-on-surface-variant">
              {hiddenCount} item{hiddenCount === 1 ? "" : "s"} hidden ·{" "}
              <Link href="/settings#privacy" className="text-primary hover:underline">
                Manage
              </Link>
            </p>
          )}
        </section>
      )}

      {topDomains.length > 0 && (
        <section className="rounded-2xl glass-card p-4 sm:p-6 space-y-3">
          <h2 className="text-lg font-semibold">Top Sites</h2>
          <TopSitesList domains={topDomains} onHideDomain={hideCurrentDomain} />
        </section>
      )}

      {(snapshot.focusSessions?.length || 0) > 0 && (
        <Link
          href={`/focus/${selectedDate}`}
          className="block rounded-2xl glass-card p-4 sm:p-6 card-hover"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Focus Sessions</h2>
            <span className="text-sm text-primary">{snapshot.focusSessions!.length} sessions</span>
          </div>
        </Link>
      )}
    </div>
  );
}
