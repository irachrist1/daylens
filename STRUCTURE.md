# Repository structure

One npm-workspaces monorepo, one lockfile (root `package-lock.json`), installed with a
single `npm install` from the root. The live product is the Electron app in `src/`;
everything else supports it. Workspace members: `apps/web`, `packages/*`,
`services/billing`.

Import graph verified 2026-07-07 (grep over import/require/path references, excluding
`node_modules`, `.next`, `dist*`).

## Active — the product

| Directory | What it is | Imported / used by |
|---|---|---|
| `src/` | The Electron app: `main/` (Node main process), `preload/`, `renderer/` (React 19 SPA), `shared/` (types shared across processes, aliased `@shared/*`), `native/` (Swift + .NET capture-helper sources) | `tests/`, `packages/mcp-server` (bundles `src/main` DB code via the root `vite.mcp.config.ts`) |
| `apps/web/` | Next.js 16 + Convex web companion and marketing site. Workspace member. Its own sub-packages live in `apps/web/packages/{ai-models, prompt-builder, snapshot-schema}` — imported **only** by `apps/web` code, so they stay inside this workspace rather than at top-level `packages/`. | Nothing imports it; it consumes `packages/remote-contract` |
| `packages/remote-contract/` | `@daylens/remote-contract` — the shared wire-contract types between the desktop app and the web/Convex side. The one genuinely shared package. | `src/` (tsconfig + vite alias), `apps/web` (app + convex, `file:` dep), `packages/mcp-server`, `tests/`, `scripts/check-remote-contract.mjs` |
| `packages/mcp-server/` | `@daylens/mcp-server` — local stdio MCP server over the Daylens DB. Not independently built: bundled by root `vite.mcp.config.ts` into `dist/mcp-server/index.cjs`, spawned by `src/main/services/mcpServer.ts`. Deps come from the root. | `src/main/services/mcpServer.ts`, `tests/` |
| `services/billing/` | `@daylens/billing-service` — standalone Polar + Flutterwave billing service (`pg`). Workspace member so the root install covers its deps. Live code, **not yet deployed** (audit §6). | Nothing imports it; run via root `billing:*` scripts |
| `shared/` | One runtime resource: `app-normalization.v1.json` (app-identity catalog). **Not** the same thing as `src/shared/` — name collision, be careful. | `src/main` (appIdentity, tracking, versioning), `tests/` |
| `tests/` | Node test-runner suites (run through Electron via `scripts/run-tests.mjs`), plus loaders in `tests/support/` | — |
| `scripts/` | Build/verify tooling: `run-tests.mjs`, `build-capture-helper.sh`, `rebuild-natives.mjs` (postinstall), `check-remote-contract.mjs`, electron-builder hooks (`afterPack-native-modules.js`, `mac-afterSign.js`, `verify-packaged-natives.js`), smoke checks — plus a tail of one-off verification scripts the audit flagged for cleanup (`calendar-verify`, `cdp-eval`, `dev105-screenshots`, `spike-toolcalls-cli`, `timeline-v8-verify`, `__verify-*`) | root `package.json` scripts, CI workflows |
| `docs/` | Audits, findings, roadmaps, session prompts (`docs/agent-sessions/`), specs, ADRs | Humans and agents |
| `build/` | electron-builder static resources (icons, DMG background, tray icons, `linux/`) plus the gitignored `build/capture-helper` output | `electron-builder.config.js`, `forge.config.ts` |
| `.github/` | CI + release workflows (macOS/Windows/Linux/Store/preview, runtime verifies) | — |

## Inert — kept, not wired

| Directory | What it is | Status |
|---|---|---|
| `Casks/` | Homebrew cask for the macOS DMG — kept as the CLI/agent-friendly install path (`brew install --cask ./Casks/daylens.rb`); release automation not wired up yet, so bump `version` + `sha256` manually per release | Current (v1.0.44, verified against the GitHub release digest 2026-07-07) |
| `probes/` | A single manual Swift spike, `capture-probe.swift` | Unwired reference; the audit's `daylens-swiftUI` archive candidate does **not** exist in this repo |
| `assets/` | Empty except `.gitkeep` | Placeholder |

## Generated / untracked — never import from these

| Directory | What it is |
|---|---|
| `node_modules/` | Single install tree for all workspaces (gitignored) |
| `dist/` | Vite build output: main, preload, renderer, mcp-server (gitignored) |
| `dist-release/` | electron-builder output, ~360 MB locally (gitignored) |
| `logs/` | Runtime verification logs (gitignored) |
| `artifacts/` | QA screenshot output from verification scripts — deleted 2026-07-07 (founder-approved) and now gitignored; scripts may recreate it |
| `apps/web/.next`, `apps/web/.generated` | Next.js / codegen output |

## Wiring notes

- `@daylens/remote-contract` resolves three ways on purpose: tsconfig `paths` +
  vite alias in the Electron app (source-level, no build step), and an npm `file:`
  dependency from `apps/web` (satisfied by the workspace symlink).
- `postinstall` runs `scripts/rebuild-natives.mjs` (the `@electron/rebuild` JS API);
  the deprecated `electron-rebuild` CLI crashes on Node ≥ 26 (yargs 17 ESM/CJS shim)
  but is still used by CI workflows, which run Node 20/22.
- Root scripts are the entry points for everything: `web:*` proxy into `apps/web`,
  `billing:*` into `services/billing`, `build:all` produces every bundle.
