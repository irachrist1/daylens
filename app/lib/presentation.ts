import type {
  AppSummary,
  DaySnapshotV2,
  RecapSummaryLite,
  TopDomain,
  WorkBlockSummary,
} from "../../packages/remote-contract";
import { formatDisplayAppName, formatVisibleAppName } from "@/app/lib/apps";

export type VisibleAppUsage = {
  appKey: string;
  displayName: string;
  bundleID: string;
  category: string;
  seconds: number;
  iconBase64?: string;
};

export type VisiblePageEvidence = {
  label: string;
  domain: string;
  seconds: number;
};

export type SanitizedRecap = {
  headline: string;
  chapters: RecapSummaryLite["chapters"];
  metrics: RecapSummaryLite["metrics"];
  promptChips: string[];
};

export type DerivedAppDetail = {
  summary: AppSummary;
  headlineLabels: string[];
  relatedBlocks: WorkBlockSummary[];
  alongsideApps: VisibleAppUsage[];
  relatedSites: VisiblePageEvidence[];
};

function mergeUniqueTopPages(
  pages: Array<{ domain: string; label?: string | null; seconds: number }>,
) {
  const byKey = new Map<string, { domain: string; label: string | null; seconds: number }>();
  for (const page of pages) {
    const domain = shortDomainLabel(page.domain);
    const label = formatVisibleEvidenceLabel(page.label, page.domain);
    if (!domain || !label) continue;
    const key = `${domain}:${label}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.seconds += page.seconds;
    } else {
      byKey.set(key, { domain, label, seconds: page.seconds });
    }
  }
  return [...byKey.values()].sort((left, right) => right.seconds - left.seconds).slice(0, 6);
}

export function mergeDaySnapshots(snapshots: DaySnapshotV2[], anchorDate: string): DaySnapshotV2 {
  const ordered = [...snapshots].sort((left, right) => left.date.localeCompare(right.date));
  const latest = ordered[ordered.length - 1] ?? snapshots[0];

  const appMap = new Map<string, AppSummary>();
  const categoryMap = new Map<string, number>();
  const domainMap = new Map<string, TopDomain>();
  const blockMap = new Map<string, WorkBlockSummary>();
  const workstreamMap = new Map<string, { label: string; seconds: number; blockCount: number; isUntitled: boolean }>();
  const entityMap = new Map<string, { id: string; label: string; kind: "client" | "project" | "repo" | "topic"; secondsToday: number; blockCount: number }>();
  const artifactMap = new Map<string, DaySnapshotV2["standoutArtifacts"][number]>();

  let focusSeconds = 0;
  let weightedFocusScore = 0;
  let totalFocusWeight = 0;

  for (const snapshot of ordered) {
    focusSeconds += snapshot.focusSeconds;
    const weight = Math.max(snapshot.focusSeconds, 1);
    totalFocusWeight += weight;
    weightedFocusScore += snapshot.focusScore * weight;

    for (const app of snapshot.appSummaries) {
      const existing = appMap.get(app.appKey);
      if (existing) {
        existing.totalSeconds += app.totalSeconds;
        existing.sessionCount += app.sessionCount;
        if (!existing.iconBase64 && app.iconBase64) existing.iconBase64 = app.iconBase64;
      } else {
        appMap.set(app.appKey, { ...app });
      }
    }

    for (const category of snapshot.categoryTotals) {
      categoryMap.set(category.category, (categoryMap.get(category.category) ?? 0) + category.totalSeconds);
    }

    for (const domain of snapshot.topDomains) {
      const normalizedDomain = shortDomainLabel(domain.domain);
      if (!normalizedDomain) continue;
      const existing = domainMap.get(normalizedDomain);
      const topPages = mergeUniqueTopPages(domain.topPages ?? []);
      if (existing) {
        existing.seconds += domain.seconds;
        existing.topPages = mergeUniqueTopPages([...(existing.topPages ?? []), ...topPages]);
      } else {
        domainMap.set(normalizedDomain, {
          ...domain,
          domain: normalizedDomain,
          topPages,
        });
      }
    }

    for (const block of snapshot.workBlocks ?? []) {
      const key = `${snapshot.date}:${block.id}`;
      blockMap.set(key, { ...block, id: key });
      const readable = readableBlockLabel(block);
      const existingWorkstream = workstreamMap.get(readable);
      const duration = Math.max(0, (Date.parse(block.endAt) - Date.parse(block.startAt)) / 1000);
      if (existingWorkstream) {
        existingWorkstream.seconds += duration;
        existingWorkstream.blockCount += 1;
      } else {
        workstreamMap.set(readable, {
          label: readable,
          seconds: duration,
          blockCount: 1,
          isUntitled: readable === "Unlabeled work block" || readable === "Work block",
        });
      }
    }

    for (const entity of snapshot.entities ?? []) {
      const existing = entityMap.get(entity.id);
      if (existing) {
        existing.secondsToday += entity.secondsToday;
        existing.blockCount += entity.blockCount;
      } else {
        entityMap.set(entity.id, { ...entity });
      }
    }

    for (const artifact of snapshot.standoutArtifacts ?? []) {
      const existing = artifactMap.get(artifact.id);
      if (!existing || artifact.generatedAt > existing.generatedAt) {
        artifactMap.set(artifact.id, artifact);
      }
    }
  }

  return {
    ...latest,
    date: anchorDate,
    focusSeconds,
    focusScore: totalFocusWeight > 0 ? Math.round(weightedFocusScore / totalFocusWeight) : latest.focusScore,
    appSummaries: [...appMap.values()].sort((left, right) => right.totalSeconds - left.totalSeconds),
    categoryTotals: [...categoryMap.entries()]
      .map(([category, totalSeconds]) => ({ category: category as AppSummary["category"], totalSeconds }))
      .sort((left, right) => right.totalSeconds - left.totalSeconds),
    topDomains: [...domainMap.values()].sort((left, right) => right.seconds - left.seconds),
    workBlocks: [...blockMap.values()].sort((left, right) => left.startAt.localeCompare(right.startAt)),
    topWorkstreams: [...workstreamMap.values()].sort((left, right) => right.seconds - left.seconds).slice(0, 8),
    entities: [...entityMap.values()].sort((left, right) => right.secondsToday - left.secondsToday).slice(0, 12),
    standoutArtifacts: [...artifactMap.values()].sort((left, right) => right.generatedAt.localeCompare(left.generatedAt)).slice(0, 12),
    privacyFiltered: ordered.some((snapshot) => snapshot.privacyFiltered),
  };
}

const PATHLIKE_RE =
  /(^[a-z]:[\\/])|(^\/(users|home|var|tmp|private|system|applications)\b)|(^~\/)|([\\/][^\\/\s]+[\\/])/i;

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function hasVisibleLetters(value: string): boolean {
  return /[a-z0-9]/i.test(value);
}

export function looksLowValueLabel(value: string | null | undefined): boolean {
  if (!value?.trim()) return true;
  const trimmed = compactWhitespace(value);
  const key = trimmed.toLowerCase();
  if (!hasVisibleLetters(trimmed)) return true;
  if (trimmed.length <= 1) return true;
  if (PATHLIKE_RE.test(trimmed) || trimmed.includes("\\") || trimmed.includes("/")) return true;
  if (
    key === "unknown" ||
    key.startsWith("unknown-") ||
    key.startsWith("unknown ") ||
    key === "n/a" ||
    key === "na" ||
    key === "none" ||
    key === "null" ||
    key === "undefined"
  ) {
    return true;
  }
  return false;
}

export function shortDomainLabel(domain: string | null | undefined): string | null {
  if (!domain?.trim()) return null;
  const normalized = domain
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();

  if (looksLowValueLabel(normalized)) return null;
  return normalized;
}

export function formatVisibleEvidenceLabel(
  label: string | null | undefined,
  domain?: string | null,
): string | null {
  const trimmed = compactWhitespace(label ?? "");
  if (!looksLowValueLabel(trimmed)) {
    const normalizedDomain = shortDomainLabel(domain);
    if (!normalizedDomain || trimmed.toLowerCase() !== normalizedDomain.toLowerCase()) {
      return trimmed;
    }
  }
  return shortDomainLabel(domain);
}

export function appSummaryLookup(appSummaries: AppSummary[]): Map<string, AppSummary> {
  return new Map(appSummaries.map((summary) => [summary.appKey, summary] as const));
}

export function visibleAppUsage(
  item: { appKey: string; seconds: number },
  appLookup: Map<string, AppSummary>,
): VisibleAppUsage | null {
  const summary = appLookup.get(item.appKey);
  const displayName = formatVisibleAppName(summary?.displayName ?? item.appKey);
  if (!displayName) return null;
  return {
    appKey: item.appKey,
    displayName,
    bundleID: summary?.bundleID ?? item.appKey,
    category: summary?.category ?? "uncategorized",
    seconds: item.seconds,
    iconBase64: summary?.iconBase64,
  };
}

export function visiblePageEvidence(
  page: { label?: string | null; domain: string; seconds: number },
): VisiblePageEvidence | null {
  const label = formatVisibleEvidenceLabel(page.label, page.domain);
  const domain = shortDomainLabel(page.domain);
  if (!label || !domain) return null;
  return {
    label,
    domain,
    seconds: page.seconds,
  };
}

export function sanitizeRecapSummary(summary: RecapSummaryLite | null | undefined): SanitizedRecap | null {
  if (!summary?.hasData) return null;

  const headline = compactWhitespace(summary.headline ?? "");
  const chapters = (summary.chapters ?? []).filter((chapter) => {
    const eyebrow = compactWhitespace(chapter.eyebrow ?? "");
    const title = compactWhitespace(chapter.title ?? "");
    const body = compactWhitespace(chapter.body ?? "");
    return (
      !looksLowValueLabel(eyebrow) &&
      !looksLowValueLabel(title) &&
      !looksLowValueLabel(body) &&
      title.length > 3 &&
      body.length > 10
    );
  });

  const metrics = (summary.metrics ?? []).filter((metric) => {
    const label = compactWhitespace(metric.label ?? "");
    const value = compactWhitespace(metric.value ?? "");
    return !looksLowValueLabel(label) && !looksLowValueLabel(value);
  });

  const promptChips = (summary.promptChips ?? [])
    .map((chip) => compactWhitespace(chip))
    .filter((chip) => !looksLowValueLabel(chip) && chip.length > 6)
    .slice(0, 6);

  if (looksLowValueLabel(headline) || (chapters.length === 0 && metrics.length === 0)) {
    return null;
  }

  return { headline, chapters, metrics, promptChips };
}

export function buildAppDetail(snapshot: DaySnapshotV2, summary: AppSummary): DerivedAppDetail {
  const appLookup = appSummaryLookup(snapshot.appSummaries);
  const relatedBlocks = (snapshot.workBlocks ?? []).filter((block) =>
    block.topApps.some((item) => item.appKey === summary.appKey),
  );

  const headlineLabelSet = new Set<string>();
  const alongsideMap = new Map<string, VisibleAppUsage>();
  const siteMap = new Map<string, VisiblePageEvidence>();

  for (const block of relatedBlocks) {
    const cleanLabel = compactWhitespace(block.label);
    if (!looksLowValueLabel(cleanLabel)) {
      headlineLabelSet.add(cleanLabel);
    }

    for (const app of block.topApps) {
      if (app.appKey === summary.appKey) continue;
      const visible = visibleAppUsage(app, appLookup);
      if (!visible) continue;
      const existing = alongsideMap.get(visible.appKey);
      if (!existing || visible.seconds > existing.seconds) {
        alongsideMap.set(visible.appKey, visible);
      }
    }

    for (const page of block.topPages) {
      const visible = visiblePageEvidence(page);
      if (!visible) continue;
      const key = `${visible.domain}:${visible.label}`;
      const existing = siteMap.get(key);
      if (!existing || visible.seconds > existing.seconds) {
        siteMap.set(key, visible);
      }
    }
  }

  return {
    summary,
    headlineLabels: [...headlineLabelSet].slice(0, 4),
    relatedBlocks,
    alongsideApps: [...alongsideMap.values()].sort((left, right) => right.seconds - left.seconds).slice(0, 6),
    relatedSites: [...siteMap.values()].sort((left, right) => right.seconds - left.seconds).slice(0, 6),
  };
}

export function topVisibleDomains(domains: TopDomain[], max = 6): VisiblePageEvidence[] {
  return domains
    .flatMap((domain) => {
      const pages = (domain.topPages ?? []).map((page) => visiblePageEvidence(page)).filter(Boolean) as VisiblePageEvidence[];
      if (pages.length > 0) return pages;
      const label = shortDomainLabel(domain.domain);
      return label ? [{ label, domain: label, seconds: domain.seconds }] : [];
    })
    .slice(0, max);
}

export function readableBlockLabel(block: WorkBlockSummary): string {
  const trimmed = compactWhitespace(block.label);
  if (!looksLowValueLabel(trimmed)) return trimmed;

  const firstApp = block.topApps[0]?.appKey;
  const fallbackApp = firstApp ? formatVisibleAppName(firstApp) : null;
  return fallbackApp ? `Working in ${fallbackApp}` : "Unlabeled work block";
}

export function supportingBlockLine(
  block: WorkBlockSummary,
  appLookup: Map<string, AppSummary>,
): string | null {
  const firstPage = block.topPages
    .map((page) => visiblePageEvidence(page))
    .find(Boolean) as VisiblePageEvidence | undefined;
  if (firstPage) {
    return firstPage.label === firstPage.domain
      ? firstPage.label
      : `${firstPage.label} · ${firstPage.domain}`;
  }

  const appNames = block.topApps
    .map((item) => visibleAppUsage(item, appLookup)?.displayName)
    .filter(Boolean) as string[];
  if (appNames.length > 0) {
    return appNames.slice(0, 3).join(" · ");
  }

  return null;
}

export function visibleAppCount(snapshot: DaySnapshotV2): number {
  return snapshot.appSummaries.filter((summary) => Boolean(formatVisibleAppName(summary.displayName ?? summary.appKey))).length;
}

export function visibleSiteCount(snapshot: DaySnapshotV2): number {
  return snapshot.topDomains.filter((domain) => Boolean(shortDomainLabel(domain.domain))).length;
}

export function trackedSeconds(snapshot: Pick<DaySnapshotV2, "categoryTotals" | "appSummaries">): number {
  const fromCategories = snapshot.categoryTotals.reduce((sum, item) => sum + item.totalSeconds, 0);
  if (fromCategories > 0) return fromCategories;
  return snapshot.appSummaries.reduce((sum, item) => sum + item.totalSeconds, 0);
}

export function readableAppSummary(summary: AppSummary): string | null {
  return formatVisibleAppName(summary.displayName ?? summary.appKey);
}

export function readableFallbackAppName(appKey: string): string | null {
  return formatVisibleAppName(appKey) ?? formatDisplayAppName(appKey);
}
