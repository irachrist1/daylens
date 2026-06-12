import type { NextRequest } from "next/server";
import { redirectLatestMatchingAsset } from "../_releaseAsset";

export async function GET(request: NextRequest) {
  const assetKind = request.nextUrl.searchParams.get("asset") ?? "dmg";
  const arch = (request.nextUrl.searchParams.get("arch") ?? "").toLowerCase();
  const version = request.nextUrl.searchParams.get("version");

  return redirectLatestMatchingAsset((asset) => {
    const name = asset.name.toLowerCase();
    const archMatches = !arch || name.includes(`-${arch}.`);

    if (assetKind === "zip") {
      return name.endsWith(".zip") && archMatches;
    }

    if (assetKind === "pkg") {
      return name.endsWith(".pkg") && archMatches;
    }

    return (name.endsWith(".dmg") || name.endsWith(".pkg")) && archMatches;
  }, { version });
}
