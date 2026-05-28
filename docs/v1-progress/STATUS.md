# V1 status

Last updated: 2026-05-28 after shipping the F1-F7 V1 closeout fixes on `v1/main`. Apps Generate v3 remains code-proven: `generateAppNarrative` no longer short-circuits before the model when `force=true`, errors propagate to the renderer banner, and structured `[ai] app_narrative` / `[apps-narrative]` logs make any remaining failure observable in dev. Resume review also fixed the Week Review explicit Generate/Refresh path so `force=true` bypasses the signature cache there too; before this, the new button could still silently reuse a cached week review when evidence was unchanged. Typecheck and the focused Apps top-domains, recap, and block-label tests pass locally.

## V1 closeout ledger

| ID | Shipped on `v1/main` | Commit(s) | Proof |
|---|---|---|---|
| F1 | Browser page artifacts no longer leak into IDE/terminal block labels when the work-app evidence dominates. | `aca7e11`, `288a612` | category-compatible artifact gating plus page-label rejection in label finalization |
| F2 | Video/social/streaming page artifacts route blocks out of `development`, and focus scoring is loosened for steady deep-work days. | `219fd99` | `tests/blockLabelerCategoryFit.test.ts`, `tests/focusScoreV2.test.ts`, `npm run typecheck` |
| F3 | Timeline block inspector can regenerate an AI label from current block evidence, clear overrides, and show inline generation/error state. | `b8ed3cf`, UI in `288a612` | `npm run typecheck` |
| F4 | Work memory evening consolidation archives the day, extracts/promotes/decays patterns, and can same-day backfill generic labels. | `1aff369` | `npm run typecheck` |
| F5 | Day summaries, Week review, and Apps narratives inject promoted work memory and user facts into the system prompt. | `9a7a4a1` | `npm run typecheck` |
| F6 | Apps "What you did there" rolls repeated block labels up under promoted memory patterns. | `8d9c73a` | `npm run typecheck` |
| F7 | Settings exposes Work memory controls, pattern counts, top promoted patterns, per-row Forget, and Forget everything. | `0f75bc4` | `npm run typecheck` |

## Current verdict

The implementation is directionally useful but not professionally complete yet. TypeScript passes, and the screenshots show some real UX improvements, especially reduced Timeline card metadata and a cleaner Apps Day layout. However, several tracker claims were overstated:

- No credible proof was found for `<2ms` Settings load or `<30ms` Insights recap load.
- Week review content is visibly wrong/stale for older weeks in the screenshots.
- Apps still shows generic `Building & Testing` rows in 7d/30d.
- Timeline still shows generic `Building & Testing` and app-name summaries.
- The new persisted-block fast path reconstructs incomplete `WorkContextBlock` objects and should not be treated as fully equivalent to the dynamic path.

Use this file instead of the old per-agent notes.

## Status by issue

| ID | Issue | Current status | What is proven | Next step |
|---|---|---|---|---|
| 1 | Timeline density and descriptions | label + summary voice fix applied — needs screenshot validation | `code-proven`: `GENERIC_LABELS` now filters archetypal AI theme labels (Building & Testing, Inbox Triage, Terminal Work, Mixed Browsing, etc.); browser tab-title soup (3+ pipe segments) is rejected so AI/rule labels win; user overrides preserved verbatim; fallback uses naturalized top-artifact title before "Untitled block"; `blockShortSummary` rewritten to "Spent X verb noun, mostly in App with App as supporting context" voice with category-specific verbs and Inbox(N) → "email" normalization. `tested`: blockLabel.test.ts 5/5 pass. | Visually verify Day cards across categories. |
| 2 | Apps summaries auto-generate | Generate/Refresh actually re-runs the model (v3) — needs screenshot validation | The v2 explicit-handler change reached the IPC but the main-side `generateAppNarrative` still short-circuited on a matching `inputSignature`, returning the cached (often thin) narrative without ever calling the AI. `generateAppNarrative` now takes `force`; force=true bypasses the signature short-circuit and always fires the model. The catch path rethrows so the renderer can surface real errors. Renderer no longer `.catch(() => null)`s; it captures success/thin/no-bundle/error per scope and renders an inline status banner. Structured `[ai] app_narrative` and `[apps-narrative]` console logs cover entry, cache-hit, model-fired, parse-failed, stored, IPC return, and error paths. `typechecked`. Focused tests 19/19. | Verify in dev: click Generate on Today/7d/30d, watch `[ai] app_narrative running model for app:…` in the main log and `[apps-narrative] ipc returned …` in the renderer; narrative body must update or the banner must explain why. |
| 2a | Apps Day layout overflow | partially improved | `screenshot-observed`: Day layout no obvious horizontal scrollbar at captured size. `code-proven`: fixed grid `minWidth` changed to `0`. | Replace window-width breakpoint with container measurement; verify smaller widths. |
| 3 | AI/overall performance | risky partial implementation | `typechecked`: `getRecapRange` compiles. Week review correctness now addressed at the data layer (cache-only read + scopeKey verification). | Validate Week review fix on Desktop, then revisit `getRecapRange` parity. Add measured timings. |
| 3a | Week review shows wrong week content | `code-proven` fix applied — needs screenshot validation | `code-proven`: `getWeekReview` now reads cache only unless `force=true`; renderer verifies `scopeKey === week:${weekStart}`; auto-generation removed; button reads `Generate` until an explicit click. Resume review fixed the remaining force bug inside `generateWeekReview` itself, so explicit Generate/Refresh bypasses the signature cache and reaches the model. `typechecked`. Focused tests 19/19. | Visually verify in dev app: navigate between past weeks; confirm the prior week’s review never bleeds into the next; confirm Generate/Refresh runs AI only on explicit click and either updates the review or shows a clear failure. |
| 4 | Settings slowness | shell-first render applied — needs screenshot validation | `code-proven`: mount-time `Promise.all` split. `ipc.settings.get()` resolves first and unblocks the shell; CLI detection, diagnostics, sync, app summaries, category overrides, and default name now load independently after first paint and populate their own sections as they arrive. `typechecked`. | Visually confirm: opening Settings paints the shell immediately, and individual sections fill in over the next moment instead of one long blank state. |

