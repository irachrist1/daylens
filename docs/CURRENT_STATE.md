# Current State

Daylens Windows is a Windows Electron app for understanding real work, not just app totals. It tracks foreground app sessions, browser history, and manual focus sessions, then uses deterministic rules plus AI to describe what was happening in the day.

## Product direction

- Local-first by default: raw activity data stays in SQLite on the machine.
- Interpretation over raw totals: the UI aims to surface tasks, work blocks, and meaningful patterns.
- AI is an enhancer, not the only product: exact questions should resolve from local data when possible, with AI used for harder synthesis and narration.
- Manual focus sessions still matter: they are a primary product surface, not a legacy fallback.

## What the app currently does

- Tracks the active window on a 5-second cadence.
- Ingests browser history from supported Windows browsers.
- Groups activity into work blocks and daily summaries.
- Provides a Today dashboard, Focus session flow, History timeline, Apps view, Insights chat, and Settings.
- Supports API-backed and CLI-backed AI providers.
- Sends optional daily recap and morning focus notifications.
- Uploads read-only snapshots to the web companion when linked.
- Ships updates through GitHub Releases / electron-updater.

## Current architecture

- Electron main process owns tracking, database access, AI orchestration, sync, notifications, and updates.
- Preload exposes a narrow IPC surface to the renderer.
- Renderer is React + Vite + Tailwind and only consumes data through IPC.

## Core data stored locally

- `app_sessions`
- `focus_sessions`
- `website_visits`
- `ai_conversations`
- `daily_summaries`
- `user_profiles`
- `user_memories`
- `generated_reports`

## Current constraints

- Browser tracking on Windows still needs real-machine validation in the wild.
- Windows releases are unsigned, so SmartScreen warnings are expected.
- ARM64 Windows builds are not shipped.
- The app is Windows-first, but the repo still carries a macOS path-collision workaround for shared development history.

## Design direction

- Compact, editorial, high-density UI.
- Strong hierarchy and minimal visual noise.
- Dark/light themes both matter.
- The app should feel analytical, not dashboard-generic.
