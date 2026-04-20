import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const appRoot = path.join(repoRoot, "app");
const convexRoot = path.join(repoRoot, "convex");
const manifestOut = path.join(repoRoot, ".generated", "convex-public-manifest.json");

function collectFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, acc);
      continue;
    }
    if (/\.(ts|tsx|mts)$/.test(entry.name)) {
      acc.push(fullPath);
    }
  }
  return acc;
}

const convexFiles = collectFiles(convexRoot).filter(
  (file) => !file.includes(`${path.sep}_generated${path.sep}`)
);
const manifest = [];

for (const file of convexFiles) {
  const relative = path.relative(convexRoot, file).replace(/\\/g, "/").replace(/\.(ts|tsx|mts)$/, "");
  const moduleName = relative.replace(/\//g, ".");
  const content = fs.readFileSync(file, "utf8");
  const pattern = /export const (\w+)\s*=\s*(query|mutation|action)\(/g;
  for (const match of content.matchAll(pattern)) {
    manifest.push(`api.${moduleName}.${match[1]}`);
  }
}

manifest.sort();
fs.mkdirSync(path.dirname(manifestOut), { recursive: true });
fs.writeFileSync(manifestOut, JSON.stringify({ functions: manifest }, null, 2) + "\n");

const sourceFiles = collectFiles(appRoot);
const usedFunctions = new Set();
const pattern = /(?<![A-Za-z0-9_/:])api\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)\b/g;

for (const file of sourceFiles) {
  const content = fs.readFileSync(file, "utf8");
  for (const match of content.matchAll(pattern)) {
    usedFunctions.add(`api.${match[1]}`);
  }
}

const missing = [...usedFunctions].filter((fn) => !manifest.includes(fn)).sort();
if (missing.length > 0) {
  throw new Error(
    `Frontend references missing Convex functions:\n${missing.join("\n")}`
  );
}

console.log(`convex manifest ok: ${manifest.length} public functions, ${usedFunctions.size} frontend refs`);
