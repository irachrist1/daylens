"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SyncBanner } from "@/app/components/SyncBanner";
import { TimelineSurface } from "@/app/components/TimelineSurface";
import { apiPath } from "@/app/lib/basePath";
import { formatDate, formatRelativeTime } from "@/app/lib/format";
import type { DaySnapshot } from "../../../packages/remote-contract";
import { isSnapshotV2 } from "../../../packages/remote-contract";

interface SnapshotDoc {
  snapshot: DaySnapshot;
  syncedAt?: number;
  localDate: string;
}

interface SnapshotSummaryDoc {
  _id: string;
  localDate: string;
}

interface WorkspaceStatus {
  health: "pending_first_sync" | "healthy" | "stale" | "failed";
  lastHeartbeatAt?: number | null;
  lastSuccessfulSyncAt?: number | null;
  latestPresence?: {
    state: string;
    heartbeatAt: number;
    currentBlockLabel?: string | null;
  } | null;
  latestFailure?: {
    reason: string;
    detail?: string | null;
  } | null;
}

function getLocalDate(): string {
  return new Date().toLocaleDateString("en-CA");
}

function normalizeDomain(domain: string): string {
  return domain.replace(/^www\./, "").toLowerCase();
}

function isDomainHidden(domain: string, hiddenDomains: Set<string>): boolean {
  const normalized = normalizeDomain(domain);
  for (const hidden of hiddenDomains) {
    const candidate = normalizeDomain(hidden);
    if (normalized === candidate || normalized.endsWith(`.${candidate}`)) {
      return true;
    }
  }
  return false;
}

function shiftDate(date: string, deltaDays: number) {
  const nextDate = new Date(`${date}T12:00:00`);
  nextDate.setDate(nextDate.getDate() + deltaDays);
  return nextDate.toLocaleDateString("en-CA");
}

function filterSnapshot(snapshot: DaySnapshot, hiddenApps: Set<string>, hiddenDomains: Set<string>): DaySnapshot {
  const filteredAppSummaries = snapshot.appSummaries.filter((app) => !hiddenApps.has(app.appKey));
  const filteredTopDomains = snapshot.topDomains.filter((domain) => !isDomainHidden(domain.domain, hiddenDomains));

  if (!isSnapshotV2(snapshot)) {
    return {
      ...snapshot,
      appSummaries: filteredAppSummaries,
      topDomains: filteredTopDomains,
    };
  }

  const filteredWorkBlocks = snapshot.workBlocks.map((block) => ({
    ...block,
    topApps: block.topApps.filter((app) => !hiddenApps.has(app.appKey)),
    topPages: block.topPages.filter((page) => !isDomainHidden(page.domain, hiddenDomains)),
  }));

  return {
    ...snapshot,
    appSummaries: filteredAppSummaries,
    topDomains: filteredTopDomains,
    workBlocks: filteredWorkBlocks,
  };
}

