"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { DaySnapshotV2, WorkBlockSummary } from "@daylens/remote-contract";
import { AppIcon } from "@/app/components/AppIcon";
import { CATEGORY_COLORS, CATEGORY_LABELS, formatDuration } from "@/app/lib/format";
import { formatLongRangeLabel, type SurfaceRange } from "@/app/lib/range";
import {
  appSummaryLookup,
  mergeDaySnapshots,
  readableBlockLabel,
  sanitizeRecapSummary,
  shortDomainLabel,
  supportingBlockLine,
  trackedSeconds,
  visibleAppCount,
  visibleAppUsage,
  visiblePageEvidence,
  visibleSiteCount,
} from "@/app/lib/presentation";

function formatClockTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function blockDurationSeconds(block: WorkBlockSummary): number {
  const start = Date.parse(block.startAt);
  const end = Date.parse(block.endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 1000);
}

function metricLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

function InlineMetric({ value, label, live = false }: { value: string; label: string; live?: boolean }) {
  return (
    <span className={`timeline-strip__item ${live ? "timeline-strip__item--live" : ""}`}>
      {live && <span className="timeline-strip__live-dot" aria-hidden="true" />}
      <strong>{value}</strong> {label}
    </span>
  );
}

const MIN_GAP_SECONDS = 30 * 60;
const MIN_ROW_HEIGHT = 96;
const MAX_ROW_HEIGHT = 220;

function timelineRowMinHeight(seconds: number): number {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return Math.min(MAX_ROW_HEIGHT, Math.max(MIN_ROW_HEIGHT, 72 + minutes * 2));
}

function GapRow({ gapStartAt, gapEndAt }: { gapStartAt: string; gapEndAt: string }) {
  const gapSeconds = Math.round((Date.parse(gapEndAt) - Date.parse(gapStartAt)) / 1000);
  return (
    <div className="timeline-gap-row" style={{ minHeight: timelineRowMinHeight(gapSeconds) * 0.45 }}>
      <div className="timeline-gap-row__rail">
        <span>{formatClockTime(gapStartAt)}</span>
        <span>{formatDuration(gapSeconds)}</span>
      </div>
      <div className="timeline-gap-row__body">Untracked gap</div>
    </div>
  );
}

