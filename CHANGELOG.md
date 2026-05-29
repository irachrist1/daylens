# Changelog

Released versions only. Each entry is one line, factually verifiable, no aspiration.
Prior entries that overclaimed shipped behavior were removed during the May 2026
focus reset.

## v1.0.38 - 2026-05-29 — Daylens 1.0 (First Stable)

- Work memory system learns workstream patterns from desktop activity and backfills across full history.
- Block coalescing merges fragmented timeline entries into 60–120 min work sessions.
- Active-time durations and proportional block sizing finalized in timeline view.
- AI evidence packing expanded to ~28k tokens with 32k output cap.
- AI surfaces route through linked workspace keys for project-aware context.
- Cross-platform release pipeline fixed (GitHub Actions token, GitHub-hosted runners for macOS/Linux).

### Fixed
- **Windows downloads work again.** New Windows installers are publishing to the download page after a stretch where the build pipeline was blocked. Until a code-signing certificate is in place, first launch on Windows still shows a SmartScreen "Windows protected your PC" prompt — click **More info** then **Run anyway** to continue. Setup details are tracked in [INSTALL.md](docs/INSTALL.md).

## v1.0.36 - 2026-05-04

- Command palette and global shortcut (`Cmd+Alt+D` / `Ctrl+Alt+D`).
- Browser pages from supported browsers feed into the timeline on macOS and Windows.

## v1.0.35 - 2026-04-30

- Timeline block splitting respects sustained context changes and caps long blocks.
- Apps detail focuses on what you used a tool for, not session counts.

## v1.0.34 - 2026-04-29

- Day Wrapped and Morning Brief notifications open a slide-based recap.
- Onboarding flow simplified.

## v1.0.33 - 2026-04-28

- Follow-up chip filtering hardened against grammar-word and stop-word leaks.
- Files tab refreshes after every completed turn.

## Earlier

Earlier versions (v1.0.27 through v1.0.32) shipped tracking, persistence, and the
initial AI surface. Their changelog notes were removed in the 2026-05-12 cleanup
because several claimed cross-platform parity or runtime validation that had not
actually happened.
