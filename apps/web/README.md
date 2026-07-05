# Daylens Web

Marketing site and optional browser-access surfaces for Daylens.

This app lives at `apps/web` in the Daylens monorepo. The repository root is the
product source of truth for shared contracts, product documentation, and releases.

## What lives here

- Public landing page and product story
- Docs, roadmap, and changelog pages
- Download and status routing
- Optional link, recovery, dashboard, history, and chat browser flows

The desktop app remains the primary Daylens experience. This repo should stay
aligned with the desktop product instead of drifting into a separate or more
optimistic story.

## Development

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
```

From the monorepo root, use `npm run web:dev`, `npm run web:typecheck`, or
`npm run web:build`.

## Launch truthfulness rules

- Keep Linux routed through status/transition messaging until real-machine
  validation is complete.
- Do not overclaim Wrapped or yearly recap features.
- Keep the top-level desktop shape consistent with Timeline / Apps / AI /
  Settings.
- Treat workspace and sync flows as optional additions to a local-first desktop
  product.
