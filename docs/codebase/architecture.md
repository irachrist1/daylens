# Current architecture

> This document describes the current implementation. It is a navigation aid, not the source of truth. Verify its claims against the code before making a change.

## System overview

Daylens is an Electron desktop application with a React renderer, a local SQLite database, platform-specific capture paths, an optional web companion, a local MCP server, and a separate managed billing service.

```text
macOS / Windows / Linux signals      consented external signals
                │                              │
                └──────── observations ────────┘
                               │
                         local SQLite
                               │
                sessions, evidence, corrections
                               │
                   projections and services
                               │
             Timeline / Apps / AI / search / MCP
                               │
                    optional filtered sync
                               │
                     Next.js + Convex web
```

## Desktop runtime

`src/main/index.ts` owns the Electron lifecycle. It initializes settings and the database, registers IPC handlers, starts tracking when onboarding and privacy settings allow it, starts supporting schedules, creates the main window, and optionally starts the MCP server.

Platform capture enters through services under `src/main/services`. macOS and Windows have different adapters and fallbacks. Browser evidence is read separately and reconciled with foreground-browser time before it contributes to user-facing totals.

`src/main/services/database.ts` opens the local `better-sqlite3` database. The schema and forward-only migrations live under `src/main/db`; most existing reads and writes remain in the broad `src/main/db/queries.ts` module while narrower repositories are introduced incrementally.

Activity interpretation currently spans `src/main/core`, `src/main/services/workBlocks.ts`, correction services, and query helpers. The codebase is already moving toward explicit evidence and projection boundaries, but the migration is incomplete. Do not assume a folder name means all policy has moved there.

## Renderer boundary

The React application lives in `src/renderer`. `src/renderer/App.tsx` exposes the primary routes:

- `/timeline`
- `/apps`
- `/ai`
- `/settings`

The renderer does not access SQLite or Electron services directly. `src/preload/index.ts` exposes a typed API that calls registered main-process IPC handlers. Shared request and response types live in `src/shared`.

When adding behavior, keep policy in the main process or a pure shared module. The renderer should present product facts rather than independently recalculate them.

## Agent flow

The desktop AI surface sends a typed request over IPC to the main process. The current agent runtime in `src/main/agent/chatAgent.ts` uses the AI SDK streaming loop with Daylens tools and provider-specific model selection.

Agent tools read Daylens data through existing services and queries. This area is still being consolidated: a tool should expose a product-level fact or explicit command, not raw tables or a second definition of time and attribution.

Provider choice, retries, streaming, cancellation, and rate limits belong to agent infrastructure. Recorded activity remains product data rather than model output.

## Web and sync

`apps/web` contains the public site, linked web interface, and Convex backend. Desktop capture remains the primary source of activity. The remote contract in `packages/remote-contract` defines the filtered payload shared between desktop and web.

The current sync path sends live presence and selected day-level facts. Raw capture rows, full file paths, and unrestricted page data are not part of the normal cloud boundary. See [Web companion](web.md) for the implementation snapshot and current gaps.

## MCP

`packages/mcp-server` is a local stdio server bundled and launched by the desktop app when enabled. It is another consumer of Daylens facts and should not invent a parallel activity model.

## Billing

The desktop can call a configured provider directly with a person’s own key. Managed AI access uses `services/billing`, which tracks entitlements and provider cost without storing prompts, answers, or raw activity. See [Billing operations](../operations/billing.md).

## Current architectural risks

- `src/main/index.ts`, `src/main/db/queries.ts`, and several services own broad responsibilities.
- Similar facts are still assembled along more than one path.
- Capture, projection, correction, and presentation boundaries are not yet consistently enforced.
- The renderer and external interfaces can drift if shared product queries are not used.
- Local validation cannot prove deployed Convex and web parity.

Changes to these areas are made one behavior slice at a time. Existing databases, user corrections, and a runnable application must be preserved throughout the migration.

## Dependency direction

The intended direction is:

```text
interfaces → application services → domain logic → shared primitives
                         infrastructure ↗
```

Domain logic should not depend on Electron, React, model SDKs, or hidden global state. Infrastructure implements the platform, database, provider, and external-service interfaces that the application needs.