export function DashboardClient() {
  const [today] = useState(getLocalDate);
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [data, setData] = useState<SnapshotDoc | null | undefined>(undefined);
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceStatus | null>(null);
  const [isInitialLatestFallback, setIsInitialLatestFallback] = useState(false);
  const [hiddenApps, setHiddenApps] = useState<Set<string>>(new Set());
  const [hiddenDomains, setHiddenDomains] = useState<Set<string>>(new Set());

  useEffect(() => {
    void fetch(apiPath("/api/preferences"))
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json() as Promise<{ hiddenApps: string[]; hiddenDomains: string[] }>;
      })
      .then((prefs) => {
        if (!prefs) return;
        setHiddenApps(new Set(prefs.hiddenApps ?? []));
        setHiddenDomains(new Set((prefs.hiddenDomains ?? []).map(normalizeDomain)));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;

    void fetch(apiPath("/api/snapshots"))
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => {
        if (cancelled) return;
        const summaries: SnapshotSummaryDoc[] = Array.isArray(json?.summaries)
          ? [...json.summaries].sort((left, right) => right.localDate.localeCompare(left.localDate))
          : [];

        setAvailableDates(summaries.map((snapshot) => snapshot.localDate));

        if (summaries.length === 0) {
          setSelectedDate(today);
          setData(null);
          setIsInitialLatestFallback(false);
          return;
        }

        const todaySnapshot = summaries.find((snapshot) => snapshot.localDate === today);
        const initialDate = todaySnapshot?.localDate ?? summaries[0]?.localDate ?? today;
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
    let cancelled = false;

    void fetch(apiPath("/api/workspace-status"))
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => {
        if (cancelled) return;
        setWorkspaceStatus((json?.status as WorkspaceStatus | undefined) ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setWorkspaceStatus(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedDate) return;
    if (data && data.localDate === selectedDate) return;

    let cancelled = false;
    setData(undefined);

    void fetch(apiPath(`/api/snapshots?date=${selectedDate}`))
      .then((response) => (response.ok ? response.json() : null))
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

  useEffect(() => {
    if (!selectedDate) return;

    const poll = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }

      void fetch(apiPath(`/api/snapshots?date=${selectedDate}`))
        .then((response) => (response.ok ? response.json() : null))
        .then((json) => {
          if (json?.snapshot) {
            setData(json.snapshot);
            if (json.snapshot.localDate === today) {
              setIsInitialLatestFallback(false);
            }
            setAvailableDates((prev) =>
              prev.includes(selectedDate)
                ? prev
                : [...prev, selectedDate].sort((left, right) => right.localeCompare(left)),
            );
          }
        })
        .catch(() => {});

      void fetch(apiPath("/api/workspace-status"))
        .then((response) => (response.ok ? response.json() : null))
        .then((json) => {
          setWorkspaceStatus((json?.status as WorkspaceStatus | undefined) ?? null);
        })
        .catch(() => {});
    };

    poll();
    const interval = window.setInterval(poll, selectedDate === today ? 15_000 : 30_000);
    return () => window.clearInterval(interval);
  }, [selectedDate, today]);

  if (!selectedDate || data === undefined) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="timeline-page-shell">
          <div className="timeline-empty timeline-empty--loading">
            <h2>Loading timeline</h2>
            <p>Pulling the latest synced day and rebuilding the proof surface.</p>
          </div>
        </div>
      </div>
    );
  }

  const snapshot = data?.snapshot ? filterSnapshot(data.snapshot, hiddenApps, hiddenDomains) : null;
  const isToday = selectedDate === today;
  const earliestDate = availableDates.length > 0 ? availableDates[availableDates.length - 1] ?? today : today;
  const canGoPrev = selectedDate > earliestDate;
  const canGoNext = selectedDate < today;

  function selectDate(nextDate: string) {
    setSelectedDate(nextDate);
    setIsInitialLatestFallback(false);
  }

  if (!snapshot) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="timeline-page-shell">
          <div className="timeline-topbar">
            <div className="timeline-topbar__date">
              <button type="button" onClick={() => selectDate(shiftDate(selectedDate, -1))} disabled={!canGoPrev}>
                Previous
              </button>
              <span>{isToday ? "Today" : formatDate(selectedDate)}</span>
              <button type="button" onClick={() => selectDate(shiftDate(selectedDate, 1))} disabled={!canGoNext}>
                Next
              </button>
            </div>
          </div>

          <div className="timeline-empty">
            <h2>No synced activity for this day</h2>
            <p>Keep Daylens running on your laptop and linked to this workspace to let the next durable snapshot land here.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isSnapshotV2(snapshot)) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="timeline-page-shell">
          <div className="timeline-empty">
            <h2>This synced day needs the newer timeline format</h2>
            <p>Daylens Web can only render the proof-first timeline once the desktop app syncs a schema v2 snapshot for this date.</p>
          </div>
        </div>
      </div>
    );
  }

  const liveLabel = isToday ? workspaceStatus?.latestPresence?.currentBlockLabel ?? null : null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="timeline-page-shell">
        <div className="timeline-topbar">
          <div className="timeline-topbar__date">
            <button type="button" onClick={() => selectDate(shiftDate(selectedDate, -1))} disabled={!canGoPrev}>
              Previous
            </button>
            <span>{isToday ? "Today" : formatDate(selectedDate)}</span>
            <button type="button" onClick={() => selectDate(shiftDate(selectedDate, 1))} disabled={!canGoNext}>
              Next
            </button>
          </div>

          <div className="timeline-topbar__actions">
            {!isToday ? (
              <button type="button" className="daylens-secondary-button" onClick={() => selectDate(today)}>
                Today
              </button>
            ) : null}
            <Link href={`/apps/${selectedDate}`} className="daylens-secondary-button">
              Apps
            </Link>
            <Link href={`/chat?date=${selectedDate}`} className="daylens-secondary-button">
              Ask AI
            </Link>
          </div>
        </div>

        <div className="timeline-subhead">
          <div>
            <h1>{isToday ? "Timeline" : formatDate(selectedDate)}</h1>
            {isInitialLatestFallback ? (
              <p>No synced day exists for today yet, so this is showing the latest durable day instead.</p>
            ) : data?.syncedAt ? (
              <p>Durably synced {formatRelativeTime(data.syncedAt)}.</p>
            ) : (
              <p>The timeline is grounded in the latest synced day payload for this date.</p>
            )}
          </div>
          <SyncBanner status={workspaceStatus} />
        </div>

        <TimelineSurface snapshot={snapshot} date={selectedDate} liveLabel={liveLabel} />
      </div>
    </div>
  );
}
