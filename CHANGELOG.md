# Changelog

Released versions only. Each entry is one line, factually verifiable, no aspiration.
Prior entries that overclaimed shipped behavior were removed on 2026-05-12 as part of
the focus reset documented in `docs/PLAN.html`.

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
