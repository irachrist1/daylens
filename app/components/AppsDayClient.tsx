"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { AppSummary, DaySnapshotV2 } from "../../packages/remote-contract";
import { AppIcon } from "@/app/components/AppIcon";
import { CATEGORY_COLORS, CATEGORY_LABELS, formatDuration } from "@/app/lib/format";
import { buildAppDetail, readableAppSummary } from "@/app/lib/presentation";

function formatDateLabel(date: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

export function AppsDayClient({
  snapshot,
  date,
}: {
  snapshot: DaySnapshotV2;
  date: string;
}) {
  const visibleApps = useMemo(
    () =>
      (snapshot.appSummaries ?? [])
        .filter((summary) => Boolean(readableAppSummary(summary)))
        .sort((left, right) => right.totalSeconds - left.totalSeconds),
    [snapshot.appSummaries],
  );
  const categories = useMemo(
    () => [...new Set(visibleApps.map((summary) => summary.category))],
    [visibleApps],
  );
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedAppKey, setSelectedAppKey] = useState<string | null>(visibleApps[0]?.appKey ?? null);

  const filteredApps = useMemo(
    () => (selectedCategory ? visibleApps.filter((summary) => summary.category === selectedCategory) : visibleApps),
    [selectedCategory, visibleApps],
  );
  const selectedSummary =
    filteredApps.find((summary) => summary.appKey === selectedAppKey) ??
    filteredApps[0] ??
    null;
  const selectedDetail = selectedSummary ? buildAppDetail(snapshot, selectedSummary) : null;

  return (
    <div className="apps-surface">
      <div className="apps-header">
        <div className="apps-header__copy">
          <p className="timeline-kicker">Apps</p>
          <h1>{formatDateLabel(date)}</h1>
        </div>
        <div className="apps-header__actions">
          <Link href="/dashboard" className="daylens-secondary-button">
            Timeline
          </Link>
          <Link href={`/chat?date=${date}`} className="daylens-secondary-button">
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

        <section className="apps-detail">
          {selectedSummary && selectedDetail ? (
            <>
              <div className="apps-detail__hero">
                <div className="apps-detail__hero-main">
                  <AppIcon
                    bundleID={selectedSummary.bundleID ?? selectedSummary.appKey}
                    displayName={readableAppSummary(selectedSummary) ?? selectedSummary.displayName}
                    category={selectedSummary.category}
                    iconBase64={selectedSummary.iconBase64}
                    size={42}
                  />
                  <div>
                    <h2>{readableAppSummary(selectedSummary) ?? selectedSummary.displayName}</h2>
                    <p>
                      {CATEGORY_LABELS[selectedSummary.category] ?? selectedSummary.category} · {formatDuration(selectedSummary.totalSeconds)} tracked · {selectedSummary.sessionCount} sessions
                    </p>
                  </div>
                </div>
                <span
                  className="timeline-pill"
                  style={{
                    color: CATEGORY_COLORS[selectedSummary.category] ?? CATEGORY_COLORS.uncategorized,
                    backgroundColor: `${CATEGORY_COLORS[selectedSummary.category] ?? CATEGORY_COLORS.uncategorized}1c`,
                  }}
                >
                  {CATEGORY_LABELS[selectedSummary.category] ?? selectedSummary.category}
                </span>
              </div>

              <div className="apps-detail__sections">
                {selectedDetail.headlineLabels.length > 0 ? (
                  <section className="apps-panel">
                    <p className="timeline-kicker">Helping with</p>
                    <div className="apps-detail__bullets">
                      {selectedDetail.headlineLabels.map((label) => (
                        <div key={label} className="apps-evidence">
                          <p>{label}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                {selectedDetail.relatedSites.length > 0 ? (
                  <section className="apps-panel">
                    <p className="timeline-kicker">Key artifacts</p>
                    <div className="apps-detail__bullets">
                      {selectedDetail.relatedSites.map((site) => (
                        <div key={`${site.domain}:${site.label}`} className="apps-evidence">
                          <p>{site.label}</p>
                          <span>{site.domain}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                {selectedDetail.alongsideApps.length > 0 ? (
                  <section className="apps-panel">
                    <p className="timeline-kicker">Used alongside</p>
                    <div className="apps-side-by-side">
                      {selectedDetail.alongsideApps.map((app) => (
                        <div key={app.appKey} className="apps-side-by-side__item">
                          <div className="apps-list__item-main">
                            <AppIcon
                              bundleID={app.bundleID}
                              displayName={app.displayName}
                              category={app.category}
                              iconBase64={app.iconBase64}
                              size={24}
                            />
                            <div className="apps-list__item-copy">
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
                  <section className="apps-panel">
                    <p className="timeline-kicker">Block context</p>
                    <div className="apps-detail__bullets">
                      {selectedDetail.relatedBlocks.slice(0, 6).map((block) => (
                        <Link key={block.id} href="/dashboard" className="apps-evidence apps-evidence--interactive">
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
            </>
          ) : (
            <div className="apps-empty">
              <h2>No visible app detail yet</h2>
              <p>Once synced blocks include clearer app usage for this day, Daylens will show the supporting context here.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
