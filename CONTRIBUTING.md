# Contributing to Daylens

Thanks for your interest in improving Daylens. This guide covers how to set up
the project, the conventions we follow, and how to get a change merged.

Be respectful and constructive in issues and pull requests. We want this to be
a welcoming project to contribute to.

## Project overview

Daylens is a cross-platform desktop app built with Electron, React, and
TypeScript. It captures local activity, reconstructs a work timeline, and lets
you query it with an AI assistant. It is local-first: activity data lives in a
local SQLite database and never leaves your machine except when you explicitly
send a query to an AI provider you have configured.

High-level layout:

- `src/main` — Electron main process: capture, database, jobs, AI services, IPC.
- `src/renderer` — React UI (timeline, apps, insights, settings, onboarding).
- `src/shared` — types and helpers shared across processes.
- `tests` — Node test-runner suites and AI evaluation harnesses.
- `docs` — architecture decision records and the update-recovery runbook.

## Prerequisites

- Node.js 20 or newer (the version Electron 34 ships with).
- A C/C++ toolchain for native modules (`better-sqlite3`,
  `@paymoapp/active-window`, `keytar`):
  - macOS: Xcode Command Line Tools (`xcode-select --install`).
  - Windows: Visual Studio Build Tools with the "Desktop development with C++"
    workload.
  - Linux: `build-essential` and `libsecret-1-dev` (keytar needs libsecret).

## Setup

```bash
npm install
```

`npm install` runs a `postinstall` step that rebuilds native modules against
the bundled Electron runtime. If you change Node or Electron versions, run
`npm install` again so the native modules are rebuilt.

## Running and building

```bash
npm start            # launch the app in development
npm run typecheck    # TypeScript, no emit — run this before every PR
npm run build:all    # build main, preload, renderer, and helpers
npm run dist:mac     # package a macOS build (or dist:win / dist:linux)
```

## Tests

```bash
npm run typecheck    # always safe, always free
```

Important: some test and benchmark scripts call real AI provider APIs and
require your own API keys. They will incur real cost. These include
`ai:bench`, `test:behaviour`, `test:entity-prompts`, and parts of
`test:ai-chat`. Do not run them unless you intend to spend on API calls.

For most contributions, a passing `npm run typecheck` plus the offline unit
tests relevant to your change are sufficient. Continuous integration runs
typecheck on every pull request and never runs the paid suites.

## Making a change

1. Fork the repository and create a branch off `main`
   (`git checkout -b fix/short-description`).
2. Keep changes focused. One logical change per pull request.
3. Match the surrounding code style. The project is TypeScript with React
   function components; follow the patterns already in the file you are editing.
4. Run `npm run typecheck` and make sure it passes.
5. Use clear commit messages. We follow Conventional Commits, for example
   `fix(timeline): correct duration rounding` or `feat(ai): add export tool`.

## Pull requests

- Describe what changed and why. Link any related issue.
- Make sure CI is green.
- A maintainer will review. Be ready to iterate on feedback.
- Be patient and kind. This is a small project maintained in spare time.

## Reporting bugs and requesting features

- Bugs: open an issue with steps to reproduce, expected vs actual behavior,
  your OS, and the app version.
- Features: open an issue describing the use case and the problem it solves.
- Security issues: do not open a public issue. Follow [SECURITY.md](SECURITY.md).
