# Daylens Web

Marketing site and optional browser-access surfaces for Daylens.

This repo is not the product source of truth. The unified cross-platform product,
launch status, and canonical docs now live in:

- [daylens](https://github.com/irachrist1/daylens)

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

## Launch truthfulness rules

- Keep Linux routed through status/transition messaging until real-machine
  validation is complete.
- Do not overclaim Wrapped or yearly recap features.
- Keep the top-level desktop shape consistent with Timeline / Apps / AI /
  Settings.
- Treat workspace and sync flows as optional additions to a local-first desktop
  product.
