"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

function GlobeIcon() {
  return (
    <svg className="apps-artifact-row__favicon-fallback" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <circle cx="7" cy="7" r="5.5" />
      <path d="M7 1.5C7 1.5 5 4 5 7s2 5.5 2 5.5M7 1.5C7 1.5 9 4 9 7s-2 5.5-2 5.5M1.5 7h11" />
    </svg>
  );
}

function DomainFavicon({ domain }: { domain: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <GlobeIcon />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="apps-artifact-row__favicon"
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`}
      alt=""
      aria-hidden="true"
      onError={() => setFailed(true)}
    />
  );
}
import type { DaySnapshotV2 } from "../../packages/remote-contract";
import { AppIcon } from "@/app/components/AppIcon";
import { apiPath } from "@/app/lib/basePath";
import { CATEGORY_COLORS, CATEGORY_LABELS, formatDuration } from "@/app/lib/format";
import {
  buildSurfaceHref,
  formatLongRangeLabel,
  getRangeBounds,
  parseSurfaceRange,
  todayLocalDate,
  type SurfaceRange,
} from "@/app/lib/range";
import { buildAppDetail, mergeDaySnapshots, readableAppSummary, trackedSeconds } from "@/app/lib/presentation";
import { isSnapshotV2 } from "../../packages/remote-contract";

interface SnapshotDoc {
  snapshot: DaySnapshotV2;
  syncedAt?: number;
  localDate: string;
}

interface SnapshotSummaryDoc {
  _id: string;
  localDate: string;
}

function RangeSummaryPane({ snapshot, range, date }: { snapshot: DaySnapshotV2; range: SurfaceRange; date: string }) {
  const topApps = snapshot.appSummaries.slice(0, 6);
  const categories = snapshot.categoryTotals.slice(0, 4);

  return (
    <section className="apps-detail">
      <div className="apps-summary-panel">
        <p className="timeline-kicker">Range summary</p>
        <h2>{formatLongRangeLabel(date, range)}</h2>
        <p>{formatDuration(trackedSeconds(snapshot))} tracked across {snapshot.appSummaries.length} visible apps.</p>
      </div>

      <div className="apps-summary-grid">
        <section className="apps-section">
          <p className="timeline-kicker">Top apps</p>
          <div className="apps-section__list">
            {topApps.map((app) => (
              <div key={app.appKey} className="apps-row">
                <div className="apps-row__main">
                  <AppIcon
                    bundleID={app.bundleID ?? app.appKey}
                    displayName={readableAppSummary(app) ?? app.displayName}
                    category={app.category}
                    iconBase64={app.iconBase64}
                    size={24}
                  />
                  <div className="apps-row__copy">
                    <p>{readableAppSummary(app) ?? app.displayName}</p>
                    <span>{CATEGORY_LABELS[app.category] ?? app.category}</span>
                  </div>
                </div>
                <strong>{formatDuration(app.totalSeconds)}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="apps-section">
          <p className="timeline-kicker">Category mix</p>
          <div className="apps-section__list">
            {categories.map((category) => (
              <div key={category.category} className="timeline-metric-row">
                <div className="timeline-metric-row__label">
                  <span
                    className="timeline-metric-row__swatch"
                    style={{ background: CATEGORY_COLORS[category.category] ?? CATEGORY_COLORS.uncategorized }}
                  />
                  <span>{CATEGORY_LABELS[category.category] ?? category.category}</span>
                </div>
                <strong>{formatDuration(category.totalSeconds)}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

export function AppsDayClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [today] = useState(todayLocalDate);
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotDoc[] | undefined>(undefined);

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

    return () => {
      cancelled = true;
    };
  }, [dateParam, pathname, range, router, today]);

  useEffect(() => {
    if (!selectedDate) return;
    let cancelled = false;
    setSnapshots(undefined);

    const request = range === "day"
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
          const doc = json?.snapshot;
          setSnapshots(doc?.snapshot && isSnapshotV2(doc.snapshot) ? [doc] : []);
        } else {
          setSnapshots(
            Array.isArray(json?.snapshots)
              ? json.snapshots.filter((doc: SnapshotDoc) => doc?.snapshot && isSnapshotV2(doc.snapshot))
              : [],
          );
        }
      })
      .catch(() => {
        if (!cancelled) setSnapshots([]);
      });

    return () => {
      cancelled = true;
    };
  }, [range, selectedDate]);

  const mergedSnapshot = useMemo(
    () => (snapshots && snapshots.length > 0 ? mergeDaySnapshots(snapshots.map((doc) => doc.snapshot), selectedDate) : null),
    [selectedDate, snapshots],
  );
  const visibleApps = useMemo(
    () =>
      (mergedSnapshot?.appSummaries ?? [])
        .filter((summary) => Boolean(readableAppSummary(summary)))
        .sort((left, right) => right.totalSeconds - left.totalSeconds),
    [mergedSnapshot],
  );
  const categories = useMemo(
    () => [...new Set(visibleApps.map((summary) => summary.category))],
    [visibleApps],
  );
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedAppKey, setSelectedAppKey] = useState<string | null>(null);

  useEffect(() => {
    setSelectedCategory(null);
    setSelectedAppKey(range === "day" ? visibleApps[0]?.appKey ?? null : null);
  }, [range, selectedDate, visibleApps]);

  const filteredApps = useMemo(
    () => (selectedCategory ? visibleApps.filter((summary) => summary.category === selectedCategory) : visibleApps),
    [selectedCategory, visibleApps],
  );
  const selectedSummary =
    filteredApps.find((summary) => summary.appKey === selectedAppKey) ??
    (range === "day" ? filteredApps[0] ?? null : null);
  const selectedDetail = selectedSummary && mergedSnapshot ? buildAppDetail(mergedSnapshot, selectedSummary) : null;

  if (snapshots === undefined || !mergedSnapshot) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="apps-surface">
          <div className="apps-empty">
            <h2>Loading apps</h2>
            <p>Collecting the tools that shaped this range.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="apps-surface">
        <div className="apps-header">
          <div className="apps-header__copy">
            <p className="timeline-kicker">Apps</p>
            <h1>{formatLongRangeLabel(selectedDate, range)}</h1>
          </div>
          <div className="apps-header__actions">
            <div className="daylens-segmented">
              {(["day", "week", "month"] as SurfaceRange[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={option === range ? "is-active" : ""}
                  onClick={() => router.replace(buildSurfaceHref(pathname, selectedDate, option))}
                >
                  {option[0].toUpperCase() + option.slice(1)}
                </button>
              ))}
            </div>
            <Link href={buildSurfaceHref("/dashboard", selectedDate, range)} className="daylens-secondary-button">
              Timeline
            </Link>
            <Link href={buildSurfaceHref("/chat", selectedDate, range)} className="daylens-secondary-button">
              Ask AI
            </Link>
          </div>
        </div>

        {categories.length > 0 ? (
          <div className="apps-filter-row">
            <button
              type="button"
              className={`timeline-chip ${selectedCategory === null ? "timeline-chip--active" : ""}`}
              onClick={() => setSelectedCategory(null)}
            >
              All
            </button>
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                className={`timeline-chip ${selectedCategory === category ? "timeline-chip--active" : ""}`}
                onClick={() => setSelectedCategory(category)}
              >
                {CATEGORY_LABELS[category] ?? category}
              </button>
            ))}
          </div>
        ) : null}

        <div className="apps-grid">
          <aside className="apps-list">
            {filteredApps.map((summary) => {
              const active = summary.appKey === selectedSummary?.appKey;
              const label = readableAppSummary(summary) ?? summary.displayName;
              return (
                <button
                  key={summary.appKey}
                  type="button"
                  onClick={() => setSelectedAppKey(summary.appKey)}
                  className={`apps-list__item ${active ? "apps-list__item--active" : ""}`}
                >
                  <div className="apps-list__item-main">
                    <AppIcon
                      bundleID={summary.bundleID ?? summary.appKey}
                      displayName={label}
                      category={summary.category}
                      iconBase64={summary.iconBase64}
                      size={28}
                    />
                    <div className="apps-list__item-copy">
                      <p>{label}</p>
                      <span>{CATEGORY_LABELS[summary.category] ?? summary.category}</span>
                    </div>
                  </div>
                  <strong>{formatDuration(summary.totalSeconds)}</strong>
                </button>
              );
            })}
          </aside>

          {selectedSummary && selectedDetail ? (
            <section className="apps-detail">
              <div className="apps-detail__hero">
                <div className="apps-detail__hero-main">
                  <AppIcon
                    bundleID={selectedSummary.bundleID ?? selectedSummary.appKey}
                    displayName={readableAppSummary(selectedSummary) ?? selectedSummary.displayName}
                    category={selectedSummary.category}
                    iconBase64={selectedSummary.iconBase64}
                    size={40}
                  />
                  <div>
                    <h2>{readableAppSummary(selectedSummary) ?? selectedSummary.displayName}</h2>
                    <p>
                      {CATEGORY_LABELS[selectedSummary.category] ?? selectedSummary.category} · {formatDuration(selectedSummary.totalSeconds)} tracked
                    </p>
                  </div>
                </div>
                <span
                  className="timeline-pill"
                  style={{
                    color: CATEGORY_COLORS[selectedSummary.category] ?? CATEGORY_COLORS.uncategorized,
                    backgroundColor: `${CATEGORY_COLORS[selectedSummary.category] ?? CATEGORY_COLORS.uncategorized}18`,
                  }}
                >
                  {CATEGORY_LABELS[selectedSummary.category] ?? selectedSummary.category}
                </span>
              </div>

              <div className="apps-detail__sections">
                {selectedDetail.headlineLabels.length > 0 ? (
                  <section className="apps-section">
                    <p className="timeline-kicker">Helping with</p>
                    <div className="apps-section__list apps-section__list--inline">
                      {selectedDetail.headlineLabels.map((label) => (
                        <div key={label} className="apps-inline-row">
                          <p>{label}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                {selectedDetail.relatedSites.length > 0 ? (
                  <section className="apps-section">
                    <p className="timeline-kicker">Key artifacts</p>
                    <div className="apps-section__list">
                      {selectedDetail.relatedSites.map((site) => (
                        <div key={`${site.domain}:${site.label}`} className="apps-evidence">
                          <div className="apps-artifact-row">
                            <DomainFavicon domain={site.domain} />
                            <div className="apps-artifact-row__copy">
                              <p>{site.label}</p>
                              <span>{site.domain}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                {selectedDetail.alongsideApps.length > 0 ? (
                  <section className="apps-section">
                    <p className="timeline-kicker">Used alongside</p>
                    <div className="apps-section__list">
                      {selectedDetail.alongsideApps.map((app) => (
                        <div key={app.appKey} className="apps-row">
                          <div className="apps-row__main">
                            <AppIcon
                              bundleID={app.bundleID}
                              displayName={app.displayName}
                              category={app.category}
                              iconBase64={app.iconBase64}
                              size={24}
                            />
                            <div className="apps-row__copy">
                              <p>{app.displayName}</p>
                              <span>{CATEGORY_LABELS[app.category] ?? app.category}</span>
                            </div>
                          </div>
                          <strong>{formatDuration(app.seconds)}</strong>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                {selectedDetail.relatedBlocks.length > 0 ? (
                  <section className="apps-section">
                    <p className="timeline-kicker">Block context</p>
                    <div className="apps-section__list">
                      {selectedDetail.relatedBlocks.slice(0, 6).map((block) => (
                        <Link
                          key={block.id}
                          href={buildSurfaceHref("/dashboard", selectedDate, range)}
                          className="apps-evidence apps-evidence--interactive"
                        >
                          <p>{block.label}</p>
                          <span>
                            {new Date(block.startAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} - {new Date(block.endAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
            </section>
          ) : (
            <RangeSummaryPane snapshot={mergedSnapshot} range={range} date={selectedDate} />
          )}
        </div>
      </div>
    </div>
  );
}
