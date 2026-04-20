"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDate, formatDuration, formatFullDate } from "@/app/lib/format";

interface SnapshotDoc {
  localDate: string;
  syncedAt?: number;
  snapshot: {
    recap?: {
      day?: {
        headline: string;
        hasData: boolean;
        chapters: Array<{ id: string; eyebrow: string; title: string; body: string }>;
        metrics: Array<{ label: string; value: string; detail: string }>;
        changeSummary: string;
        promptChips: string[];
      };
      week?: {
        headline: string;
        hasData: boolean;
        chapters: Array<{ id: string; eyebrow: string; title: string; body: string }>;
        metrics: Array<{ label: string; value: string; detail: string }>;
        changeSummary: string;
        promptChips: string[];
      } | null;
      month?: {
        headline: string;
        hasData: boolean;
        chapters: Array<{ id: string; eyebrow: string; title: string; body: string }>;
        metrics: Array<{ label: string; value: string; detail: string }>;
        changeSummary: string;
        promptChips: string[];
      } | null;
    };
    coverage?: {
      attributedPct: number;
      untitledPct: number;
      activeDayCount: number;
      quietDayCount: number;
      coverageNote?: string | null;
    };
    topWorkstreams?: Array<{ label: string; seconds: number; blockCount: number }>;
    standoutArtifacts?: Array<{ id: string; title: string; generatedAt: string }>;
    entities?: Array<{ id: string; label: string; kind: string; secondsToday: number }>;
  } | null;
}

type RecapPeriod = "day" | "week" | "month";

function getLocalDate(): string {
  return new Date().toLocaleDateString("en-CA");
}

function shiftDate(date: string, deltaDays: number) {
  const nextDate = new Date(`${date}T12:00:00`);
  nextDate.setDate(nextDate.getDate() + deltaDays);
  return nextDate.toLocaleDateString("en-CA");
}

