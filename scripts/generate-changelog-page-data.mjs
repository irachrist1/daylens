import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const surfaces = [
  {
    id: "web",
    name: "Web companion",
    repoPath: repoRoot,
    versionSource: () =>
      JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")).version,
    description:
      "Marketing site, web companion access, linking, recovery, and public product pages.",
    changelogPath: path.join(repoRoot, "CHANGELOG.md"),
    repoUrl: "https://github.com/irachrist1/daylens-web",
    ignoredCommitPatterns: [
      /^sync changelog data for latest releases$/i,
      /^sync generated changelog data$/i,
    ],
  },
  {
    id: "mac",
    name: "macOS app",
    repoPath: path.resolve(repoRoot, "..", "daylens"),
    versionSource: () =>
      JSON.parse(
        readFileSync(path.resolve(repoRoot, "..", "daylens", "package.json"), "utf8")
      ).version,
    description:
      "Unified desktop macOS release with the shared timeline, AI, recap, and installer work.",
    changelogPath: path.resolve(repoRoot, "..", "daylens", "CHANGELOG.md"),
    repoUrl: "https://github.com/irachrist1/daylens",
    releaseUrl: (version) => `https://github.com/irachrist1/daylens/releases/tag/v${version}`,
  },
  {
    id: "windows",
    name: "Windows app",
    repoPath: path.resolve(repoRoot, "..", "daylens"),
    versionSource: () =>
      JSON.parse(
        readFileSync(path.resolve(repoRoot, "..", "daylens", "package.json"), "utf8")
      ).version,
    description:
      "Unified desktop Windows release with shared updater, tracking, recap, and AI behavior.",
    changelogPath: path.resolve(repoRoot, "..", "daylens", "CHANGELOG.md"),
    repoUrl: "https://github.com/irachrist1/daylens",
    releaseUrl: (version) => `https://github.com/irachrist1/daylens/releases/tag/v${version}`,
  },
  {
    id: "linux",
    name: "Linux app",
    repoPath: path.resolve(repoRoot, "..", "daylens"),
    versionSource: () =>
      JSON.parse(
        readFileSync(path.resolve(repoRoot, "..", "daylens", "package.json"), "utf8")
      ).version,
    description:
      "Unified desktop Linux release with AppImage, DEB, and RPM packaging from the shared repo.",
    changelogPath: path.resolve(repoRoot, "..", "daylens", "CHANGELOG.md"),
    repoUrl: "https://github.com/irachrist1/daylens",
    releaseUrl: (version) => `https://github.com/irachrist1/daylens/releases/tag/v${version}`,
  },
];

function git(repoPath, args) {
  return execFileSync("git", ["-C", repoPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

function recentCommits(repoPath, limit = 10) {
  const raw = git(repoPath, [
    "log",
    `-n${limit}`,
    "--date=iso-strict",
    "--pretty=format:%ad%x1f%as%x1f%h%x1f%s%x1e",
  ]);

  return raw
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [dateTime, date, shortHash, subject] = entry.split("\x1f");
      return { dateTime, date, shortHash, subject };
    });
}

function filterDisplayCommits(surface, commits) {
  const patterns = surface.ignoredCommitPatterns ?? [];
  if (patterns.length === 0) return commits;

  const filtered = commits.filter((commit) => {
    const subject = stripMarkdown(commit.subject);
    return patterns.every((pattern) => !pattern.test(subject));
  });

  return filtered.length > 0 ? filtered : commits;
}

function stripMarkdown(value) {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^-\s*/, "")
    .trim();
}

function sentenceCase(value) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function normalizeSectionLabel(label) {
  const normalized = label.trim().toLowerCase();

  if (normalized === "added" || normalized === "new") return "New";
  if (
    normalized === "changed" ||
    normalized === "improved" ||
    normalized === "improvements"
  ) {
    return "Improvements";
  }
  if (normalized === "fixed" || normalized === "fixes") return "Fixes";

  return sentenceCase(label.trim());
}

function compactTitle(surfaceName, items) {
  const first = stripMarkdown(items[0] ?? `${surfaceName} update`);
  const compact = first
    .split("—")[0]
    .split(":")[0]
    .split(",")[0]
    .split(".")[0]
    .replace(/^(Added|Fixed|Updated|Switched|Stopped|Tightened)\s+/i, "")
    .trim();

  const shortened =
    compact.length > 58 ? compact.split(/\s+/).slice(0, 7).join(" ") : compact;

  return sentenceCase(shortened || `${surfaceName} update`);
}

function introParagraphs(surfaceName, version, items, description) {
  const lead = compactTitle(surfaceName, items).replace(/[.!?]+$/, "").toLowerCase();
  const details = items.slice(0, 2).map((item) => {
    const text = stripMarkdown(item);
    return /[.!?]$/.test(text) ? text : `${text}.`;
  });

  return [`${surfaceName} v${version} centers on ${lead}.`, ...details, description].slice(
    0,
    3
  );
}

