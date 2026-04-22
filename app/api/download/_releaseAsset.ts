import { NextResponse } from "next/server";

const REPO = "irachrist1/daylens";
const RELEASES_API_URL = `https://api.github.com/repos/${REPO}/releases`;
const FALLBACK_URL = `https://github.com/${REPO}/releases`;
const ALLOWED_HOSTS = new Set([
  "objects.githubusercontent.com",
  "github.com",
  "github-releases.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);

type ReleaseAsset = {
  name: string;
  browser_download_url: string;
};

type ReleaseRecord = {
  assets?: ReleaseAsset[];
};

function safeDownloadUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return ALLOWED_HOSTS.has(parsed.hostname) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export async function redirectToLatestMatchingAsset(
  matches: (asset: ReleaseAsset) => boolean,
) {
  try {
    const res = await fetch(RELEASES_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "daylens-web",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.redirect(FALLBACK_URL);
    }

    const releases = (await res.json()) as ReleaseRecord[];
    for (const release of releases) {
      const asset = release.assets?.find(matches);
      if (!asset) continue;
      const safeUrl = safeDownloadUrl(asset.browser_download_url);
      if (safeUrl) {
        return NextResponse.redirect(safeUrl);
      }
    }

    return NextResponse.redirect(FALLBACK_URL);
  } catch {
    return NextResponse.redirect(FALLBACK_URL);
  }
}