export function RecapClient({ initialDate }: { initialDate?: string }) {
  const [today] = useState(getLocalDate);
  const [selectedDate, setSelectedDate] = useState<string>(initialDate || today);
  const [data, setData] = useState<SnapshotDoc | null | undefined>(undefined);
  const [activePeriod, setActivePeriod] = useState<RecapPeriod>("day");

  useEffect(() => {
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

  if (data === undefined) {
    return (
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-4 sm:py-8">
        <div className="rounded-2xl glass-card p-6 animate-pulse h-56" />
      </div>
    );
  }

  const snapshot = data?.snapshot;
  const recap = snapshot?.recap;
  const active =
    activePeriod === "day"
      ? recap?.day
      : activePeriod === "week"
        ? recap?.week
        : recap?.month;

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-4 sm:py-8 space-y-4 sm:space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Recap</h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            {formatFullDate(selectedDate)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/chat?date=${selectedDate}`}
            className="rounded-full border border-outline-variant/20 px-3 py-1.5 text-sm text-on-surface hover:bg-surface-low"
          >
            Ask AI
          </Link>
          <Link
            href={`/history`}
            className="rounded-full border border-outline-variant/20 px-3 py-1.5 text-sm text-on-surface hover:bg-surface-low"
          >
            History
          </Link>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-2xl glass-card p-3">
        <button
          type="button"
          onClick={() => setSelectedDate(shiftDate(selectedDate, -1))}
          className="rounded-full px-3 py-1.5 text-sm text-on-surface hover:bg-surface-high"
        >
          Previous day
        </button>
        <span className="text-sm font-medium text-on-surface">
          {selectedDate === today ? "Today" : formatDate(selectedDate)}
        </span>
        <button
          type="button"
          onClick={() => setSelectedDate(shiftDate(selectedDate, 1))}
          disabled={selectedDate >= today}
          className="rounded-full px-3 py-1.5 text-sm text-on-surface hover:bg-surface-high disabled:opacity-40"
        >
          Next day
        </button>
      </div>

      {!snapshot || !recap ? (
        <div className="rounded-2xl glass-card p-6 text-center text-on-surface-variant">
          No synced recap is available for this day yet.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {(["day", "week", "month"] as RecapPeriod[]).map((period) => {
              const periodSummary =
                period === "day"
                  ? recap.day
                  : period === "week"
                    ? recap.week
                    : recap.month;
              return (
                <button
                  key={period}
                  type="button"
                  onClick={() => setActivePeriod(period)}
                  disabled={!periodSummary}
                  className={`rounded-full px-3 py-1.5 text-sm ${
                    activePeriod === period
                      ? "bg-primary text-on-primary"
                      : "bg-surface-low text-on-surface hover:bg-surface-high"
                  } disabled:opacity-40`}
                >
                  {period}
                </button>
              );
            })}
          </div>

          {active ? (
            <>
              <section className="rounded-2xl glass-card p-6 space-y-4">
                <div className="space-y-2">
                  <h2 className="text-lg font-semibold">
                    {activePeriod === "day"
                      ? "Daily recap"
                      : activePeriod === "week"
                        ? "Weekly recap"
                        : "Monthly recap"}
                  </h2>
                  <p className="text-sm leading-relaxed text-on-surface/90">
                    {active.headline}
                  </p>
                </div>

                {snapshot.coverage?.coverageNote ? (
                  <div className="rounded-xl bg-warning/10 px-3 py-2 text-sm text-on-surface/85">
                    {snapshot.coverage.coverageNote}
                  </div>
                ) : null}

                <div className="space-y-3">
                  {active.chapters.map((chapter) => (
                    <div key={chapter.id} className="rounded-xl bg-surface-low px-4 py-3">
                      <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-on-surface-variant">
                        {chapter.eyebrow}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-on-surface">{chapter.title}</p>
                      <p className="mt-1 text-sm leading-relaxed text-on-surface/85">{chapter.body}</p>
                    </div>
                  ))}
                </div>

                {active.metrics.length > 0 && (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {active.metrics.map((metric) => (
                      <div key={metric.label} className="rounded-xl bg-surface-low px-4 py-3">
                        <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-on-surface-variant">
                          {metric.label}
                        </p>
                        <p className="mt-1 text-lg font-semibold text-on-surface">{metric.value}</p>
                        <p className="mt-1 text-sm text-on-surface-variant">{metric.detail}</p>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {((snapshot.topWorkstreams?.length || 0) > 0 ||
                (snapshot.entities?.length || 0) > 0 ||
                (snapshot.standoutArtifacts?.length || 0) > 0) && (
                <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
                  {(snapshot.topWorkstreams?.length || 0) > 0 && (
                    <section className="rounded-2xl glass-card p-6 space-y-3">
                      <h2 className="text-lg font-semibold">Top workstreams</h2>
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
                    <section className="rounded-2xl glass-card p-6 space-y-3">
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

                  {(snapshot.standoutArtifacts?.length || 0) > 0 && (
                    <section className="rounded-2xl glass-card p-6 space-y-3">
                      <h2 className="text-lg font-semibold">Standout artifacts</h2>
                      <div className="space-y-3">
                        {snapshot.standoutArtifacts!.slice(0, 5).map((artifact) => (
                          <div key={artifact.id}>
                            <p className="text-sm font-medium text-on-surface">{artifact.title}</p>
                            <p className="text-[0.6875rem] text-on-surface-variant">
                              {new Date(artifact.generatedAt).toLocaleTimeString("en-US", {
                                hour: "numeric",
                                minute: "2-digit",
                              })}
                            </p>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              )}

              {active.promptChips.length > 0 && (
                <section className="rounded-2xl glass-card p-6 space-y-3">
                  <h2 className="text-lg font-semibold">Suggested follow-ups</h2>
                  <div className="flex flex-wrap gap-2">
                    {active.promptChips.map((chip) => (
                      <Link
                        key={chip}
                        href={`/chat?date=${selectedDate}&prompt=${encodeURIComponent(chip)}`}
                        className="rounded-full bg-surface-low px-3 py-1.5 text-sm text-on-surface hover:bg-surface-high"
                      >
                        {chip}
                      </Link>
                    ))}
                  </div>
                </section>
              )}
            </>
          ) : (
            <div className="rounded-2xl glass-card p-6 text-center text-on-surface-variant">
              No {activePeriod} recap is available for this day yet.
            </div>
          )}
        </>
      )}
    </div>
  );
}
