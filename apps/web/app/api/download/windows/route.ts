import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { redirectLatestMatchingAsset } from "../_releaseAsset";

// Floor version for Windows downloads. The Windows release workflow builds unsigned
// installers when no Authenticode certificate secrets are configured (SmartScreen warns
// on first launch, same as all unsigned apps). Raise this floor whenever a new Windows
// build is published. Override at runtime via DAYLENS_MIN_SIGNED_WINDOWS_VERSION.
const MIN_WINDOWS_VERSION =
  process.env.DAYLENS_MIN_SIGNED_WINDOWS_VERSION?.trim() || "1.0.38";
const WINDOWS_STORE_URL = process.env.DAYLENS_WINDOWS_STORE_URL?.trim() || "";

export async function GET(request: NextRequest) {
  if (WINDOWS_STORE_URL) {
    return NextResponse.redirect(WINDOWS_STORE_URL, 302);
  }

  const version = request.nextUrl.searchParams.get("version");
  return redirectLatestMatchingAsset(
    (asset) => /Setup\.exe$/i.test(asset.name) || asset.name.endsWith(".exe"),
    { version, minVersion: MIN_WINDOWS_VERSION },
  );
}
