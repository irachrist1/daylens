# Changelog

Released versions only. Each entry is one line, factually verifiable, no aspiration.
Prior entries that overclaimed shipped behavior were removed during the May 2026
focus reset.

## v1.0.41 - 2026-05-31 — Timeline Coherence + AI Tab Rewrite

- The AI tab is rebuilt as a faster, minimal chat: the composer auto-grows with no per-keystroke layout work, new chat is instant, and the message list, composer, and history search render in isolation so typing, streaming, and searching no longer re-render each other.
- Local-history search is preserved at the top of the AI tab; the recap panel, hero day-summary, and separate files browser were removed in favor of inline artifact cards.
- Timeline and insights refreshes from foreground app switches are throttled to reduce repeated full-day rebuilds.
- AI block relabel writes now use one persistence path, and per-block Regenerate tells the model which label was rejected.
- Titleless, artifactless browser slivers between work stretches are absorbed without loosening distinct-topic or real-gap guards.
- AI provider settings support the branch's BYOK/OpenRouter cleanup.

## v1.0.40 - 2026-05-29 — Updater Recovery

- macOS in-app updates validate the downloaded ZIP size and stage the replacement before closing Daylens services.
- Update downloads show a progress bar as well as percentage text when the release feed provides byte sizes.
- The install button no longer opens the extra cleanup confirmation sheet before downloading, and update failures now use plain-language recovery copy instead of internal error text.

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
