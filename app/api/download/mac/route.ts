import { redirectToLatestMatchingAsset } from "../_releaseAsset";

export async function GET() {
  return redirectToLatestMatchingAsset(
    (asset) => asset.name.endsWith(".dmg") || asset.name.endsWith(".pkg"),
  );
}
