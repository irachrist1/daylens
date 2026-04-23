import { NextResponse } from "next/server";

const REPO = "irachrist1/daylens";
const RELEASES_API_URL = `https://api.github.com/repos/${REPO}/releases`;
const FALLBACK_URL = `https://github.com/${REPO}/releases`;
const GITHUB_RELEASES_TOKEN =
  process.env.DAYLENS_GITHUB_RELEASES_TOKEN?.trim() ||
  process.env.GITHUB_TOKEN?.trim() ||
  null;

export type ReleaseAsset = {
  name: string;
  url?: string;
  browser_download_url?: string;
  content_type?: string;
  size?: number;
};

export type ReleaseRecord = {
  tag_name?: string;
  name?: string;
  body?: string;
  html_url?: string;
  published_at?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: ReleaseAsset[];
};

function githubHeaders(accept: string): Headers {
  const headers = new Headers({
    Accept: accept,
    "User-Agent": "daylens-web-release-proxy",
    "X-GitHub-Api-Version": "2022-11-28",
  });
  if (GITHUB_RELEASES_TOKEN) {
    headers.set("Authorization", `Bearer ${GITHUB_RELEASES_TOKEN}`);
  }
  return headers;
}

export function normalizeReleaseVersion(tagName?: string | null): string | null {
  const trimmed = (tagName ?? "").trim().replace(/^v/i, "");
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(trimmed) ? trimmed : null;
}

export async function fetchPublishedReleases(): Promise<ReleaseRecord[]> {
  const res = await fetch(RELEASES_API_URL, {
    headers: githubHeaders("application/vnd.github+json"),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = (await res.text()).trim();
    throw new Error(
      `GitHub releases lookup failed (HTTP ${res.status})${body ? `: ${body}` : ""}`,
    );
  }

  const payload = (await res.json()) as ReleaseRecord[];
  if (!Array.isArray(payload)) {
    throw new Error("GitHub releases lookup returned an invalid payload.");
  }

  return payload.filter((release) => !release.draft && !release.prerelease);
}

export function findLatestMatchingReleaseAsset(
  releases: ReleaseRecord[],
  matches: (asset: ReleaseAsset) => boolean,
  options?: { version?: string | null },
): { release: ReleaseRecord; asset: ReleaseAsset; version: string } | null {
  for (const release of releases) {
    const version = normalizeReleaseVersion(release.tag_name);
    if (!version) continue;
    if (options?.version && version !== options.version) continue;
    const asset = release.assets?.find(matches);
    if (!asset) continue;
    return { release, asset, version };
  }
  return null;
}

async function fetchAssetStream(asset: ReleaseAsset): Promise<Response> {
  const url = asset.url || asset.browser_download_url;
  if (!url) {
    throw new Error(`Release asset ${asset.name} is missing a download URL.`);
  }

  const useApiAsset = Boolean(asset.url);
  const res = await fetch(url, {
    headers: githubHeaders(
      useApiAsset ? "application/octet-stream" : "application/vnd.github+json",
    ),
    redirect: "follow",
    cache: "no-store",
  });

  if (!res.ok) {
    const body = (await res.text()).trim();
    throw new Error(
      `GitHub asset download failed (HTTP ${res.status})${body ? `: ${body}` : ""}`,
    );
  }

  return res;
}

export async function proxyLatestMatchingAsset(
  matches: (asset: ReleaseAsset) => boolean,
  options?: { version?: string | null },
): Promise<NextResponse> {
  try {
    const releases = await fetchPublishedReleases();
    const match = findLatestMatchingReleaseAsset(releases, matches, options);
    if (!match) {
      return NextResponse.json(
        { error: "No published download is available for this platform right now." },
        { status: 404 },
      );
    }

    const upstream = await fetchAssetStream(match.asset);
    const headers = new Headers();
    headers.set(
      "Content-Type",
      upstream.headers.get("content-type") ||
        match.asset.content_type ||
        "application/octet-stream",
    );
    headers.set(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(match.asset.name)}`,
    );

    const contentLength = upstream.headers.get("content-length");
    if (contentLength) {
      headers.set("Content-Length", contentLength);
    }

    return new NextResponse(upstream.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Daylens could not reach the release service.";
    return NextResponse.json(
      {
        error: message,
        fallbackUrl: FALLBACK_URL,
      },
      { status: 503 },
    );
  }
}
