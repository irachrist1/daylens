import { NextRequest, NextResponse } from "next/server";
import {
  fetchPublishedReleases,
  findLatestMatchingReleaseAsset,
} from "../download/_releaseAsset";

const CANONICAL_PUBLIC_ORIGIN = "https://christian-tonny.dev";

function publicOrigin(request: NextRequest): string {
  const configured =
    process.env.DAYLENS_PUBLIC_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    "";
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      return configured.replace(/\/$/, "");
    }
  }
  if (process.env.NODE_ENV === "production") return CANONICAL_PUBLIC_ORIGIN;

  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost || request.headers.get("host") || request.nextUrl.host;
  const proto = request.headers.get("x-forwarded-proto") || request.nextUrl.protocol.replace(":", "") || "https";
  return `${proto}://${host}`;
}

function withBasePath(request: NextRequest, pathname: string, search?: URLSearchParams): string {
  const basePath = request.nextUrl.basePath || "";
  const url = new URL(`${basePath}${pathname}`, publicOrigin(request));
  if (search) {
    url.search = search.toString();
  }
  return url.toString();
}

export async function GET(request: NextRequest) {
  const platform = request.nextUrl.searchParams.get("platform");
  const arch = (request.nextUrl.searchParams.get("arch") ?? "").toLowerCase();

  if (platform !== "darwin" && platform !== "win32") {
    return NextResponse.json(
      { error: "Unsupported update platform." },
      { status: 400 },
    );
  }

  try {
    const releases = await fetchPublishedReleases();

    if (platform === "darwin") {
      const install = findLatestMatchingReleaseAsset(
        releases,
        (asset) =>
          asset.name.toLowerCase().endsWith(".zip") &&
          (!arch || asset.name.toLowerCase().includes(`-${arch}.`)),
      );
      if (!install) {
        return NextResponse.json(
          { error: "No published macOS update is available right now." },
          { status: 404 },
        );
      }

      const manualAsset =
        install.release.assets?.find(
          (asset) =>
            (asset.name.toLowerCase().endsWith(".dmg") ||
              asset.name.toLowerCase().endsWith(".pkg")) &&
            (!arch || asset.name.toLowerCase().includes(`-${arch}.`)),
        ) ?? null;

      return NextResponse.json({
        version: install.version,
        releaseName: install.release.name ?? `Daylens ${install.version}`,
        releaseNotesText: install.release.body ?? null,
        releaseDate: install.release.published_at ?? null,
        installUrl: withBasePath(
          request,
          "/api/download/mac",
          new URLSearchParams({ asset: "zip", version: install.version, ...(arch ? { arch } : {}) }),
        ),
        installFileName: install.asset.name,
        manualUrl: manualAsset
          ? withBasePath(
              request,
              "/api/download/mac",
              new URLSearchParams({ asset: "dmg", version: install.version, ...(arch ? { arch } : {}) }),
            )
          : null,
        releasePageUrl: install.release.html_url ?? null,
      });
    }

    const install = findLatestMatchingReleaseAsset(
      releases,
      (asset) => /Setup\.exe$/i.test(asset.name) || asset.name.toLowerCase().endsWith(".exe"),
    );
    if (!install) {
      return NextResponse.json(
        { error: "No published Windows update is available right now." },
        { status: 404 },
      );
    }

    const windowsUrl = withBasePath(
      request,
      "/api/download/windows",
      new URLSearchParams({ version: install.version }),
    );

    return NextResponse.json({
      version: install.version,
      releaseName: install.release.name ?? `Daylens ${install.version}`,
      releaseNotesText: install.release.body ?? null,
      releaseDate: install.release.published_at ?? null,
      installUrl: windowsUrl,
      installFileName: install.asset.name,
      manualUrl: windowsUrl,
      releasePageUrl: install.release.html_url ?? null,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Daylens could not reach the release service.";
    return NextResponse.json(
      { error: message },
      { status: 503 },
    );
  }
}