function SummaryInspector({
  snapshot,
  title,
  kicker,
  actionHref,
}: {
  snapshot: DaySnapshotV2;
  title: string;
  kicker: string;
  actionHref?: string;
}) {
  const recap = sanitizeRecapSummary(snapshot.recap?.day);
  const mainBlocks = (snapshot.workBlocks ?? []).slice(0, 4);
  const categoryTotals = [...(snapshot.categoryTotals ?? [])]
    .sort((left, right) => right.totalSeconds - left.totalSeconds)
    .slice(0, 4);
  const totalTracked = trackedSeconds(snapshot);
  const focusPct = totalTracked > 0 ? Math.round((snapshot.focusSeconds / totalTracked) * 100) : 0;

  return (
    <div className="timeline-inspector" data-timeline-keep-selection="true">
      <div className="timeline-inspector__header">
        <p className="timeline-kicker">{kicker}</p>
        <h2>{title}</h2>
      </div>

      <div className="timeline-inspector__stats">
        <div className="timeline-inspector__stat">
          <span>Tracked</span>
          <strong>{formatDuration(totalTracked)}</strong>
        </div>
        <div className="timeline-inspector__stat">
          <span>Focus</span>
          <strong>{focusPct}%</strong>
        </div>
      </div>

      {mainBlocks.length > 0 ? (
        <section className="timeline-inspector__section">
          <p className="timeline-kicker">Main blocks</p>
          <div className="timeline-inspector__list">
            {mainBlocks.map((block) => (
              <div key={block.id} className="timeline-mini-row">
                <span
                  className="timeline-mini-row__dot"
                  style={{ background: CATEGORY_COLORS[block.dominantCategory] ?? CATEGORY_COLORS.uncategorized }}
                />
                <div className="timeline-mini-row__body">
                  <p>{readableBlockLabel(block)}</p>
                  <span>
                    {formatClockTime(block.startAt)} - {formatClockTime(block.endAt)} · {formatDuration(blockDurationSeconds(block))}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {categoryTotals.length > 0 ? (
        <section className="timeline-inspector__section">
          <p className="timeline-kicker">Where the day went</p>
          <div className="timeline-inspector__list">
            {categoryTotals.map((item) => (
              <div key={item.category} className="timeline-metric-row">
                <div className="timeline-metric-row__label">
                  <span
                    className="timeline-metric-row__swatch"
                    style={{ background: CATEGORY_COLORS[item.category] ?? CATEGORY_COLORS.uncategorized }}
                  />
                  <span>{metricLabel(item.category)}</span>
                </div>
                <strong>{formatDuration(item.totalSeconds)}</strong>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {recap ? (
        <section className="timeline-inspector__section">
          <p className="timeline-kicker">Recap</p>
          <p className="timeline-note">{recap.headline}</p>
          {snapshot.coverage?.coverageNote ? (
            <p className="timeline-note timeline-note--muted">{snapshot.coverage.coverageNote}</p>
          ) : null}
          {actionHref ? (
            <Link href={actionHref} className="timeline-inline-link">
              Ask AI
            </Link>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function BlockInspector({
  block,
  snapshot,
}: {
  block: WorkBlockSummary;
  snapshot: DaySnapshotV2;
}) {
  const appLookup = appSummaryLookup(snapshot.appSummaries);
  const visibleApps = block.topApps
    .map((item) => visibleAppUsage(item, appLookup))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, 6);
  const visiblePages = block.topPages
    .map((page) => visiblePageEvidence(page))
    .filter((page): page is NonNullable<typeof page> => Boolean(page))
    .slice(0, 6);

  return (
    <div className="timeline-inspector" data-timeline-keep-selection="true">
      <div className="timeline-inspector__header">
        <p className="timeline-kicker">Selected block</p>
        <h2>{readableBlockLabel(block)}</h2>
        <p className="timeline-note timeline-note--muted">
          {formatClockTime(block.startAt)} - {formatClockTime(block.endAt)} · {formatDuration(blockDurationSeconds(block))}
        </p>
      </div>

      <div className="timeline-inspector__stats">
        <div className="timeline-inspector__stat">
          <span>Focus</span>
          <strong>{formatDuration(block.focusSeconds)}</strong>
        </div>
        <div className="timeline-inspector__stat">
          <span>Switches</span>
          <strong>{block.switchCount}</strong>
        </div>
      </div>

      {visibleApps.length > 0 ? (
        <section className="timeline-inspector__section">
          <p className="timeline-kicker">Apps used</p>
          <div className="timeline-inspector__list">
            {visibleApps.map((app) => (
              <div key={`${block.id}:${app.appKey}`} className="timeline-app-row">
                <div className="timeline-app-row__main">
                  <AppIcon
                    bundleID={app.bundleID}
                    displayName={app.displayName}
                    category={app.category}
                    iconBase64={app.iconBase64}
                    size={24}
                  />
                  <div className="timeline-app-row__copy">
                    <p>{app.displayName}</p>
                    <span>{metricLabel(app.category)}</span>
                  </div>
                </div>
                <strong>{formatDuration(app.seconds)}</strong>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {visiblePages.length > 0 ? (
        <section className="timeline-inspector__section">
          <p className="timeline-kicker">Evidence</p>
          <div className="timeline-inspector__list">
            {visiblePages.map((page) => (
              <div key={`${block.id}:${page.domain}:${page.label}`} className="timeline-evidence-row">
                <div>
                  <p>{page.label}</p>
                  <span>{page.domain}</span>
                </div>
                <strong>{formatDuration(page.seconds)}</strong>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function TimelineRow({
  block,
  snapshot,
  isSelected,
  onSelect,
}: {
  block: WorkBlockSummary;
  snapshot: DaySnapshotV2;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const appLookup = appSummaryLookup(snapshot.appSummaries);
  const accent = CATEGORY_COLORS[block.dominantCategory] ?? CATEGORY_COLORS.uncategorized;
  const visibleApps = block.topApps
    .map((item) => visibleAppUsage(item, appLookup))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, 3);
  const visiblePages = block.topPages
    .map((page) => visiblePageEvidence(page))
    .filter((page): page is NonNullable<typeof page> => Boolean(page))
    .slice(0, 3);
  const supportingLine = supportingBlockLine(block, appLookup);
  const rowMinHeight = timelineRowMinHeight(blockDurationSeconds(block));

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`timeline-row ${isSelected ? "timeline-row--selected" : ""}`}
      style={{ ["--timeline-accent" as string]: accent, minHeight: rowMinHeight }}
      data-timeline-keep-selection="true"
    >
      <div className="timeline-row__rail">
        <strong>{formatClockTime(block.startAt)}</strong>
        <span>{formatDuration(blockDurationSeconds(block))}</span>
      </div>

      <div className="timeline-row__card">
        <div className="timeline-row__card-inner">
          <div className="timeline-row__header">
            <div className="timeline-row__title-wrap">
              <p className="timeline-row__title">{readableBlockLabel(block)}</p>
              {supportingLine ? <p className="timeline-row__support">{supportingLine}</p> : null}
            </div>
            <span className="timeline-pill" style={{ color: accent, backgroundColor: `${accent}18` }}>
              {metricLabel(block.dominantCategory)}
            </span>
          </div>

          <div className="timeline-row__meta">
            <span>
              {formatClockTime(block.startAt)} - {formatClockTime(block.endAt)}
            </span>
            <span>{formatDuration(block.focusSeconds)} focus</span>
            {block.switchCount > 0 ? <span>{block.switchCount} switches</span> : null}
          </div>

          {(visibleApps.length > 0 || visiblePages.length > 0) ? (
            <div className="timeline-row__evidence">
              {visibleApps.length > 0 ? (
                <div className="timeline-row__icons">
                  {visibleApps.map((app) => (
                    <AppIcon
                      key={`${block.id}:${app.appKey}`}
                      bundleID={app.bundleID}
                      displayName={app.displayName}
                      category={app.category}
                      iconBase64={app.iconBase64}
                      size={20}
                    />
                  ))}
                </div>
              ) : null}

              <div className="timeline-chip-list">
                {visiblePages.map((page) => (
                  <span key={`${block.id}:${page.domain}:${page.label}`} className="timeline-chip">
                    {page.label === shortDomainLabel(page.domain) ? page.label : `${page.label} · ${page.domain}`}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </button>
  );
}

export function TimelineSurface({
  snapshots,
  anchorDate,
  range,
  liveLabel,
}: {
  snapshots: Array<{ localDate: string; snapshot: DaySnapshotV2 }>;
  anchorDate: string;
  range: SurfaceRange;
  liveLabel?: string | null;
}) {
  const shellRef = useRef<HTMLElement | null>(null);
  const orderedDays = useMemo(
    () => [...snapshots].sort((left, right) => right.localDate.localeCompare(left.localDate)),
    [snapshots],
  );
  const mergedSnapshot = useMemo(
    () => mergeDaySnapshots(orderedDays.map((day) => day.snapshot), anchorDate),
    [anchorDate, orderedDays],
  );
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [selectedDayDate, setSelectedDayDate] = useState<string | null>(orderedDays[0]?.localDate ?? null);

  useEffect(() => {
    setSelectedDayDate(orderedDays[0]?.localDate ?? null);
    setSelectedBlockId(null);
  }, [orderedDays, range, anchorDate]);

  const selectedDay =
    orderedDays.find((day) => day.localDate === selectedDayDate) ??
    orderedDays[0] ??
    null;
  const selectedBlock =
    mergedSnapshot.workBlocks.find((block) => block.id === selectedBlockId) ?? null;

  useEffect(() => {
    if (!selectedBlockId) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const shell = shellRef.current;
      if (!shell) return;

      if (!shell.contains(target)) {
        setSelectedBlockId(null);
        return;
      }

      if (target instanceof Element && target.closest("[data-timeline-keep-selection='true']")) {
        return;
      }

      setSelectedBlockId(null);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [selectedBlockId]);

  if (orderedDays.length === 0) {
    return (
      <section className="timeline-shell">
        <div className="timeline-empty">
          <h2>No tracked activity yet</h2>
          <p>The proof feed will appear here once Daylens has synced activity for this range.</p>
        </div>
      </section>
    );
  }

  function rowsForDay(day: { localDate: string; snapshot: DaySnapshotV2 }) {
    const sorted = [...day.snapshot.workBlocks].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
    const dayStart = new Date(`${day.localDate}T00:00:00`);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const rows = [];

    sorted.forEach((block, idx) => {
      const compositeId = `${day.localDate}:${block.id}`;
      const prevEndAt = idx > 0 ? sorted[idx - 1].endAt : dayStart.toISOString();
      const gap = Math.round((Date.parse(block.startAt) - Date.parse(prevEndAt)) / 1000);
      if (gap >= MIN_GAP_SECONDS) {
        rows.push(
          <GapRow
            key={`gap-before-${compositeId}`}
            gapStartAt={prevEndAt}
            gapEndAt={block.startAt}
          />,
        );
      }
      rows.push(
        <TimelineRow
          key={compositeId}
          block={{ ...block, id: compositeId }}
          snapshot={day.snapshot}
          isSelected={selectedBlock?.id === compositeId}
          onSelect={() => {
            setSelectedDayDate(day.localDate);
            setSelectedBlockId((current) => (current === compositeId ? null : compositeId));
          }}
        />,
      );
    });

    const last = sorted[sorted.length - 1];
    if (last && !day.snapshot.isPartialDay) {
      const gap = Math.round((dayEnd.getTime() - Date.parse(last.endAt)) / 1000);
      if (gap >= MIN_GAP_SECONDS) {
        rows.push(
          <GapRow
            key={`gap-after-${day.localDate}:${last.id}`}
            gapStartAt={last.endAt}
            gapEndAt={dayEnd.toISOString()}
          />,
        );
      }
    }

    return rows;
  }

  const askAiHref =
    range === "day"
      ? `/chat?date=${anchorDate}`
      : `/chat?date=${anchorDate}&range=${range}`;

  return (
    <section className="timeline-shell" ref={shellRef}>
      <div className="timeline-strip">
        <InlineMetric value={formatDuration(trackedSeconds(mergedSnapshot))} label="tracked" />
        <InlineMetric value={formatDuration(mergedSnapshot.focusSeconds)} label="focused" />
        <InlineMetric value={`${mergedSnapshot.workBlocks.length}`} label={`block${mergedSnapshot.workBlocks.length === 1 ? "" : "s"}`} />
        <InlineMetric value={`${visibleAppCount(mergedSnapshot)}`} label={`app${visibleAppCount(mergedSnapshot) === 1 ? "" : "s"}`} />
        <InlineMetric value={`${visibleSiteCount(mergedSnapshot)}`} label={`site${visibleSiteCount(mergedSnapshot) === 1 ? "" : "s"}`} />
        {liveLabel ? <InlineMetric value={liveLabel} label="live now" live /> : null}
      </div>

      <div className="timeline-grid">
        <div className="timeline-feed">
          {orderedDays.map((day) => (
            <section key={day.localDate} className={`timeline-day-group ${selectedDay?.localDate === day.localDate ? "timeline-day-group--active" : ""}`}>
              {range !== "day" ? (
                <button
                  type="button"
                  className="timeline-day-group__header"
                  onClick={() => {
                    setSelectedDayDate(day.localDate);
                    setSelectedBlockId(null);
                  }}
                  data-timeline-keep-selection="true"
                >
                  <div>
                    <p className="timeline-day-group__title">{formatLongRangeLabel(day.localDate, "day")}</p>
                    <span>{formatDuration(trackedSeconds(day.snapshot))} tracked · {day.snapshot.workBlocks.length} blocks</span>
                  </div>
                  <strong>{formatDuration(day.snapshot.focusSeconds)}</strong>
                </button>
              ) : null}

              <div className="timeline-day-group__rows">
                {rowsForDay(day)}
              </div>
            </section>
          ))}
        </div>

        <div className="timeline-rail">
          {selectedBlock ? (
            <BlockInspector block={selectedBlock} snapshot={mergedSnapshot} />
          ) : selectedDay ? (
            <SummaryInspector
              snapshot={selectedDay.snapshot}
              title={formatLongRangeLabel(selectedDay.localDate, "day")}
              kicker={range === "day" ? "Day summary" : "Selected day"}
              actionHref={askAiHref}
            />
          ) : (
            <SummaryInspector
              snapshot={mergedSnapshot}
              title={formatLongRangeLabel(anchorDate, range)}
              kicker="Range summary"
              actionHref={askAiHref}
            />
          )}
        </div>
      </div>
    </section>
  );
}
