import { NextResponse } from "next/server";

const REPO = "irachrist1/daylens-linux";
const FALLBACK_URL = `https://github.com/${REPO}/releases/latest`;

export async function GET() {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "daylens-web",
        },
        // Cache the GitHub API response for 5 minutes
        next: { revalidate: 300 },
      }
    );

    if (!res.ok) {
      return NextResponse.redirect(FALLBACK_URL);
    }

    const release = await res.json() as {
      assets: Array<{ name: string; browser_download_url: string }>;
    };

    // Find the AppImage installer, fall back to .deb
    const asset =
      release.assets.find((a) => a.name.endsWith(".AppImage")) ??
      release.assets.find((a) => a.name.endsWith(".deb"));

    if (!asset) {
      return NextResponse.redirect(FALLBACK_URL);
    }

    // Validate the redirect target is actually GitHub/GitHub CDN before redirecting
    const ALLOWED_HOSTS = [
      "objects.githubusercontent.com",
      "github.com",
      "github-releases.githubusercontent.com",
    ];
    try {
      const parsed = new URL(asset.browser_download_url);
      if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
        return NextResponse.redirect(FALLBACK_URL);
      }
    } catch {
      return NextResponse.redirect(FALLBACK_URL);
    }

    return NextResponse.redirect(asset.browser_download_url);
  } catch {
    return NextResponse.redirect(FALLBACK_URL);
  }
}
