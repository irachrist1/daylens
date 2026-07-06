# Shipping readiness — 2026-07-07

A pre-shipping audit of every macOS-facing surface after three sessions of
tracking-engine fixes (commits fad6cc0, 6df04fa, 93f5ffb) and this audit pass.

## What works

### Tracking engine
- Sleep/lid-close ends the open session via poll-gap detection (>60s hole),
  `suspend`/`lock_screen`, and `resume`/`unlock_screen` belt-and-braces.
- Incognito/private windows are never tracked (structured Chromium signal +
  title fallback), regardless of the Tracking Controls master switch.
- Browser detection uses the app catalog + OS registry, not a name regex;
  Dia, Comet, Zen, and future browsers work without a code change.
- System noise (loginwindow, Finder, SecurityAgent) is filtered in both the
  `app_sessions` and `derived_sessions` read paths.
- Corrections (merges, label/category overrides, deletes) survive rebuilds
  via span-keyed matching across the app_sessions/derived_sessions id flip.
- Auto-analyze runs on day rollover + startup-finalize, not just manual click.
- Site time reconciles against browser foreground time in every consumer path.

### Apps view
- Per-app totals match `SUM(app_sessions.duration_sec)` after clip/merge/min-dwell.
- Browser site breakdowns nest under the browser and sum to the header total
  by construction (`domains + "No page recorded" = header`).
- Category filter tabs, 7d/30d/All range switching, and "Smaller or Fleeting"
  are all internally consistent between renderer, IPC handlers, and queries.
- Verified against the live DB for 2026-07-06: no discrepancies.

### Timeline
- Block colors use `activityColorForCategory(block.dominantCategory)` with no
  provisional special-case. Live blocks color correctly as evidence accumulates.
- Gap labels: "Asleep" for overnight, "Away" for locked, "Idle" for
  sub-threshold, "Untracked" when <50% cause coverage.
- Day/week/month views share one color resolver (`CalendarBlockCard`).
- Right-click context menu opens on any block, including provisional ones.

### AI / Insights
- Resolver-first: every question resolves from the DB, the model phrases.
  No agentic tool-loop, no hallucinated numbers.
- `getAppUsage` uses `getReconciledDomainIntervals` for site time (not raw SUM).
- `getDaySummary` reads from blocks (`app_sessions`), not `website_visits`.
- Zero `SUM(duration_sec)` queries remain in the AI path.
- AI numbers match Timeline and Apps by construction (shared data path).

### Settings
- Color overrides persist (electron-store) and apply live + on restart.
- Privacy & Tracking: incognito gate, app/site exclusions, and purge flows
  all work end-to-end. Excluding an app deletes its history from all tables
  and re-projects affected days.
- Memory section shows real `work_memory_facts` with add/edit/delete/rebuild.
- Capture Health shows real diagnostics: window-title samples, Safari FDA
  status, browser discovery, platform permissions. Refreshes every 5s.

### History / Recap
- Day totals come from `app_sessions` via blocks (not website_visits or
  derived_sessions alone).
- Recap generates from real block data via `getTimelineDayPayload`.
- Corrections survive rebuilds (span-keyed merge/review tables).

### Security (this audit)
- macOS ad-hoc updater now verifies SHA-256 of the downloaded ZIP against the
  GitHub release digest before staging. Fail-closed: no digest → manual download
  only, never auto-install. Bundle identity check (CFBundleIdentifier) before
  the swap script runs. Temp files cleaned up on any failure.

### Performance (this audit)
- Browser history reads (60s poll) now use async `fsp.copyFile` with
  `COPYFILE_FICLONE` (O(1) APFS clone) instead of sync `copyFileSync` on the
  main process. Reentrancy guard prevents overlapping polls.
- Active-tab fallback (5s poll) uses `COPYFILE_FICLONE_FORCE` first, falls
  back to bounded sync copy (<64 MB), skips larger files entirely.

### Reconciliation (this audit)
- `getDistractionByMonth/Hour/Domain` now bucket reconciled per-domain credits
  instead of raw `SUM(duration_sec)`.
