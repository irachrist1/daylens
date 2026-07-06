# Daylens

A local-first desktop app that turns your laptop activity into a searchable timeline you can ask questions about — or plug into Cursor and Claude.

This is the Daylens monorepo. The Electron desktop app lives at the repository root, the Next.js web companion and public site live in `apps/web`, and shared contracts live in `packages`.

## The problem

You read docs, watch videos, and jump between apps all day. None of it stays easy to find later.

You need that article from last Friday, or what you worked on Tuesday morning. Browser history and your own memory fall short. Web-based AI starts from zero every session — it wasn't there when you learned it.

You shouldn't lose your own digital past because nothing was keeping track.

## What it does

Daylens runs quietly in your menu bar, logs what you actually did, and lets you ask grounded questions:

> *"What did I study about neural networks this week?"*

You get synthesized answers backed by exact times, domains, and page titles — not generic web knowledge.

```
09:20–10:15 (55m) Warp Agents: AI Coding Agents in Your Terminal
pages: Warp Agents | Codex use cases
```

## Install

**Mac (Apple Silicon) — Homebrew:**
```bash
brew tap irachrist1/daylens && brew install --cask daylens
```

**Mac / Windows / Linux — download:**
Get the latest installer from [GitHub Releases](https://github.com/irachrist1/daylens/releases/latest).

**From source (developers):**
```bash
git clone https://github.com/irachrist1/daylens.git && cd daylens
npm install && npm start
```

Run the web app:

```bash
cd apps/web
npm install
npm run dev
```

From the repository root, `npm run web:dev`, `npm run web:typecheck`, and `npm run web:build` provide the same common entry points.

## How it works

- **Foreground polling, not screenshots.** Captures your active app and window every few seconds via OS APIs; sub-10-second noise is discarded before it hits SQLite.
- **Browser history ingestion.** Safely reads Chrome, Edge, Brave, Arc, Dia, Comet, Safari, and Firefox history into the same timeline — no cloud upload. Browser detection uses the OS app registry, so new browsers work without a code change.
- **Blocks, not raw sessions.** Groups fragmented app switches and tab hops into named work blocks you can scan at a glance.
- **Resolver-first AI.** Every question resolves deterministically from the database first; the model phrases the answer in Daylens's voice. No agentic tool-loop, no hallucinated numbers.
- **Verified updates.** macOS ad-hoc updates verify the download's SHA-256 against the published release digest before swapping the app bundle; unverified releases fall back to manual download.
- **Opt-in MCP server.** Exposes your local timeline to Cursor and Claude Desktop when you toggle it on — off by default.
- **Zero-cloud by design.** Everything lives in `daylens.sqlite` on your machine; API keys sit in the OS keychain.

MIT License · Built by [Christian Tonny](https://github.com/irachrist1)
