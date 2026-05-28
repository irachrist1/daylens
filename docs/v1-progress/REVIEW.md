# Review of current V1 implementation

Date: 2026-05-28  
Scope: current working tree, `npm run typecheck`, focused Apps/recap tests, and Desktop screenshots from 2:00-2:01 PM.

## Code review findings

### High — Week review wrong-content bug (fixed 2026-05-28, pending screenshot validation)

Original symptom: the May 18-24 screenshot showed a Week review that read `38h 24m tracked across 4 active days ... May 26 and 28`, even though the chart and totals belonged to a different week. The same review text appeared on the May 25-31 screenshot, suggesting old data was bleeding across week navigations.

Root cause: `getWeekReview` auto-generated on every navigation, and the renderer kept showing the previously loaded review while the new week was still loading. There was no defense against displaying a payload whose `scopeKey` did not match the selected week.

Fix (`code-proven`):

- `src/main/jobs/aiService.ts` — `getWeekReview(weekStartStr, force = false)` now reads `ai_surface_summaries` for the exact `week:${weekStartStr}` row when `force` is false; only `force=true` runs the AI generation path.
- `src/main/ipc/ai.handlers.ts` and `src/preload/index.ts` — IPC carries the `force` flag.
- `src/renderer/views/Timeline.tsx` — defensively discards any returned summary whose `scopeKey !== week:${weekStart}`; replaces the always-on `Refresh` button with `Generate` (becomes `Refresh` only once a real review exists for the exact week); removes the silent stale fallback message; generation is only triggered by an explicit user click.

Pending: screenshot validation in the dev app across at least two past weeks plus the current week.

### High — Settings shell-first render (fixed 2026-05-28, pending screenshot validation)

Original symptom: `Settings.tsx` waited on a single mount-time `Promise.all` covering `ipc.settings.get`, `ipc.ai.detectCliTools`, `ipc.tracking.getDiagnostics`, `ipc.sync.getStatus`, `ipc.db.getAppSummaries(30)`, `ipc.db.getCategoryOverrides`, and `ipc.app.getDefaultUserName` before rendering anything beyond `Loading settings…`. First paint was bounded by the slowest sibling.

Fix (`code-proven`): only `ipc.settings.get()` is awaited before flipping `settings` non-null and rendering the real shell. The other six calls now fan out in parallel afterwards; each one updates its own state slot when it resolves so the corresponding section can fill in independently. CLI/`hasApiKey` resolution is already handled by the existing reactive effect that listens to `cliTools` and `settings.aiProvider`. A `cancelled` flag prevents late writes after unmount.

Pending: visually confirm the shell paints immediately on Settings open and sections fill in progressively.

### High — `getRecapRange` lightweight payloads are not equivalent to full day payloads

`code-proven`: `getLightweightDayPayload` returns `DayTimelinePayload` objects with:

- `sessions: []`
- `websites: []`
- `segments: []`
- `appCount: 0`
- `siteCount: 0`
- blocks reconstructed from persisted block rows and evidence JSON

This may be acceptable for a dedicated recap-summary DTO, but it is risky to type it as full `DayTimelinePayload[]`. `recap.ts` reads block artifacts, switch counts, focus sessions, duration, and workstream labels. Some of that is reconstructed, some is synthetic, and some is missing.

Required next action: introduce a smaller `RecapDayPayload` type or prove parity with tests against `buildRecapSummaries`.

### High — Apps Generate/Refresh root cause: signature short-circuit before AI (fixed 2026-05-28 v3, pending log/screenshot validation)

The v2 fix wired an explicit async handler that called `ipc.ai.getAppNarrative(..., force=true)` and refreshed the cache-only resource. The IPC path was correct, but the main-side `generateAppNarrative` ran an unconditional cache short-circuit:

```ts
if (existingSignature === inputSignature) {
  const existing = getAISurfaceSummary(getDb(), 'app_detail', scopeKey)
  if (!appNarrativeHasStaleMetrics(existing)) return existing
}
```

Because `appNarrativeSignature` excludes totals (B4) and the thin-narrative marker `"thin app-specific signal"` is not matched by `appNarrativeHasStaleMetrics`, every click on an app whose evidence had not changed returned the same cached (often thin) narrative. The renderer's thin filter then rejected it, the narrative slot stayed empty, and the button cycled `Generating… → Generate` with no visible change. This is exactly the "button does nothing" symptom the user reported.

Fix (`code-proven`):

- `src/main/jobs/aiService.ts` — `generateAppNarrative(canonicalAppId, days, force=false)`; the signature short-circuit is gated on `!force`. With `force=true` the function always reaches `executeTextAIJob`. The catch path now rethrows so IPC propagates the failure to the renderer instead of returning a fallback that looks like success. Added structured `[ai] app_narrative` logs for: no-bundle skip, cache-hit, model-fired, parse-failed, stored.
- `src/main/jobs/aiService.ts` — `getAppNarrative(canonicalAppId, days, force=true)` now passes `true` through to `generateAppNarrative`.
- `src/renderer/views/Apps.tsx` — handler no longer swallows IPC failures with `.catch(() => null)`. It captures per-scope status (`ok` / `thin` / `no-bundle` / `error`) and renders an inline banner under the narrative paragraph so the user is never left guessing. Added structured `[apps-narrative]` logs for: click ignored, generating, ipc returned, generation failed.

