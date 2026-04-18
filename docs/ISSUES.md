# Issues

## Current Known Constraints

- Real-machine Windows validation still matters even when tests pass.
- Unsigned Windows builds will still trigger SmartScreen warnings.
- The repo is still historically named `daylens-windows` even though the app now spans macOS, Windows, and Linux.
- Linux still needs real-machine validation on both X11 and Wayland sessions even after CI packaging lands.

## Current Validation Snapshot

Status captured during the pre-PR readiness pass on 2026-04-18.

- macOS: validated in the Electron dev run, not a packaged signed app. The app launched, top-level navigation rendered as `Timeline / Apps / AI / Settings`, the Timeline reconstructed persisted history across restarts, closing and reopening the main window kept the app alive, AI starter prompts worked, one freeform AI answer streamed visibly in the renderer, focus session start / stop / review worked from the AI surface, report/export requests produced Markdown / CSV / HTML artifacts with working open actions, Timeline block rename/reset worked, and Settings app-category overrides worked in the UI. This still needs real user validation before any of it should be called done.
- Windows: build targets, packaging config, and release workflow surfaces can be audited from this machine, but runtime behavior remains implemented pending verification until it is exercised on a real Windows machine.
- Linux: focused-window fallback wiring, diagnostics surfaces, packaging config, smoke script wiring, and release workflows can be audited from this machine, but runtime behavior remains implemented pending verification until it is exercised on real X11 and Wayland sessions.

## Launch Scope

### Pre-PR Launch Scope

- Make this repo the single cross-platform source of truth for macOS, Windows, and Linux.
- Finish core information parity: tracking, persistence, timeline, AI, apps, settings, exports, packaging, and release verification.
- Migrate the Linux runtime/release work that still matters out of `daylens-linux`.
- Prepare `daylens-linux` as a public MIT transition repo that points contributors back here.
- Keep statuses as `upon review` / `implemented pending verification` until real user validation happens.

### Post-PR Follow-On Scope

- Wrapped / daily-weekly-monthly recap UI in the AI surface.
- Recap notification polish and rollout tuning once the launch-critical parity work is stable.

## TickTick Triage

Imported from the Daylens backlog in TickTick on 2026-04-18.

### Open In This Electron Repo

