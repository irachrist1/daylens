# Architecture

Daylens Windows is an Electron app (main + preload + renderer) that tracks active window usage, browser history, and focus sessions, then exposes AI-powered insights locally while syncing read-only dashboard snapshots to the shared Daylens web companion. Core activity data still lives in local SQLite.

## Process layout

```
main process  (Node.js / Electron)
  ├── services/
  │   ├── tracking.ts     — polls @paymoapp/active-window every 5 s, flushes to DB
  │   ├── browser.ts      — polls Chromium browser history SQLite every 60 s
  │   ├── ai.ts           — provider bridge for AI chat and timeline analysis
  │   ├── database.ts     — better-sqlite3 singleton, runs schema migrations
  │   ├── snapshotExporter.ts — builds the shared DaySnapshot payload for web sync
  │   ├── syncUploader.ts — uploads snapshots to Convex on a 5-minute cadence
  │   ├── workspaceLinker.ts — creates/relinks the shared workspace and stores credentials
  │   └── settings.ts     — electron-store (JSON, outside the DB)
  ├── ipc/
  │   ├── db.handlers.ts      — DB read queries exposed via IPC
  │   ├── focus.handlers.ts   — focus session start/stop/query
  │   ├── ai.handlers.ts      — AI chat IPC bridge
  │   ├── settings.handlers.ts— settings get/set IPC bridge
  │   └── debug.handlers.ts   — debug panel info (tracking status, last classify)
  ├── db/
  │   ├── schema.ts       — DDL: app_sessions, focus_sessions, website_visits, ai_conversations
  │   └── queries.ts      — typed insert/select helpers (no raw SQL in handlers)
  ├── tray.ts             — system-tray icon + context menu (Show / Quit)
  └── index.ts            — entry: app lifecycle, BrowserWindow creation, IPC registration

preload (contextBridge)
  └── exposes window.api — typed IPC wrappers; no Node access from renderer

renderer  (React + Vite + Tailwind v4)
  └── views/
      ├── Today.tsx       — live tracking + today's totals
      ├── History.tsx     — per-day app usage breakdown
      ├── Apps.tsx        — all-time per-app stats
      ├── Insights.tsx    — AI chat interface
      ├── Focus.tsx       — focus session timer
      └── Settings.tsx    — API key, theme, launch-on-login
```

## IPC contract

All channels are declared as constants in `src/shared/types.ts` under the `IPC` object. Every call goes through `window.api.*` (contextBridge) — the renderer never touches `ipcRenderer` directly.

## Data model

| Table | Purpose |
|---|---|
| `app_sessions` | One row per contiguous window-focus session |
| `focus_sessions` | User-initiated focus timer records |
| `website_visits` | Per-visit rows from browser history |
| `ai_conversations` | JSON-serialised message arrays |

## Key decisions

- **`@paymoapp/active-window`** replaces `active-win` v8 (macOS-only). It is a native CJS module — synchronous `getActiveWindow()` — lazy-loaded so native binding failures are non-fatal.
- **`productName: "DaylensWindows"`** prevents `userData` path collision with the macOS Swift companion app that owns `~/Library/Application Support/Daylens/`.
- **Custom title bar** (`titleBarStyle: 'hidden'`) — renderer owns all chrome. Window controls (minimize/maximize/close) are handled via IPC (`window:minimize` etc.).
- **Hide-to-tray on close** — `win.on('close')` is cancelled unless `isQuitting` is set; real quit only via tray menu.
- **Shared snapshot contract** — Windows exports the same `DaySnapshot` shape as macOS, including per-domain `topPages`, so the web dashboard can merge both platforms consistently.

## AI implementation caveats learned during launch prep

- **Provider state must be provider-specific.** Model selection cannot be stored as a single global value once the app supports API keys plus local CLI providers. Each provider needs its own saved default model, and the UI must refresh immediately when the provider changes.
- **CLI providers are not API-equivalent.** Claude Code CLI and Codex CLI should be treated as local subprocess providers, not as drop-in Anthropic/OpenAI API replacements. They do not expose per-request token counts, prompt-cache usage, or reliable per-call billing data, and they do not support true streaming in the same way the API path does.
- **Billing UI must stay honest.** For CLI-backed providers, usage views should show request count and latency only and label billing as included with the subscription instead of inventing estimated cost numbers.
- **Budget guards should pause background work, not chat.** The daily AI spend cap should stop background synthesis work such as timeline labeling or notification generation once the cap is reached, while keeping interactive chat available.
- **Prompt caching depends on prompt shape.** The Anthropic path gets the best cache hit behavior when stable instructions live in a cacheable prefix and the volatile activity payload is appended afterward. Retry feedback should stay outside the cached prefix so failures do not poison reuse.
- **Missing CLIs must degrade gracefully.** If a selected local provider binary is missing, the app should warn clearly, provide install guidance, and fall back safely instead of leaving the AI surface in a half-configured state.
