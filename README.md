# Daylens Windows

Daylens Windows is a local-first Electron app that tracks active windows, browser history, and focus sessions, then turns that activity into a timeline of what you were actually doing.

It stores the source data in local SQLite, keeps the renderer behind IPC, supports API and CLI AI backends, and can sync read-only snapshots to the shared Daylens web companion.

## Current surfaces

- `Today` for live tracking and daily totals
- `Focus` for manual focus sessions and guidance
- `History` for the per-day timeline
- `Apps` for app-level usage analysis
- `Insights` for AI and local-data answers
- `Settings` for provider, sync, theme, and startup options

## Read next

- [Current state](docs/CURRENT_STATE.md) for the compact source of truth
- [Development](#development) for common commands

## Development

- `npm start` runs the Electron app in development mode.
- `npm run typecheck` checks TypeScript without emitting build output.
- `npm run build:all` builds the main, preload, and renderer bundles.
- `npm run dist:win` builds the Windows installer and update metadata into `dist-release/`.
