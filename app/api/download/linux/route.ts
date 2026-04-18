import { NextResponse } from "next/server";
import { LINUX_STATUS_HREF } from "@/app/lib/platformLinks";

const REPO = "irachrist1/daylens-windows";

function fallbackResponse(request: Request) {
  return NextResponse.redirect(new URL(LINUX_STATUS_HREF, request.url));
}

export async function GET(request: Request) {
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
      return fallbackResponse(request);
    }

    const release = await res.json() as {
      assets: Array<{ name: string; browser_download_url: string }>;
    };

    // Prefer Linux installer assets from the unified cross-platform release source.
    const asset =
      release.assets.find((a) => a.name.endsWith(".AppImage")) ??
      release.assets.find((a) => a.name.endsWith(".deb")) ??
      release.assets.find((a) => a.name.endsWith(".rpm")) ??
      release.assets.find((a) => a.name.endsWith(".tar.gz"));

    if (!asset) {
      return fallbackResponse(request);
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
        return fallbackResponse(request);
      }
    } catch {
      return fallbackResponse(request);
    }

    return NextResponse.redirect(asset.browser_download_url);
  } catch {
    return fallbackResponse(request);
  }
}
