# Daylens

Daylens is a local-first desktop activity tracker for macOS, Windows, and Linux. It captures app sessions, browser history, focus sessions, and reconstructed work blocks so you can inspect your day in `Timeline`, explain tool usage in `Apps`, ask grounded questions in `AI`, and keep tracking honest in `Settings`. Optional workspace linking adds a browser companion and remote sync, but the desktop app remains the capture engine and local source of truth.

This README was refreshed from the current code on 2026-05-04. Existing docs are treated as hypotheses, not authority. The implementation-status ledger is `docs/ISSUES.md`.

## What The Code Shows Today

- Tracking runs in the desktop main process, polls foreground activity every 5 seconds, persists a live-session snapshot, and recovers it after restart so the timeline is not purely in-memory (`src/main/services/tracking.ts`).
- Foreground tracking filters Daylens self-capture and Daylens project-title sessions before persistence, so debugging windows do not become user work evidence (`tests/trackingSelfCapture.test.ts`).
- Browser history ingestion exists for macOS and Windows; Linux is not implemented in `src/main/services/browser.ts`. Active browser-tab context (URL + page title) is sampled by the foreground loop on macOS and persisted via `src/main/services/browserContext.ts` and `tests/browserContextTracking.test.ts`. Windows active-tab capture is the next browser-evidence gap.
- Timeline reconstruction is persisted to SQLite `timeline_*` tables, includes gaps and low-activity compression, splits on sustained content-context shifts, caps deterministic blocks at 60 minutes, and prefers deterministic title/artifact labels over stale labels (`src/main/services/workBlocks.ts`, `tests/workBlockSplitting.test.ts`).
- Browser page titles flow into `work_session_evidence` so evidence-backed AI time questions ("How many hours did I spend on ASYV this week?") work even when no first-class client/project attribution exists (`src/main/services/attribution.ts`, `tests/attributionBrowserEvidence.test.ts`).
- AI orchestration is centralized in the main process with deterministic routing before LLM fallback, per-job provider routing, prompt redaction, streaming, retry/copy/rating, and persistent local threads + artifacts (`src/main/services/ai.ts`, `src/main/services/aiOrchestration.ts`, `src/main/services/artifacts.ts`).
- AI prompts for daily summaries, week reviews, app narratives, generated reports, router prose, and provider-backed chat prohibit raw app names as activity nouns (`tests/aiPromptPolicy.test.ts`). Deterministic AI focus readouts avoid user-visible focus percentages and instead describe longest focused-category stretches, switching, and evidence (`src/main/lib/insightsQueryRouter.ts`).
- An opt-in MCP server is shipped under `packages/mcp-server/`. It runs as a local stdio subprocess, reuses the same AI tool schemas, opens the local Daylens SQLite database read-only, and exposes a Settings config snippet for MCP clients (`packages/mcp-server/src/index.ts`, `src/main/services/mcpServer.ts`).
- Optional remote sync splits heartbeat/live presence and durable day sync; desktop builds privacy-filtered remote payloads, uploads heartbeat every 15 seconds and dirty days every 60 seconds (`src/main/services/remoteSync.ts`, `src/main/services/syncUploader.ts`, `src/main/services/syncState.ts`).
- Updates use the public Daylens update feed, sanitize legacy GitHub failures into concise manual-download guidance, refuse pre-release Windows assets below the signed-release floor, and bound download progress between 1–99% before install-ready state (`src/main/services/updater.ts`, `src/shared/updaterReleaseFeed.ts`, `tests/updaterReleaseFeed.test.ts`).

## Truthfulness Notes

Code-proven: local tracking and persisted timeline reconstruction; persistent AI threads and local artifacts; main-process AI orchestration with provider/model routing and usage telemetry; workspace linking, recovery words, browser link codes, heartbeat, and day-sync packaging.

Implemented pending verification: provider-backed AI flows in real runtime conditions; MCP client connectivity and answer quality; packaged runtime behavior across macOS, Windows, and Linux; linked multi-device remote freshness and failure recovery; week review, app narrative, report/export generation; macOS Safari active-tab context in a packaged build; Windows active-tab context (not yet implemented).

Still partial or intentionally limited: snapshot export currently emits `client` and `project` entities only (contract allows `repo` and `topic`); desktop-to-web shared AI continuity is unimplemented; web still carries both the new `remoteSync` truth-table path and a legacy `snapshots` path. See `docs/ISSUES.md` for the full ledger.

## Development

- `npm start` runs the Electron app in development mode.
- `npm run typecheck` checks TypeScript without emitting output.
- `npm run build:all` builds main, preload, renderer, and MCP bundles.
- `npm run contract:check` validates the shared remote contract wiring.
- `npm run test:ai-chat` runs the main desktop AI/chat regression suite.
- `npm run test:entity-prompts` runs the prompt-routing benchmark harness.
- `npm run dist:mac`, `npm run dist:win`, `npm run dist:win:store`, `npm run dist:linux` build release artifacts.

The local SQLite database is at `~/Library/Application Support/Daylens/daylens.sqlite` on macOS.

## Canonical Docs

- [docs/AGENTS.md](docs/AGENTS.md) — product and build contract
- [docs/CLAUDE.md](docs/CLAUDE.md) — contributor guide (read this before changing anything)
- [docs/ISSUES.md](docs/ISSUES.md) — current implementation status, known gaps, validation needs
- [docs/OVERVIEW.md](docs/OVERVIEW.md) — user journey walkthrough from download to first AI answer
- [docs/PRD.md](docs/PRD.md) — remote companion product definition
- [docs/SRS.md](docs/SRS.md) — current desktop + remote system architecture
- [docs/REMOTE_CONTRACT.md](docs/REMOTE_CONTRACT.md) — shared sync/AI contract, parity matrix, and remote execution plan
- [docs/ai-orchestration.md](docs/ai-orchestration.md) — main-process AI routing and persistence model
- [docs/SHORTCUTS.md](docs/SHORTCUTS.md) — command palette, global shortcut, and notification click-through
- [docs/INSTALL.md](docs/INSTALL.md), [docs/RELEASE.md](docs/RELEASE.md) — install and release workflows
- [docs/IDEAS.md](docs/IDEAS.md) — future work only
- [PLAN.md](PLAN.md), [CONTEXT.md](CONTEXT.md), [PROMPTS.md](PROMPTS.md) — pre-beta polish plan, agent context, and paste-ready implementation prompts
