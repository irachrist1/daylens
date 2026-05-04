import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { proxyLatestMatchingAsset } from "../_releaseAsset";

// The Windows release workflow requires a signed Authenticode certificate and is triggered
// separately from the main macOS release (push a `v{VERSION}-win` tag). This floor prevents
// the download endpoint from serving pre-signing-era unsigned builds. Lower it here when an
// older signed build needs to be the public fallback.
const MIN_SIGNED_WINDOWS_VERSION =
  process.env.DAYLENS_MIN_SIGNED_WINDOWS_VERSION?.trim() || "1.0.33";
const WINDOWS_STORE_URL = process.env.DAYLENS_WINDOWS_STORE_URL?.trim() || "";

export async function GET(request: NextRequest) {
  if (WINDOWS_STORE_URL) {
    return NextResponse.redirect(WINDOWS_STORE_URL, 302);
  }

  const version = request.nextUrl.searchParams.get("version");
  return proxyLatestMatchingAsset(
    (asset) => /Setup\.exe$/i.test(asset.name) || asset.name.endsWith(".exe"),
    { version, minVersion: MIN_SIGNED_WINDOWS_VERSION },
  );
}
