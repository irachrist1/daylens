import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { proxyLatestMatchingAsset } from "../_releaseAsset";

const MIN_SIGNED_WINDOWS_VERSION =
  process.env.DAYLENS_MIN_SIGNED_WINDOWS_VERSION?.trim() || "1.0.35";
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
