"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { DaySnapshotV2, WorkBlockSummary } from "../../packages/remote-contract";
import { AppIcon } from "@/app/components/AppIcon";
import { CATEGORY_COLORS, CATEGORY_LABELS, formatDuration } from "@/app/lib/format";
import {
  appSummaryLookup,
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
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
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

function InlineMetric({
  value,
  label,
  live = false,
}: {
  value: string;
  label: string;
  live?: boolean;
}) {
  return (
    <span className={`timeline-strip__item ${live ? "timeline-strip__item--live" : ""}`}>
      <strong>{value}</strong> {label}
    </span>
  );
}

function DaySummaryInspector({
  snapshot,
  date,
}: {
  snapshot: DaySnapshotV2;
  date: string;
}) {
  const recap = sanitizeRecapSummary(snapshot.recap?.day);
  const mainBlocks = (snapshot.workBlocks ?? []).slice(0, 3);
  const categoryTotals = [...(snapshot.categoryTotals ?? [])]
    .sort((left, right) => right.totalSeconds - left.totalSeconds)
    .slice(0, 4);

  return (
    <div className="timeline-inspector" data-timeline-keep-selection="true">
      <div className="timeline-inspector__header">
        <p className="timeline-kicker">Day summary</p>
        <h2>{new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date(`${date}T12:00:00`))}</h2>
      </div>

      <div className="timeline-inspector__stats">
        <div className="timeline-inspector__stat">
          <span>Tracked</span>
          <strong>{formatDuration(trackedSeconds(snapshot))}</strong>
        </div>
        <div className="timeline-inspector__stat">
          <span>Focus</span>
          <strong>{formatDuration(snapshot.focusSeconds)}</strong>
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
          <Link href={`/chat?date=${date}`} className="timeline-inline-link">
            Ask AI about this day
          </Link>
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
          <p className="timeline-kicker">Relevant evidence</p>
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

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`timeline-row ${isSelected ? "timeline-row--selected" : ""}`}
      style={{ ["--timeline-accent" as string]: accent }}
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
            <span className="timeline-pill" style={{ color: accent, backgroundColor: `${accent}1c` }}>
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
  snapshot,
  date,
  liveLabel,
}: {
  snapshot: DaySnapshotV2;
  date: string;
  liveLabel?: string | null;
}) {
  const shellRef = useRef<HTMLElement | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const selectedBlock = snapshot.workBlocks?.find((block) => block.id === selectedBlockId) ?? null;
  const recap = sanitizeRecapSummary(snapshot.recap?.day);

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

  return (
    <section className="timeline-shell" ref={shellRef}>
      <div className="timeline-strip">
        <InlineMetric value={formatDuration(trackedSeconds(snapshot))} label="tracked" />
        <InlineMetric value={formatDuration(snapshot.focusSeconds)} label="focused" />
        <InlineMetric value={`${snapshot.workBlocks?.length ?? 0}`} label={`block${snapshot.workBlocks?.length === 1 ? "" : "s"}`} />
        <InlineMetric value={`${visibleAppCount(snapshot)}`} label={`app${visibleAppCount(snapshot) === 1 ? "" : "s"}`} />
        <InlineMetric value={`${visibleSiteCount(snapshot)}`} label={`site${visibleSiteCount(snapshot) === 1 ? "" : "s"}`} />
        {liveLabel ? <InlineMetric value={liveLabel} label="live now" live /> : null}
      </div>

      {(snapshot.workBlocks?.length ?? 0) === 0 ? (
        <div className="timeline-empty">
          <h2>No tracked activity for this day</h2>
          <p>Once synced foreground activity exists for this date, the chronological proof feed will appear here automatically.</p>
        </div>
      ) : (
        <div className="timeline-grid">
          <div className="timeline-feed">
            {snapshot.workBlocks.map((block) => (
              <TimelineRow
                key={block.id}
                block={block}
                snapshot={snapshot}
                isSelected={selectedBlock?.id === block.id}
                onSelect={() => setSelectedBlockId((current) => (current === block.id ? null : block.id))}
              />
            ))}
          </div>

          <div className="timeline-rail">
            {selectedBlock ? (
              <BlockInspector block={selectedBlock} snapshot={snapshot} />
            ) : (
              <DaySummaryInspector snapshot={snapshot} date={date} />
            )}
            {!selectedBlock && recap && recap.chapters.length > 0 ? (
              <div className="timeline-rail-note">
                <p className="timeline-kicker">Recap beat</p>
                <p>{recap.chapters[0]?.title}</p>
                <span>{recap.chapters[0]?.body}</span>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
