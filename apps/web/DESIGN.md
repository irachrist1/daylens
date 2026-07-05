# Daylens Web — Design Guide

> Last reviewed: 2026-04-19. Use this as the positive reference for landing-page and docs-surface design decisions.

## Narrative alignment

- The unified `daylens` desktop repo defines the product story, platform truthfulness, and implementation status.
- This marketing site should align with that story instead of inventing a cleaner or more optimistic parallel narrative.
- Lead with local-first work history, the timeline as proof, and honest cross-platform status.

## Brand provenance

- Start from the Daylens app icon as the palette source: [`public/app-icon.png`](./public/app-icon.png).
- Primary brand blue: `#7CB9F5`.
- Hero gradient: `#7CB9F5` → `#1D4ED8` → `#0A0F1E`.
- Use white, glassy navigation and controls against deeper navy surfaces so the site still feels tied to the icon instead of borrowing a generic SaaS palette.

## Reference patterns

- Use ToDesktop as a quality benchmark for composition and finish, not as a cue to clone their copy or branding.
- Prefer a centered gradient hero with clear proof of the product below it.
- Keep the primary navigation capsule-like, bright, and slightly translucent.
- Use layered shadows and subtle glows for depth instead of flat borders everywhere.
- Typography should feel confident: heavier weights, tighter tracking, and a clear size hierarchy.
- Motion should be deliberate: `cubic-bezier(0.6, 0.6, 0, 1)` easing and transitions around `450ms` are the default reference.

## Implementation focus

- `app/globals.css`: design tokens, gradients, spacing, motion, and section surfaces.
- `app/components/LandingClient.tsx`: hero composition, proof sections, CTA hierarchy, and responsive structure.
- `app/components/MarketingChrome.tsx`: navigation, footer, and shared marketing framing.

## Guardrails

- Do not treat a color swap as a redesign.
- Do not overclaim product status beyond what the unified desktop docs support.
- Keep desktop, docs, and marketing surfaces visually related so Daylens still reads as one product.
- Mobile responsiveness is part of the design brief, not follow-up polish.
