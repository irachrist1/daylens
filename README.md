# Daylens

### Your digital life, made searchable and retrievable on demand.

Daylens is a **local-first personal memory system** for your laptop (macOS, Windows, and Linux). It quietly logs your foreground app sessions, browser history, focus sessions, and active work blocks, turning your raw behavioral history into a rich, structured database.

With a grounded **AI chat interface** and a built-in **Model Context Protocol (MCP) server**, Daylens lets you, and the AI tools you already use (like Cursor, Claude Code, or Claude Desktop), ask grounded questions about your digital past and retrieve exact context instantly.

## Why Daylens

People lose an immense amount of the information they consume because there is no reliable way to search their personal digital history. When you study a complex topic, read documentation, or work across many files, your context fragments fast:

- *"Where was that video on gradient descent I watched two weeks ago?"*
- *"Which article did I read on prompt caching last Friday?"*
- *"What client problems did I solve last Tuesday morning?"*

Daylens bridges this gap by acting as a personal context retriever. Your knowledge base is never lost, stays entirely private, and is instantly searchable.

## Key Features

- **Local-First Timeline Reconstruction** — Automatically groups fragmented app sessions and browser visits into coherent, named work blocks in real time. Inspect your day at a glance.
- **Grounded AI Chat** — Ask natural-language questions about your day (*"What did I study about neural networks this week?"*) and get synthesized answers backed by exact time and domain citations.
- **Background Content Indexer** — Enriches browser history from research and learning platforms by fetching page contents and generating topic-tagged AI summaries, so answers reflect *what you learned*, not just how long a tab was open.
- **Model Context Protocol (MCP) Server** — A built-in, opt-in MCP server that exposes your local work timeline to external AI tools. Query your activity directly inside Cursor or Claude Desktop.
- **Privacy by Design** — 100% of your data stays on your machine in a local SQLite database. No third-party servers, no remote tracking.

## How It Works

1. **It has your data.** Web-based assistants start from zero. Daylens holds a continuous, structured SQLite behavioral timeline and feeds grounded context to the model.
2. **Context-enriched ingestion.** The background indexer fetches visited pages, generates short topic-tagged summaries, and stores them in `content_summaries` for high-precision search.
3. **Hybrid query router.** A deterministic routing layer answers common questions (like exact duration matches) instantly, falling back to a multi-model tool-calling agent only when complex synthesis is required.

## Tech Stack

- **Core**: Electron, TypeScript
- **Frontend**: React 19, TailwindCSS v4, Lucide React, Recharts
- **Data & System Layer**: SQLite (`better-sqlite3`), a macOS Swift native capture probe, `keytar`
- **Integration**: Model Context Protocol (MCP), Sentry, PostHog

## Platform support

Daylens runs on macOS, Windows, and X11-based Linux sessions. Activity tracking
depends on the OS exposing the focused window. On **GNOME Wayland (Mutter)** —
the default on Ubuntu 24.04+ — the compositor does not expose the active window
by design, so window-level tracking does not work there yet. Sessions running
under X11, Sway, Hyprland, or KDE are unaffected. See
[issue #35](https://github.com/irachrist1/daylens/issues/35) for status.

## Getting Started

### Prerequisites

- Node.js 20 or newer.
- A C/C++ toolchain for native modules. See [CONTRIBUTING.md](CONTRIBUTING.md#prerequisites) for per-platform details.

### Setup

```bash
npm install                  # install dependencies and compile native bindings
```

### Develop & Test

```bash
npm start                    # run Daylens in Electron dev mode
npm run typecheck            # TypeScript compiler check
npm run test:ai-chat         # run the main AI/chat regression suite
```

> Some test and benchmark scripts (`ai:bench`, `test:behaviour`, `test:entity-prompts`, and parts of `test:ai-chat`) call real AI provider APIs with your own keys and incur real cost. See [CONTRIBUTING.md](CONTRIBUTING.md#tests) before running them.

### Build & Package

```bash
npm run build:all            # build main, preload, renderer, MCP, and capture-helper
npm run dist:mac             # package macOS DMG and ZIP artifacts
npm run dist:win             # package Windows installer
npm run dist:linux           # package Linux AppImage, .deb, and .rpm
```

If a macOS install is stuck on an old build and the in-app updater cannot repair itself, use the recovery runbook in [docs/UPDATE-RECOVERY.md](docs/UPDATE-RECOVERY.md).

## Privacy & Security

- **Zero-cloud storage** — no data leaves your machine by default.
- **Transparency** — view exactly what is captured in the Timeline and Apps views, and delete or filter any activity in Settings.
- **Explicit MCP authorization** — the local MCP server is off by default and only enabled via a Settings toggle.
- **Credential handling** — AI provider API keys are stored in the OS keychain via `keytar`, never in the repository or plain files.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

Daylens is released under the [MIT License](LICENSE).