function parseMarkdownChangelog(surface) {
  if (!surface.changelogPath) return [];

  const content = readFileSync(surface.changelogPath, "utf8");
  const releaseMatches = [...content.matchAll(/^##\s+(.+)$/gm)];

  return releaseMatches
    .map((match, index) => {
      const heading = match[1].trim();
      if (/earlier releases/i.test(heading)) return null;

      const versionMatch = heading.match(/^(?:\[)?v?([^\]\s]+)(?:\])?\s*-\s*([0-9-]+)/i);
      if (!versionMatch) return null;

      const [, version, date] = versionMatch;
      const start = match.index + match[0].length;
      const end =
        index + 1 < releaseMatches.length ? releaseMatches[index + 1].index : content.length;
      const body = content.slice(start, end).trim();
      const sectionMatches = [...body.matchAll(/^###\s+(.+)$/gm)];
      const sections = [];

      if (sectionMatches.length > 0) {
        for (let sectionIndex = 0; sectionIndex < sectionMatches.length; sectionIndex += 1) {
          const sectionHeading = sectionMatches[sectionIndex][1].trim();
          const sectionStart =
            sectionMatches[sectionIndex].index + sectionMatches[sectionIndex][0].length;
          const sectionEnd =
            sectionIndex + 1 < sectionMatches.length
              ? sectionMatches[sectionIndex + 1].index
              : body.length;
          const block = body.slice(sectionStart, sectionEnd);
          const items = block
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.startsWith("- "))
            .map((line) => stripMarkdown(line));

          if (items.length > 0) {
            sections.push({
              label: normalizeSectionLabel(sectionHeading),
              items,
            });
          }
        }
      } else {
        const items = body
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.startsWith("- "))
          .map((line) => stripMarkdown(line));

        if (items.length > 0) {
          sections.push({
            label: "Improvements",
            items,
          });
        }
      }

      const flatItems = sections.flatMap((section) => section.items);
      if (flatItems.length === 0) return null;

      return {
        id: `${surface.id}-${version.replace(/[^\w.-]/g, "-")}`,
        version,
        date,
        title: compactTitle(surface.name, flatItems),
        intro: introParagraphs(surface.name, version, flatItems, surface.description),
        sections,
        linkUrl:
          typeof surface.releaseUrl === "function"
            ? surface.releaseUrl(version)
            : `${surface.repoUrl}/blob/main/CHANGELOG.md`,
        linkLabel:
          typeof surface.releaseUrl === "function"
            ? "View release"
            : "View source changelog",
      };
    })
    .filter(Boolean)
    .slice(0, 8);
}

function isOperationalCommit(subject) {
  return /^(prepare|release|sync|trim|rebuild|refresh)\b/i.test(
    stripMarkdown(subject).replace(/^(feat|fix|docs|chore):\s*/i, "")
  );
}

function synthesizeCommitReleases(surface, version, commits) {
  const relevant = commits.filter((commit) => !isOperationalCommit(commit.subject)).slice(0, 9);
  const chunks = [];

  for (let index = 0; index < relevant.length; index += 3) {
    chunks.push(relevant.slice(index, index + 3));
  }

  return chunks.map((chunk, index) => {
    const items = chunk.map((commit) =>
      stripMarkdown(commit.subject).replace(/^(feat|fix|docs|chore):\s*/i, "")
    );

    return {
      id: `${surface.id}-${version.replace(/[^\w.-]/g, "-")}-${index + 1}`,
      version,
      date: chunk[0]?.date ?? new Date().toISOString().slice(0, 10),
      title: compactTitle(surface.name, items),
      intro: introParagraphs(surface.name, version, items, surface.description),
      sections: [
        {
          label: "Improvements",
          items,
        },
      ],
      linkUrl: `${surface.repoUrl}/commit/${chunk[0]?.shortHash ?? ""}`,
      linkLabel: "View leading commit",
    };
  });
}

const generated = {
  generatedAt: new Date().toISOString(),
  surfaces: surfaces.map((surface) => {
    const commits = recentCommits(surface.repoPath);
    const displayCommits = filterDisplayCommits(surface, commits);
    const latest = displayCommits[0] ?? null;
    const version = surface.versionSource();
    const parsedReleases = surface.changelogPath != null ? parseMarkdownChangelog(surface) : [];
    const releases =
      parsedReleases.length > 0
        ? parsedReleases
        : synthesizeCommitReleases(surface, version, displayCommits);

    return {
      id: surface.id,
      name: surface.name,
      description: surface.description,
      version,
      repoPath: surface.repoPath,
      latestCommitDateTime: latest?.dateTime ?? null,
      latestCommitDate: latest?.date ?? null,
      latestCommitHash: latest?.shortHash ?? null,
      recentCommits: displayCommits,
      releases,
    };
  }),
};

const outputPath = path.join(
  repoRoot,
  "app",
  "changelog",
  "generatedChangelogData.ts"
);

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(
  outputPath,
  `// Auto-generated by scripts/generate-changelog-page-data.mjs\n` +
    `export const generatedChangelogData = ${JSON.stringify(generated, null, 2)} as const;\n`,
  "utf8"
);

console.log(`Wrote ${path.relative(repoRoot, outputPath)}`);
