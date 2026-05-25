import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

function readJson(fullPath) {
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function normalizeSource(content) {
  return content.replace(/\r\n/g, "\n").trim();
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function readContractState(repoRoot) {
  const packagePath = path.join(repoRoot, "packages/remote-contract/package.json");
  const manifestPath = path.join(repoRoot, "packages/remote-contract/manifest.json");
  const sourcePath = path.join(repoRoot, "packages/remote-contract/index.ts");
  const pkg = readJson(packagePath);
  const manifest = readJson(manifestPath);
  const source = normalizeSource(fs.readFileSync(sourcePath, "utf8"));
  const sourceVersionMatch = source.match(/export const REMOTE_CONTRACT_VERSION = "([^"]+)";?/);

  if (!sourceVersionMatch) {
    throw new Error(`Unable to read REMOTE_CONTRACT_VERSION from ${sourcePath}`);
  }

  return {
    manifest,
    manifestPath,
    packagePath,
    pkg,
    source,
    sourceHash: sha256(source),
    sourcePath,
    sourceVersion: sourceVersionMatch[1],
  };
}

export function checkRemoteContract({
  repoRoot = process.cwd(),
  siblingRepo = "../daylens-web",
} = {}) {
  const local = readContractState(repoRoot);

  if (local.pkg.version !== local.manifest.version) {
    throw new Error(
      `Remote contract version mismatch: package.json=${local.pkg.version}, manifest=${local.manifest.version}`
    );
  }

  if (local.sourceVersion !== local.manifest.contractVersion) {
    throw new Error(
      `Remote contract version mismatch: source=${local.sourceVersion}, manifest=${local.manifest.contractVersion}`
    );
  }

  const siblingRoot = path.resolve(repoRoot, siblingRepo);
  const siblingSourcePath = path.join(siblingRoot, "packages/remote-contract/index.ts");
  const siblingManifestPath = path.join(siblingRoot, "packages/remote-contract/manifest.json");

  if (fs.existsSync(siblingSourcePath) && fs.existsSync(siblingManifestPath)) {
    const sibling = readContractState(siblingRoot);

    if (JSON.stringify(sibling.manifest) !== JSON.stringify(local.manifest)) {
      throw new Error(
        `Remote contract manifest drift detected.\nlocal: ${JSON.stringify(local.manifest)}\nsibling: ${JSON.stringify(sibling.manifest)}`
      );
    }

    if (sibling.source !== local.source) {
      throw new Error(
        `Remote contract source drift detected.\nlocal: ${local.sourcePath} (${local.sourceHash})\nsibling: ${sibling.sourcePath} (${sibling.sourceHash})`
      );
    }
  }

  return {
    contractVersion: local.manifest.contractVersion,
    sourceHash: local.sourceHash,
    version: local.manifest.version,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = checkRemoteContract();
  console.log("remote contract ok", result);
}