- `Windows: Build Focus Sessions UI in AI chat tab` — implemented pending verification. The AI surface now exposes chat-triggered focus session start / stop / review flows inside the existing chat cards, and those flows worked in the macOS Electron dev run on 2026-04-18, but they still need real user validation and packaged-app validation before they should be called done.
- `Windows/Mac/linux Bug: Build Sync/Workspace UI in Settings` — implemented pending verification. Settings now exposes workspace status, creation, browser linking, recovery words, and disconnect flows. The local-only state rendered cleanly in the macOS Electron dev run on 2026-04-18, but workspace creation / linking still needs real user validation across platforms.
- `Windows/Mac/linux BUG: Wire distraction alerter to invalidation events` — implemented pending verification. Distraction checks are now triggered by tracking pulses and focus-session changes, and notification clicks route back into the app, but the actual UX still needs real-world validation.
- `Windows/Mac/linux BUG: Persist thumbs up/down ratings to DB` — implemented pending verification. Ratings are now persisted with AI messages and still emit product analytics, but the full collection loop still needs user validation and reporting review.
- `Windows/Mac/linux: Fine-tune AI chat responses` — the AI surface is much stronger now, but this is still an open quality pass rather than a clearly finished item. Followup prompts need to be improved a little bit too.
- `Windows/Mac/linux: Build App Category Customization in Settings` — implemented pending verification. Settings now exposes sparse top-app category overrides, and changing then resetting an override worked in the macOS Electron dev run on 2026-04-18, but it still needs real usage validation to make sure it stays uncluttered and worth keeping.
- `Windows/Mac/linux: Build Block Label Override (rename timeline blocks)` — implemented pending verification. Timeline block inspection now exposes local rename/reset actions, and rename plus reset worked in the macOS Electron dev run on 2026-04-18, but it still needs real usage validation before it should be called done.
- `Windows/Mac/linux: Build Reports/Export view` — implemented pending verification. By design this now lives in the AI surface instead of a dedicated reports tab: report/export requests can generate grounded Markdown, CSV, and HTML chart artifacts with open actions from chat, and that export path worked in the macOS Electron dev run on 2026-04-18, but the real end-user flow still needs validation.
- `Windows/Mac/linux BACKEND: Wire Anthropic prompt caching (cache_control headers)` — implemented pending verification. Anthropic request-side cache controls now mark the stable reusable system prefix for `stable_prefix` jobs and the repeated user payload for `repeated_payload` jobs while still respecting the prompt-caching toggle, but it still needs real provider-side validation against live requests.
- `Windows/Mac/linux BACKEND: Implement streaming for chat responses` — implemented pending verification. The renderer now receives streamed chat text through main-process orchestration, and visible streaming was validated in the macOS Electron dev run on 2026-04-18, but it still needs broader provider and UX validation across the supported routes.
- `Windows/Mac/linux BACKEND: Finish Linux focused-window parity in the unified repo` — implemented pending verification. Linux tracking now carries Hyprland, Sway, and X11/XWayland fallback paths plus ready / limited / unsupported diagnostics in Settings, but it still needs real-machine validation across those runtime combinations.
- `Windows/Mac/linux BACKEND: Refactor attribution to generic entity model OR document client-only scope` — implemented pending verification for client and project routing. Deterministic entity routing, follow-ups, and report/export generation now cover both clients and projects, but repos, classes, research topics, and internal workstreams still rely more heavily on block/artifact evidence than on a true generic entity layer.
- `Windows/Mac/linux BACKEND: Document workBlocks.ts formation heuristics` — implemented pending verification in canonical docs so the block-formation rules are no longer only implicit in code.
- `Windows/Mac/linux BACKEND: Wire week_review and app_narrative AI jobs` — implemented pending verification. Timeline week now requests cached `week_review` summaries with refresh/stale fallback behavior, and Apps detail now requests cached `app_narrative` summaries through Electron IPC and main-process orchestration, but the final UX still needs user validation.
- `Windows/Mac/linux BACKEND: Fix nightly block cleanup — too slow for backlog` — implemented pending verification. Background cleanup now sweeps pending history dates from the local database instead of revisiting only a short lookback window, and it marks already-good deterministic labels as reviewed so AI relabeling stays focused on weak unlabeled backlog blocks. Existing AI-labeled history is not automatically revisited yet, so any broader "full-history cleanup" wording would be overstated until that revisit path exists and is validated.
- `Windows/Mac/linux release: Add Linux packaging, smoke validation, and release workflows to the unified repo` — implemented pending verification. The active repo now carries Linux builder targets and CI workflow scaffolding, but it still needs end-to-end validation on real releases.
- `Windows/Mac/linux repo transition: Turn daylens-linux into a MIT-licensed transition repo` — implemented pending verification. The transition repo now carries an MIT license, a cleaned README that points contributors back to the unified repo, and only the Linux-specific docs that still help with runtime validation, but the final public-facing read still needs user confirmation.

### Already Landed Or Mostly Addressed

- `Windows BACKEND: Fix model tier routing — economy jobs using Opus` — fixed. Economy and balanced tiers now use cheaper models, and Opus is hard-pinned only for `report_generation`.
- `Windows/Mac/linux scope lock: Keep focus sessions inside AI and keep Wrapped out of the launch PR` — landed in docs. Focus sessions stay inside the AI surface; Wrapped remains explicitly post-PR.

## Documentation Rules

- Keep only these canonical docs up to date:
  - `docs/CLAUDE.md`
  - `docs/AGENTS.md`
  - `README.md`
  - `docs/ABOUT.md`
  - `docs/IDEAS.md`
  - `docs/ISSUES.md`

- Do not reintroduce parallel strategy docs, redesign specs, or duplicate architecture notes unless they are actively maintained and clearly necessary.