Pending: in dev, click Generate on Today/7d/30d for a real app; confirm `[ai] app_narrative running model for app:…` shows up in the main-process log on every click; confirm `[apps-narrative] ipc returned …` shows up in the renderer console with a fresh `summary chars > 0`; confirm the rendered narrative body actually changes or the banner explains why (`thin`, `no-bundle`, or `error: <message>`).

### Medium — Apps past-day narrative scope (fixed 2026-05-28, pending screenshot validation)

`getAppNarrative` only accepts a numeric `days` arg, so past-day calls were silently keyed by `1d:<today>` while the renderer expected `1d:<selectedDate>`. The renderer's scopeKey guard correctly rejected the mismatched payload, but the result was a permanently-empty narrative slot with a `Generate` button that could never produce a matching scope row.

Fix (`code-proven`): hide the narrative section for past-day Apps (`narrativeSupported = !isAppsPastDay`). Selecting a past-day app now shows only the deterministic local summary, with no Generate/Refresh button to mislead the user. Re-enabling will require either a date-aware `getAppNarrative(rangeKey)` or a separate per-date scope key.

### Medium — Timeline labels and short summaries (fixed 2026-05-28, pending screenshot validation)

Visible copy used to surface archetypal AI theme labels (`Building & Testing`) and "duration on artifact in App and App" summaries that read like raw telemetry. Fixes:

- `src/shared/blockLabel.ts` — `GENERIC_LABELS` expanded with the archetypal AI theme labels (Building & Testing, Inbox Triage, Terminal Work, Mixed Browsing, General Productivity, Misc Tasks, Writing, Untitled Block, etc.) so they fall through to a more specific source.
- `src/shared/blockLabel.ts` — `isUsefulLabel` now rejects browser-tab-soup style labels at 3+ pipe segments outright, instead of only when the naturalized form is generic.
- `src/shared/blockLabel.ts` — user overrides are preserved verbatim (no longer naturalized), and the fallback chain now tries the naturalized top-artifact title before defaulting to "Untitled block".
- `src/renderer/views/Timeline.tsx` — `blockShortSummary` rewritten in human voice ("Spent {duration} {verb} {artifactPhrase}, mostly in {App} with {App} as supporting context."), with category-specific verbs/nouns and an `Inbox(N)` → `email` normalization for the email category.
- `src/renderer/views/Timeline.tsx` — artifact text is naturalized through `naturalizeLabel` before being inserted into the summary sentence.

Tests: `tests/blockLabel.test.ts` 5/5 pass (three were failing pre-fix and now pass: browser-tab soup rejected, fallback to cleaned site name when no useful label, user override preserved with pipes). `tests/blockLabelerCategoryFit.test.ts`, `tests/appsTopDomains.test.ts`, `tests/recap.test.ts` all 17/17 pass.

Pending: visual verification that Day cards across categories now read with the intended voice and that no card displays `Building & Testing` as its label.

### Low — Documentation claims were overstated

The old tracker claimed all issues were `done`, Settings was `<2ms`, and Insights was `<30ms`. This review did not find measured proof for those numbers. Those claims have been replaced in `STATUS.md`.

### Test results

Passed:

- `npm run typecheck`
- `npx cross-env ELECTRON_RUN_AS_NODE=1 electron --loader ./tests/support/ts-loader.mjs --test ./tests/appsTopDomains.test.ts ./tests/recap.test.ts`

These tests do not cover the new `getRecapRange` path, Settings first paint, or the stale Week review screenshot issue.

## Screenshot review

### Timeline Day — 2:00:14 and 2:00:16

Improved:

- Cards are less cluttered than the earlier screenshots.
- `What mattered` no longer dumps raw page-title arrays.

Still problematic:

- `Building & Testing` remains dominant and generic.
- Right rail still repeats generic theme labels.
- Descriptions remain app/page-centric, not activity-centric.
- Long gap row at bottom still has heavy visual presence.

### Timeline Week — 2:00:25 and 2:00:30

Improved:

- Chart layout is clean.
- Basic week totals render.

Broken:

- Week review content is stale/wrong for May 18-24.
- Week review is still a dense paragraph and has a `Refresh` button that can trigger AI unexpectedly.

### Timeline historical Day — 2:00:37

Improved:

- Past day reconstructs visible blocks.

Still problematic:

- Some labels are better (`Diagram design review`, `VPN connection setup`), but other cards still read like fallback summaries.
- `What mattered` still feels like app evidence, not a human summary.

### Apps Day — 2:00:40 and 2:00:43

Improved:

- No obvious horizontal scrollbar at the captured window size.
- Day mode now shows an app list and detail panel.

Still problematic:

- Thin summary copy is shown as the main answer.
- `Refresh` is visible even when the user likely expects `Generate`.

### Apps 7d/30d — 2:00:49 and 2:00:51

Improved:

- Detail panel is fast-looking and more complete.
- Domain/app pairing lists are visually clean.

Still problematic:

- Row headlines still show `Building & Testing` across many apps.
- Generated/cached summaries still include broad inferences like "primary terminal across the week" and should be treated as cached AI, not deterministic proof.

### AI — 2:00:59, 2:01:15, 2:01:20

Improved:

- AI view is usable in the screenshot.
- Search/results panel renders.

Still problematic:

- Answer quality remains paragraph-heavy.
- Search results expose raw URLs with query strings; separate sanitization work may still be needed.

## Consolidation note

The previous files under `agent-notes/` and `investigation/` were useful during parallel exploration, but their contents now conflict with the latest code and screenshots. Moving forward, update only:

- `README.md`
- `STATUS.md`
- `REVIEW.md`
