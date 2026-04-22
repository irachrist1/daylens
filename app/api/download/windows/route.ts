import { redirectToLatestMatchingAsset } from "../_releaseAsset";

export async function GET() {
  return redirectToLatestMatchingAsset(
    (asset) => /Setup\.exe$/i.test(asset.name) || asset.name.endsWith(".exe"),
  );
}
