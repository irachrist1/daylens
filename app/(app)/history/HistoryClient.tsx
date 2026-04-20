"use client";

import { useEffect, useState } from "react";
import {
  formatDate,
  formatDuration,
  formatFullDate,
} from "@/app/lib/format";
import Link from "next/link";
import { SnapshotContent } from "@/app/components/SnapshotContent";

interface SnapshotDoc {
  _id: string;
  localDate: string;
  syncedAt?: number;
  snapshot: {
    focusScore: number;
    focusSeconds: number;
    appSummaries: { appKey: string }[];
    focusScoreV2?: { score: number };
    workBlocks?: { id: string }[];
  } | null;
}

function getLocalDate(): string {
  return new Date().toLocaleDateString("en-CA");
}

function getYesterday(): string {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date.toLocaleDateString("en-CA");
}

function shiftDate(date: string, deltaDays: number) {
  const nextDate = new Date(`${date}T12:00:00`);
  nextDate.setDate(nextDate.getDate() + deltaDays);
  return nextDate.toLocaleDateString("en-CA");
}

function dateLabel(localDate: string, today: string, yesterday: string): string {
  if (localDate === today) return "Today";
  if (localDate === yesterday) return "Yesterday";
  return formatDate(localDate);
}

function readFocusScore(snapshot: SnapshotDoc["snapshot"]): number {
  return snapshot?.focusScoreV2?.score ?? snapshot?.focusScore ?? 0;
}

export function HistoryClient() {
  const [today] = useState(getLocalDate);
  const [yesterday] = useState(getYesterday);
  const [snapshots, setSnapshots] = useState<SnapshotDoc[] | undefined>(undefined);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void fetch("/api/snapshots")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled) return;

        const list = Array.isArray(json?.summaries)
          ? [...json.summaries].sort((a, b) => b.localDate.localeCompare(a.localDate))
          : [];

        setSnapshots(list);
        setSelectedDate(
          list.find((snapshot) => snapshot.localDate === today)?.localDate ??
            list[0]?.localDate ??
            null
        );
      })
      .catch(() => {
        if (cancelled) return;
        setSnapshots([]);
        setSelectedDate(null);
      });

    return () => {
      cancelled = true;
    };
  }, [today]);

  if (snapshots === undefined) {
    return (
      <div className="px-4 sm:px-6 py-4 sm:py-8 max-w-2xl mx-auto space-y-4">
        <h1 className="text-2xl font-bold">History</h1>
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl glass-card p-4 animate-pulse h-16" />
          ))}
        </div>
      </div>
    );
  }

  if (snapshots.length === 0) {
    return (
      <div className="px-4 sm:px-6 py-4 sm:py-8 max-w-2xl mx-auto space-y-4 sm:space-y-6">
        <h1 className="text-2xl font-bold">History</h1>
        <div className="rounded-2xl glass-card p-4 sm:p-6 text-center">
          <p className="text-on-surface-variant">No synced days yet.</p>
          <p className="mt-2 text-sm text-on-surface-variant/60">
            Daylens will sync automatically when it&apos;s running on your computer.
          </p>
        </div>
      </div>
    );
  }

  const selectedSnapshot =
    snapshots.find((snapshot) => snapshot.localDate === selectedDate) ?? null;
  const earliestDate = snapshots[snapshots.length - 1]?.localDate ?? today;
  const canGoPrev = selectedDate ? selectedDate > earliestDate : false;
  const canGoNext = selectedDate ? selectedDate < today : false;

  return (
    <div className="px-4 sm:px-6 py-4 sm:py-8 max-w-3xl mx-auto space-y-4 sm:space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">History</h1>
          {selectedDate ? (
            <p className="mt-1 text-sm text-on-surface-variant">
              {formatFullDate(selectedDate)}
            </p>
          ) : null}
        </div>
        {selectedDate ? (
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
        ) : null}
      </div>

      {selectedDate ? (
        <div className="flex items-center justify-between rounded-2xl glass-card p-3">
          <button
            type="button"
            onClick={() => setSelectedDate(shiftDate(selectedDate, -1))}
            disabled={!canGoPrev}
            className="rounded-full px-3 py-1.5 text-sm text-on-surface hover:bg-surface-high disabled:opacity-40"
          >
            Previous day
          </button>
          <span className="text-sm font-medium text-on-surface">
            {selectedDate === today ? "Today" : formatDate(selectedDate)}
          </span>
          <button
            type="button"
            onClick={() => setSelectedDate(shiftDate(selectedDate, 1))}
            disabled={!canGoNext}
            className="rounded-full px-3 py-1.5 text-sm text-on-surface hover:bg-surface-high disabled:opacity-40"
          >
            Next day
          </button>
        </div>
      ) : null}

      {selectedDate && selectedSnapshot?.snapshot ? (
        <SnapshotContent snapshot={selectedSnapshot.snapshot} date={selectedDate} />
      ) : selectedDate ? (
        <div className="rounded-2xl glass-card p-4 sm:p-6 text-center space-y-2">
          <p className="text-on-surface-variant">
            No synced activity for {selectedDate}.
          </p>
          <p className="text-sm text-on-surface-variant/60">
            Pick a day below or wait for the desktop app to sync this date.
          </p>
        </div>
      ) : null}

      <section className="rounded-2xl glass-card p-4 sm:p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Available Days</h2>
          <span className="text-xs text-on-surface-variant">
            {snapshots.length} synced day{snapshots.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="space-y-2">
          {snapshots.map((doc) => {
            const snap = doc.snapshot;
            const focusScore = readFocusScore(snap);
            const focusSeconds = snap?.focusSeconds ?? 0;
            const appCount = snap?.appSummaries?.length ?? 0;
            const blockCount = snap?.workBlocks?.length ?? 0;
            const scoreColor =
              focusScore >= 70
                ? "text-success"
                : focusScore >= 40
                  ? "text-warning"
                  : "text-error";
            const isSelected = doc.localDate === selectedDate;
            const isToday = doc.localDate === today;

            return (
              <button
                key={doc._id}
                type="button"
                onClick={() => setSelectedDate(doc.localDate)}
                className={`flex w-full items-center justify-between rounded-2xl p-4 text-left transition-colors ${
                  isSelected
                    ? "bg-surface-high"
                    : "bg-surface hover:bg-surface-high/70"
                }`}
              >
                <div className="flex items-center gap-4">
                  <div
                    className={`text-2xl font-bold w-12 text-center ${scoreColor}`}
                  >
                    {focusScore}
                  </div>
                  <div>
                    <p className="text-sm font-medium">
                      {dateLabel(doc.localDate, today, yesterday)}
                      {isToday && snap?.focusScore !== undefined ? (
                        <span className="ml-2 text-[0.625rem] font-medium text-primary bg-primary/10 rounded px-1.5 py-0.5">
                          Live
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-on-surface-variant">
                      {formatDuration(focusSeconds)} focused · {blockCount || appCount} {blockCount ? "blocks" : "apps"}
                    </p>
                  </div>
                </div>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="text-on-surface-variant"
                >
                  <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" />
                </svg>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
