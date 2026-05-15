# Daylens

A local-first desktop activity tracker for macOS, Windows, and Linux.

Daylens captures app sessions, browser history (where supported), focus sessions, and reconstructed work blocks, then lets you inspect your day in **Timeline**, see what you did with each tool in **Apps**, ask questions about your day in **AI**, and keep tracking honest in **Settings**.

The current scope of work is three goals: a timeline that works on every platform, an Apps view that explains the work, and an AI that can answer any question about your day. Everything else is dropped or deferred. The full plan is in `docs/PLAN.html`.

## Status

This README was rewritten on 2026-05-12 after a focus reset. Past claims of cross-platform parity, runtime validation, and "in-progress" features that were not actually shipping were removed. What remains below is verifiable by reading the code or running the tests.

**What works in code (proven by tests, not by packaged-build use):**

- Foreground app-session tracking, self-capture filtering, live-session recovery after restart.
- Browser history ingestion on macOS and Windows (not Linux).
- macOS Safari active-tab context capture.
- Timeline reconstruction with sustained-context block splitting and label priority.
- AI chat with tool-calling on Anthropic, OpenAI, and Google. Deterministic router handles common shapes before any provider call.
- Wrapped day-recap with deterministic facts + non-blocking AI narrative + cache.
- Local AI artifacts (reports, charts, exports) persisted to SQLite + `userData/`.
- An opt-in MCP server at `packages/mcp-server/` reusing the same tool schemas.

**What is not yet proven on a real machine on any platform:**

Packaged-build install, daily-notification click-through, updater round-trip, onboarding flow from a fresh user, AI quality against live providers.

## Install

The download page is `https://christian-tonny.dev/daylens`. Release artifacts are published from CI:

- **macOS**: DMG and ZIP. Until Apple Developer ID notarization is set up, users see an "unidentified developer" warning on first launch and must click *Open Anyway* under System Settings → Privacy & Security.
- **Windows**: signed installer required for the public path. Until then, Windows installers are not published to the public update feed.
- **Linux**: AppImage, .deb, and .rpm.

## Use

Keyboard shortcuts:

- `Cmd+Alt+D` (macOS) / `Ctrl+Alt+D` (Windows, Linux) — open Daylens and toggle the command palette.
- `Cmd+K` / `Ctrl+K` — toggle the palette while inside the app.

The palette jumps between Timeline, Apps, AI, and Settings; opens today's or yesterday's Day Wrapped; starts or ends a focus session; searches your timeline; and triggers update checks.

## Development

```
npm start                  # run Electron in dev
npm run typecheck          # tsc --noEmit
npm run build:all          # main + preload + renderer + MCP bundles
npm run test:ai-chat       # main AI/chat regression suite
npm run ai:bench           # AI router regression harness
npm run contract:check     # validate shared remote contract

npm run dist:mac           # release artifact
npm run dist:win           # release artifact
npm run dist:linux         # release artifact
```

Local SQLite path on macOS: `~/Library/Application Support/Daylens/daylens.sqlite`.

AI release gate:

```
AI_BENCH_LIVE=1 ANTHROPIC_API_KEY=... OPENAI_API_KEY=... GOOGLE_API_KEY=... npm run ai:bench
```

`npm run ai:bench` always runs the deterministic router corpus. With `AI_BENCH_LIVE=1`, entries whose provider key is present also run a live provider check and write `tests/ai-bench/.last-live-results.json`. A live regression in any taxonomy family is a release blocker; missing keys skip only the affected live entry and print the skip reason.

## Docs

- `docs/PLAN.html` — the active strategic plan (three goals, current focus)
- `docs/AGENTS.md` — the product contract: what Daylens is supposed to be
- `docs/CLAUDE.md` — contributor sourcing rules

Past docs (`ISSUES.md`, `OVERVIEW.md`, `PRD.md`, `SRS.md`, `REMOTE_CONTRACT.md`, `INSTALL.md`, `SHORTCUTS.md`, `RELEASE.md`, `IDEAS.md`, `WINDOWS_SIGNING.md`, `WRAPPED_REDESIGN.md`, `ai-orchestration.md`) were deleted in the 2026-05-12 cleanup. The code is the source of truth.
