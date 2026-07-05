"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SyncBanner } from "@/app/components/SyncBanner";
import { TimelineSurface } from "@/app/components/TimelineSurface";
import { apiPath } from "@/app/lib/basePath";
import {
  buildSurfaceHref,
  formatRangeLabel,
  getRangeBounds,
  parseSurfaceRange,
  shiftRangeAnchor,
  todayLocalDate,
  type SurfaceRange,
} from "@/app/lib/range";
import type { DaySnapshot, DaySnapshotV2 } from "../../../packages/remote-contract";
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

function ChevronLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 2.5 4.5 7 9 11.5" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 2.5 9.5 7 5 11.5" />
    </svg>
  );
}

export function DashboardClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [today] = useState(todayLocalDate);
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotDoc[] | undefined>(undefined);
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceStatus | null>(null);

  const range = parseSurfaceRange(searchParams.get("range"));
  const dateParam = searchParams.get("date");
  const selectedDate = dateParam ?? availableDates[0] ?? today;

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

        if (!dateParam) {
          const todaySnapshot = summaries.find((snapshot) => snapshot.localDate === today);
          const fallbackDate = todaySnapshot?.localDate ?? summaries[0]?.localDate ?? today;
          router.replace(buildSurfaceHref(pathname, fallbackDate, range));
        }
      })
      .catch(() => {
        if (!cancelled) setAvailableDates([]);
      });

    return () => { cancelled = true; };
  }, [dateParam, pathname, range, router, today]);

  useEffect(() => {
    let cancelled = false;
    void fetch(apiPath("/api/workspace-status"))
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => {
        if (!cancelled) setWorkspaceStatus((json?.status as WorkspaceStatus | undefined) ?? null);
      })
      .catch(() => {
        if (!cancelled) setWorkspaceStatus(null);
      });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedDate) return;
    let cancelled = false;
    setSnapshots(undefined);

    const request =
      range === "day"
        ? apiPath(`/api/snapshots?date=${selectedDate}`)
        : (() => {
            const { from, to } = getRangeBounds(selectedDate, range);
            return apiPath(`/api/snapshots?from=${from}&to=${to}`);
          })();

    void fetch(request)
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => {
        if (cancelled) return;
        if (range === "day") {
          setSnapshots(json?.snapshot ? [json.snapshot as SnapshotDoc] : []);
        } else {
          setSnapshots(Array.isArray(json?.snapshots) ? json.snapshots : []);
        }
      })
      .catch(() => {
        if (!cancelled) setSnapshots([]);
      });

    return () => { cancelled = true; };
  }, [range, selectedDate]);

  const validSnapshots = useMemo(
    () =>
      (snapshots ?? []).filter(
        (doc): doc is SnapshotDoc & { snapshot: DaySnapshotV2 } =>
          Boolean(doc?.snapshot && isSnapshotV2(doc.snapshot)),
      ),
    [snapshots],
  );

  const earliestDate = availableDates.length > 0 ? availableDates[availableDates.length - 1] ?? today : today;
  const canGoPrev = selectedDate > earliestDate;
  const canGoNext = selectedDate < today;
  const includesToday = selectedDate <= today && getRangeBounds(selectedDate, range).to >= today;
  const liveLabel = includesToday ? workspaceStatus?.latestPresence?.currentBlockLabel ?? null : null;

  function navigate(nextDate: string, nextRange = range) {
    router.replace(buildSurfaceHref(pathname, nextDate, nextRange));
  }

  const showSyncWarning =
    workspaceStatus !== null &&
    (workspaceStatus.health === "failed" || workspaceStatus.health === "pending_first_sync");

  const topbar = (
    <div className="timeline-topbar">
      <div className="timeline-topbar__date">
        <button
          type="button"
          onClick={() => navigate(shiftRangeAnchor(selectedDate, range, -1))}
          disabled={!canGoPrev}
          aria-label="Previous"
          className="timeline-topbar__arrow"
        >
          <ChevronLeft />
        </button>
        <span>{selectedDate === today && range === "day" ? "Today" : formatRangeLabel(selectedDate, range)}</span>
        <button
          type="button"
          onClick={() => navigate(shiftRangeAnchor(selectedDate, range, 1))}
          disabled={!canGoNext}
          aria-label="Next"
          className="timeline-topbar__arrow"
        >
          <ChevronRight />
        </button>
      </div>

      <div className="daylens-segmented">
        {(["day", "week"] as SurfaceRange[]).map((option) => (
          <button
            key={option}
            type="button"
            className={option === range ? "is-active" : ""}
            onClick={() => navigate(selectedDate, option)}
          >
            {option[0].toUpperCase() + option.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );

  if (snapshots === undefined) {
    return (
      <div className="timeline-shell-outer">
        <div className="timeline-page-shell">
          {topbar}
          <div className="timeline-empty">
            <h2>Loading timeline</h2>
            <p>Rebuilding the proof surface for this range.</p>
          </div>
        </div>
      </div>
    );
  }

  if (validSnapshots.length === 0) {
    return (
      <div className="timeline-shell-outer">
        <div className="timeline-page-shell">
          {topbar}
          {showSyncWarning && <SyncBanner status={workspaceStatus} />}
          <div className="timeline-empty">
            <h2>No data for this range</h2>
            <p>Only days synced from your desktop app appear here. Switch to <strong>Day</strong> view to see today&apos;s activity.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="timeline-shell-outer">
      <div className="timeline-page-shell">
        {topbar}
        {showSyncWarning && <SyncBanner status={workspaceStatus} />}
        <TimelineSurface
          snapshots={validSnapshots.map((snapshot) => ({
            localDate: snapshot.localDate,
            snapshot: snapshot.snapshot,
          }))}
          anchorDate={selectedDate}
          range={range}
          liveLabel={liveLabel}
        />
      </div>
    </div>
  );
}
