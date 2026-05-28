# V1 status

Last updated: 2026-05-28 after a third Apps Generate pass that found the real root cause: `generateAppNarrative` short-circuited on signature match before calling the AI, so `force=true` from the renderer never re-ran the model when evidence was unchanged. The cached (often thin) narrative was returned, the renderer rejected it as thin, and the button cycled silently. Now the signature short-circuit is `force`-gated, the model always fires on force, errors are surfaced in the UI, and structured `[ai] app_narrative` / `[apps-narrative]` logs let any further failure be observed in dev. Earlier in the day the Week review correctness fix, Settings shell-first render, and Timeline label/summary voice landed.

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
| 2 | Apps summaries auto-generate | Generate/Refresh actually re-runs the model (v3) — needs screenshot validation | The v2 explicit-handler change reached the IPC but the main-side `generateAppNarrative` still short-circuited on a matching `inputSignature`, returning the cached (often thin) narrative without ever calling the AI. `generateAppNarrative` now takes `force`; force=true bypasses the signature short-circuit and always fires the model. The catch path rethrows so the renderer can surface real errors. Renderer no longer `.catch(() => null)`s; it captures success/thin/no-bundle/error per scope and renders an inline status banner. Structured `[ai] app_narrative` and `[apps-narrative]` console logs cover entry, cache-hit, model-fired, parse-failed, stored, IPC return, and error paths. `typechecked`. Tests 19/19. | Verify in dev: click Generate on Today/7d/30d, watch `[ai] app_narrative running model for app:…` in the main log and `[apps-narrative] ipc returned …` in the renderer; narrative body must update or the banner must explain why. |
| 2a | Apps Day layout overflow | partially improved | `screenshot-observed`: Day layout no obvious horizontal scrollbar at captured size. `code-proven`: fixed grid `minWidth` changed to `0`. | Replace window-width breakpoint with container measurement; verify smaller widths. |
| 3 | AI/overall performance | risky partial implementation | `typechecked`: `getRecapRange` compiles. Week review correctness now addressed at the data layer (cache-only read + scopeKey verification). | Validate Week review fix on Desktop, then revisit `getRecapRange` parity. Add measured timings. |
| 3a | Week review shows wrong week content | `code-proven` fix applied — needs screenshot validation | `code-proven`: `getWeekReview` now reads cache only unless `force=true`; renderer verifies `scopeKey === week:${weekStart}`; auto-generation removed; button reads `Generate` until an explicit click. `typechecked`. | Visually verify in dev app: navigate between past weeks; confirm the prior week’s review never bleeds into the next; confirm Generate is the only path that runs AI. |
| 4 | Settings slowness | shell-first render applied — needs screenshot validation | `code-proven`: mount-time `Promise.all` split. `ipc.settings.get()` resolves first and unblocks the shell; CLI detection, diagnostics, sync, app summaries, category overrides, and default name now load independently after first paint and populate their own sections as they arrive. `typechecked`. | Visually confirm: opening Settings paints the shell immediately, and individual sections fill in over the next moment instead of one long blank state. |

## Review findings to address first

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
| Focused unit tests | passed: `tests/appsTopDomains.test.ts`, `tests/recap.test.ts` |
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

- **Browser artifact ownership leaks to non-browser apps.** Today's "FREE Apps We ACTUALLY Use" block (12:20 AM, dominant category `development`) labels itself with a YouTube video title because the top artifact is attributed to Kiro/Ghostty rather than Safari. Same root cause flagged in earlier B-series work — the artifact ownership rule still lets browser-tab pages bleed into IDE/terminal blocks. Fixing this is a data-attribution change, not a label fix.
- **Focus score feels low.** Today shows score 66 / focused 3h 43m / drift 3h 41m on 5h 20m tracked despite the user reporting they worked most of the time. Two likely drivers: (a) music-video YouTube blocks are categorized as `development` (see ownership leak above) so they don't add to focus *and* don't add to entertainment cleanly; (b) the focus/drift ratio thresholds may be too tight. Needs a dedicated pass on category assignment + focus heuristics.
- **Regenerate label affordance request.** User asked for a "regenerate" button "somewhere nice on the UI" so a bad block label can be refreshed without manual editing. Natural spot is inside the existing block inspector panel (next to the Save row of the label input), as a small icon/text button. Out of scope for the current batch; queued.