## Review findings to address first

Code review of the `75f003e` v1-polish commit was completed on 2026-05-28 during the resume batch. One P1-style issue was fixed: Week Review's explicit Generate/Refresh path accepted `force=true` at IPC/export level but still let `generateWeekReview` return the cached row on signature match. That path now honors force end-to-end. No additional P0/P1 source issues were found in the reviewed changed files; existing accepted risk remains the lightweight recap payload parity concern below.

1. ~~**Week review shows wrong week content.**~~ Fixed at the data layer on 2026-05-28: `getWeekReview` is cache-only unless explicitly forced, the renderer rejects any payload whose `scopeKey` does not match `week:${weekStart}`, and the UI shows a `Generate` button instead of auto-running AI on week navigation. Pending Desktop screenshot validation.
2. ~~**Settings fix targets the wrong layer.**~~ Fixed on 2026-05-28: `Settings.tsx` mount path now awaits only `ipc.settings.get()` before rendering the shell. All other calls fan out independently and update their respective sections as they resolve, so first paint no longer waits on the slowest sibling. Pending screenshot validation.
3. **`getRecapRange` returns incomplete payloads.** Lightweight blocks have synthetic sessions, no segments, no websites, zero `appCount`/`siteCount`, and may skew recap logic that expects full payloads.
4. ~~**Apps Generate state is confused.**~~ Fixed on 2026-05-28 (v2): thin-signal cached narratives no longer count as a real narrative for button purposes, so those scopes show Generate. The "Generating…" message is gated on per-scope `activeGenerationScopes`, not on `narrativeResource.loading`.
4a. ~~**Apps Generate button does nothing visible.**~~ Fixed on 2026-05-28 (v3): `generateAppNarrative` was returning the cached narrative on signature match before reaching the AI, so `force=true` was a no-op whenever evidence had not changed. Signature short-circuit is now gated on `!force`, the function rethrows on failure, the renderer captures per-scope status (`ok` / `thin` / `no-bundle` / `error`), and diagnostic logs (`[ai] app_narrative`, `[apps-narrative]`) make any further silent failure observable in dev.
5. ~~**Naturalizing labels is too aggressive and too shallow.**~~ Fixed on 2026-05-28: archetypal AI theme labels (Building & Testing, Inbox Triage, Terminal Work, etc.) now sit in `GENERIC_LABELS`; browser-tab soup is rejected at 3+ pipe segments; user overrides are preserved verbatim; top-artifact title is used before "Untitled block".

## Validation state

| Check | Result |
|---|---|
| `npm run typecheck` | passed locally on 2026-05-28 |
| Focused unit tests | passed locally on 2026-05-28: `tests/appsTopDomains.test.ts`, `tests/recap.test.ts`, `tests/blockLabel.test.ts` (19/19) |
| Dev app screenshot review | done with Desktop screenshots from 2:00-2:01 PM |
| Runtime performance timings | not independently measured |
| Packaged app validation | not run |
| Windows/Linux parity | not run |

## Recommended next order

1. ✅ Week review correctness — fixed and screenshot-validated (May 11-17 generated review is grounded; May 25-31 stale cached row needs one user-driven Refresh).
2. ✅ Settings shell-first render — fixed (screenshot validation pending).
3. ✅ Apps Generate/Refresh semantics — v3 fix (root cause: signature short-circuit before AI on force=true) lands. Needs screenshot/log validation that `[ai] app_narrative running model …` appears on click and the narrative body actually changes.
4. ✅ Timeline labels and summary voice — fixed; Today screenshots show improved labels but flagged follow-ups below.
5. Revisit persisted timeline fast path only after tests prove parity with dynamic payloads.

## Open follow-ups raised during validation

- ~~**Browser artifact ownership leaks to non-browser apps.**~~ Fixed on 2026-05-28: domain policy now tags YouTube/Twitch/Netflix/etc. as `entertainment` (`219fd99`), `buildBlockFromCandidate` routes a block whose top page artifact is entertainment/social out of `development`/etc. (`219fd99`), `userVisibleBlockLabel` gates page/domain artifacts behind a category-compatibility check (`288a612`), and `preferredArtifactLabel` + the `finalizedLabelForBlock` AI-label path reject entertainment/social/adult page titles when the block has >=30% non-browser work-app share (`aca7e11`). Net: the 12:20 AM Kiro/Ghostty block no longer reads "FREE Apps We ACTUALLY Use."
- ~~**Focus score feels low.**~~ Addressed as part of the entertainment-categorization fix above (`219fd99`) — video-artifact blocks no longer count as focus-eligible development time, and the Timeline score now gives a day with steady deep-work blocks a 75-85 band instead of pinning it near 66.
- ~~**Regenerate label affordance request.**~~ Shipped on 2026-05-28: the Timeline block inspector now has a "Regenerate label" control next to the override input. Click fires the AI labeling job against the block's current evidence, drops any prior override flag, and surfaces the inline error if the request fails (`b8ed3cf`).