- AI `aggregateSiteUsage` uses `getReconciledDomainIntervals` for site time.
- `workMemoryProfile` background-site ranking uses reconciled credits.

### Sweep fixes (this audit)
- `attribution.ts` `loadIdlePeriods`: event-type matching fixed (`lock_screen`,
  `suspend`, `away_start`, `unlock_screen`, `away_end` instead of `'lock'`,
  `'sleep'`, `'unlock'`, `'wake'`).
- `chunk2.ts` gap threshold: 5 min → 15 min (matches the founder decision
  from 2026-07-02 and the main engine's `IDLE_GAP_THRESHOLD_MS`).

## Known limitations (not blocking)

1. **Dia private windows without a title marker** are not structurally
   detectable (Dia's AppleScript exposes no window mode). A Dia private
   window with no "Private" in the title is still tracked. Revisit when Dia
   ships the property.

2. **Chrome history durations are estimates** (next-visit gap, clamped
   5s–1800s). They are stored in the same column as measured active-tab
   durations, distinguished by `source`. Every consumer now reconciles, but
   a `duration_estimated` flag column would make the distinction explicit.

3. **Three settings have no UI toggle**: `shareAIFeedbackExamples`,
   `launchOnGen`, `workMemoryConsolidationEnabled`. They work backend-only.
   Not bugs, but the user cannot change them from Settings.

4. **No standalone History view**. The Timeline day/week/month views serve
   as the history surface. If a separate History route is expected by the
   spec, it does not exist yet.

5. **`evidence_summary_json` of pre-v10 blocks** is stale (no `canonicalAppId`,
   old app summaries). Read-time backfill covers nesting, but any future
   consumer of `evidence.apps` must expect missing fields.

6. **Two parallel hydration paths** build `WorkContextBlock` in `workBlocks.ts`
  with subtly different fallbacks. They have not drifted into a bug, but they
  will eventually. Extract one shared path.

7. **macOS ad-hoc signing**. The app is ad-hoc signed (no Apple Developer ID).
  Fresh downloads can trigger Gatekeeper. The updater re-signs ad-hoc and
  clears quarantine on verified artifacts only. Shipping with Developer ID
  signing + notarization is the permanent fix.

## Deferred

- **Windows code-signing** is being addressed by a parallel session
  (Authenticode verification, NSIS publisher name, signed-build enforcement).
- **`duration_estimated` flag column** for distinguishing Chrome history
  estimates from measured active-tab durations.
- **Unified WorkContextBlock hydration** — extract one shared path from the
  two parallel builders in workBlocks.ts.
- **Learning-vs-detour classification** (DEV-119) — deferred from the
  2026-07-02 session.

## Requires manual QA before releasing

1. **Restart the dev app.** The running app predates the 2026-07-07 commit
   (updater verification, reconciliation fixes, sweep fixes). electron-store
   caches settings in memory; a restart ensures the new code is live.

2. **Re-analyze July 6.** The persisted AI blocks for July 6 were built from
   pre-repair data (the Dia blob). Re-analyze to rebuild from the corrected
   rows. This is the founder's pending action from the 2026-07-07 findings.

3. **Verify updater flow end-to-end.** Publish a release with a SHA-256
   digest, install the current build, and confirm: (a) the update shows as
   available with "Install update" enabled, (b) clicking install downloads,
   verifies the hash, and swaps the bundle. Then test with a release that
   has no digest and confirm only "Download manually" appears.

4. **Verify browser history poll doesn't block the UI.** Open a browser with
   a large History DB (>100 MB) and confirm the 60s poll doesn't cause a
   visible freeze. The APFS clone should make this instant on the same volume.

5. **Verify distraction numbers.** Open Settings and check that the
   distraction cost numbers are lower than before (raw SUM double-counted).
   They should now match the time shown in the Apps view for the same domains.

6. **Test the Timeline on a real day.** Verify block colors, gap labels
   ("Asleep" overnight, "Away" for shorter gaps), and that right-click works
   on live (provisional) blocks.
