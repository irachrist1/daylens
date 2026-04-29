import type { NextRequest } from "next/server";
import { proxyLatestMatchingAsset } from "../_releaseAsset";

const MIN_SIGNED_WINDOWS_VERSION =
  process.env.DAYLENS_MIN_SIGNED_WINDOWS_VERSION?.trim() || "1.0.35";

export async function GET(request: NextRequest) {
  const version = request.nextUrl.searchParams.get("version");
  return proxyLatestMatchingAsset(
    (asset) => /Setup\.exe$/i.test(asset.name) || asset.name.endsWith(".exe"),
    { version, minVersion: MIN_SIGNED_WINDOWS_VERSION },
  );
}
