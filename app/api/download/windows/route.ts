import type { NextRequest } from "next/server";
import { proxyLatestMatchingAsset } from "../_releaseAsset";

export async function GET(request: NextRequest) {
  const version = request.nextUrl.searchParams.get("version");
  return proxyLatestMatchingAsset(
    (asset) => /Setup\.exe$/i.test(asset.name) || asset.name.endsWith(".exe"),
    { version },
  );
}
