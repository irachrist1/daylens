> ⚠️ **SUPERSEDED — council process artifact (Round 1/2). Do NOT use for implementation.**
> The canonical, assembled plan is [`../DAYLENS-V2-PLAN.md`](../DAYLENS-V2-PLAN.md). Kept for provenance only.

# Daylens v2 plan council scorecard - codex

Round 2 scorecard by `codex`.

Plans scored:
- `docs/plans/Daylens-v2-plan-claude.md`
- `docs/plans/Daylens-v2-plan-codex.md`
- `docs/plans/Daylens-v2-plan-cursor.md`
- `docs/plans/Daylens-v2-plan-gemini.md`

Scoring: `E/A/C` = evidence, accuracy of Now, clarity plus implementability of Should/Fix. Each number is 1-5.

## Executive ranking

All four plans correctly identify the central product failure: Daylens has many built surfaces, but the record is not trusted, so Timeline, Apps, AI, memory, briefs, and wraps inherit contradictions.

Best overall inputs for Round 3:
- `claude`: strongest granular product plan for capture, timeline, memory, morning/evening, build sequence, and screenshot-tied implementation decisions.
- `codex`: strongest live-app evidence and strongest cross-surface trust/state/privacy treatment, especially Apps, AI persistence, Settings authority, notifications, and correction invalidation.
- `cursor`: solid broad plan with useful registry additions and PMF sequencing, but less precise than `claude` and less live-verified than `codex`.
- `gemini`: useful concrete implementation ideas around user-edited block locking and frontend chat persistence, but weaker evidence discipline; it copies much of the registry, overstates several unverified surfaces, and sometimes jumps to code/schema changes before product behavior is fully specified.

For final assembly, use `claude` as the backbone for the PMF spine, then splice in `codex` live observations and trust/state/privacy details.

## Surface scores

| Surface | Best plan | Claude E/A/C | Codex E/A/C | Cursor E/A/C | Gemini E/A/C | Notes |
|---|---|---:|---:|---:|---:|---|
| Capture/tracking | `claude` | 4/5/5 | 5/5/4 | 4/4/4 | 3/4/3 | `claude` gives the clearest segmentation, duration, kind, system-noise, and exclusion fixes. `gemini` adds a concrete 5-minute threshold, but that threshold should be validated rather than copied as policy. |
| Timeline | `claude` | 4/5/5 | 5/5/4 | 4/4/4 | 3/4/3 | `claude` has the most implementable day/week breakdown and BlockView contract. `codex` uniquely live-confirmed Gemini mismatch and Jun 16 details. |
| Apps view | `codex` | 4/5/5 | 5/5/5 | 4/4/4 | 3/4/3 | `codex` adds live Today nuance and catches destructive per-domain delete controls. `gemini` is directionally right on app names/domain scoping, but under-specifies safety around deletion. |
| AI chat and Q&A | `codex` | 4/5/5 | 5/5/5 | 4/4/4 | 3/4/3 | `codex` live-reproduced Apps -> AI history loss and gives a resolver-first model. `gemini` usefully suggests root-mounted state, but jumps to implementation before resolver behavior is fully defined. |
| Memory | `claude` | 4/5/5 | 5/5/4 | 4/4/4 | 3/4/3 | `claude` best captures the "all browsing at 65%" pattern bug and proposes a concrete memory classification rewrite. |
| Morning brief | `claude` | 3/4/5 | 4/4/4 | 3/4/5 | 2/3/4 | No plan live-verified morning content. `gemini` states carousel/focus copy too confidently from PMF/code evidence. |
| Evening wrap | `claude` | 3/4/5 | 4/4/4 | 3/4/5 | 2/3/4 | No plan live-verified evening content. `gemini` has the right target but overclaims current UI without live proof. |
| Daily/weekly/monthly/annual wraps | `claude` | 4/5/5 | 5/5/4 | 4/4/4 | 3/3/3 | `gemini` says monthly/annual are deferred to v3, which conflicts with PMF's daily/weekly/monthly/annual wrap goal unless explicitly scoped as post-wedge. |
| Notifications | `codex` | 3/4/4 | 4/5/5 | 3/4/4 | 2/3/3 | `codex` best describes test notification paths, route/date payloads, and distraction false-positive risk. `gemini` asserts current copy without app evidence. |
| Settings, model selection, re-analyze | `codex` | 4/5/5 | 5/5/5 | 4/4/4 | 3/4/3 | `codex` live-confirmed Claude selected plus Gemini quota failure, and covers visible setting consequences. |
| Onboarding | `codex` | 2/3/3 | 2/4/4 | 2/3/3 | 1/2/2 | All plans are evidence-poor because no onboarding screenshots/live clean profile exist. `gemini` only has a user story, not a real onboarding plan. |
| Trust | `codex` | 4/5/5 | 5/5/5 | 4/4/4 | 3/3/4 | `gemini`'s locked-block idea is valuable, but adding a DB column is only one slice of trust and may not fit existing correction architecture. |
| Problem statement | `codex` | 4/5/5 | 5/5/5 | 4/4/4 | 3/4/3 | `gemini` captures the headline problem but is less evidence-rich and less nuanced. |
| Build sequence | `claude` | 4/5/5 | 5/4/3 | 4/4/4 | 3/3/3 | `claude` has the best sequence: dogfood baseline -> trust record -> morning -> evening. `gemini` lacks a dogfood/live screenshot gate and leans on `timeline:eval`. |
| Testing decisions | `claude` | 4/5/5 | 5/5/5 | 4/4/4 | 3/3/3 | `gemini` adds useful locked-block and AI persistence tests, but too much acceptance rests on automated tests rather than live product verification. |

## Surface-by-surface council notes

### Capture/tracking

Use `claude` as the primary plan. Its A1-A4 sections are the most specific: sustained dwell before cuts, one active duration, kind-driven tag, and system noise at ingest. Add from `codex`: corrections must invalidate downstream AI/wrap summaries; show gap reasons like idle, paused, permission-limited, or asleep.

Drop from final: "tracking exclusions are broken because the lists are empty." Empty lists only prove no user exclusions are configured. The broken part is system noise and the need to verify that configured exclusions affect capture and AI.

`gemini` contribution to consider: sustained off-task thresholding is the right concept, but the proposed hard 5-minute threshold should be treated as a hypothesis. The final should require fixture/live validation across coding, meetings, browser research, and leisure rather than bake in 300 seconds as universal truth.

### Timeline

Use `claude` as primary. It best specifies one day/week aggregate feeding header, cards, detail, shape-of-day, and week review. Add `codex` live observation: Tuesday, June 16 showed Gemini quota failure while Settings selected Claude Haiku 4.5, and live "What mattered" included Netflix/X.

Drop from final: treating Thu-Sun "No data" in the Jun 15-21 week as inherently broken. On the current date, Wednesday, June 17, 2026, Thu-Sun are future dates. The final plan should instead require future days to render as future/empty intentionally, while past missing days need gap reasons.

### Apps view

Use `codex` as primary with `claude` C1-C5 merged in. `codex` is the only plan to live-check Today, note that app names are better on the daily view than 7d/30d screenshots, and identify unsafe-looking delete controls beside every domain. `claude` has the clearest app-title hierarchy and browser-domain scoping.

Drop from final: "30d descriptive titles partially work" as a positive. A documentary title as the bold app-row title is still wrong for an Apps view. It may be useful evidence for activity summaries, not app identity.

### AI chat and Q&A

Use `codex` as primary and splice in `claude` D1. `codex` live-reproduced sidebar loss after Apps -> AI and frames local resolvers as the source of truth. `claude` is best on the important nuance that week answers partially work while today's tool result fails, so the final plan should not imply all AI retrieval paths are equally broken.

Keep from all plans: transforms should operate on prior assistant text; project/client questions need attribution plus graceful "no client configured yet" behavior; tables should be required for tabular answers.

`gemini` contribution to consider: root-mounted or otherwise durable chat state is a concrete implementation path for the sidebar loss bug, but the final should still specify the product contract first: per-thread generation lifecycle, cancel/switch behavior, persistence across navigation, and input recovery.

### Memory

Use `claude` as primary. It precisely captures the 19 promoted patterns, identical 65% confidence, and "browsing" monoculture. Add `codex`'s requirement that learned patterns must show evidence, last impact, and affected blocks.

### Morning brief

Use `claude` as primary. No plan has live proof of current morning content, so the final must mark Now as `UNVERIFIED - needs live test` except where the PMF doc/founder says legacy carousel/heuristics exist. The Should is stable: one screen, carryover first, clean-start fallback, deep link to yesterday.

Drop from final: any wording that presents code reading alone as proof the current shipped UI is broken. It is strong diagnostic evidence, but product truth still needs a live notification/opened morning screen.

### Evening wrap

Use `claude` as primary. Same caveat as morning: current 8-slide state should be marked founder/PMF/code-described and live-unverified. Keep the <=5 card target and leisure-day 2-card target.

### Daily/weekly/monthly/annual wraps

Use `claude` as primary for daily/weekly. Add `codex`'s caution: monthly and annual are unverified unless live-tested or directly demonstrated. The final should not overclaim annual as "not built" solely from PMF/registry unless Round 3 verifies it.

### Notifications

Use `codex` as primary. It includes the missing acceptance mechanism: manual test notifications, route/date/context payloads, body matching opened screen, and conservative distraction-alert rollout. Keep `claude`'s carryover-first body detail.

### Settings

Use `codex` as primary with `claude` provider centralization and memory details. The final should clearly state that Settings must be operational: provider/model, labels, clients, memory, exclusions, notifications, MCP, and theme either affect surfaces immediately or say "future only."

### Onboarding

Use `codex` as primary, but mark evidence weak. Round 3 should include onboarding as an open live-audit task: fresh profile, permissions, capture health, privacy defaults, optional AI setup, and first proof.

### Trust

Use `codex` as primary. The final should explicitly define trust states: inferred, low-confidence, corrected by user, hidden, deleted, excluded, stale summary, provider unavailable, and no data because future/paused/idle/permission.

`gemini` contribution to consider: manual edits need protection from later AI re-analysis. Do not blindly add a `locked` column without checking the existing review/correction schema; the final behavior should be "user corrections are authoritative until explicitly reset," whether implemented as a lock flag, correction record, or review state.

## Drops for Round 3

1. Drop any claim that a feature "works" without screenshot or live-app proof.
2. Drop "Thu-Sun no data is broken" for week Jun 15-21 without noting that on June 17, 2026, Thu-Sun are future dates.
3. Drop "tracking exclusions are broken because excluded lists are empty." Empty lists are configuration state, not proof of failed exclusion behavior.
4. Drop or soften "annual wrap is not built" unless Round 3 verifies it. Prefer `UNVERIFIED - needs live test` or "not evidenced in screenshots."
5. Drop "30d Apps naming partially works" as a positive signal when the app-row title is a documentary/coursework artifact instead of the app name.
6. Drop any morning/evening Now claim that relies only on code as product truth. Keep it as "PMF/founder/code-described; needs live test."
7. Drop any acceptance path that relies only on `npm test` or `timeline:eval`. Every phase needs live app verification and screenshots.
8. Drop generic "rewrite everything" language. All plans are strongest when they say modify/rewrite the specific policy or state layer while preserving existing infrastructure.
9. Drop `gemini`'s claim that the live block indicator is missing based only on founder evidence; `cursor` cites a LIVE tag in a screenshot, so the final should mark live-block behavior as partial/unverified rather than missing.
10. Drop `gemini`'s acceptance criterion that page deletion "permanently deletes" rows without specifying confirmation, undo/irreversibility, and downstream summary invalidation.
11. Drop `gemini`'s "monthly/annual wraps are deferred to v3" as a blanket scope decision. The PMF includes monthly and annual wraps; the final can sequence them later, but should not erase them from v2 unless the founder explicitly scopes them out.
12. Drop implementation-specific schema changes such as `ALTER TABLE timeline_blocks ADD COLUMN locked` until Round 3 verifies the existing schema and correction architecture. Keep the product requirement that manual corrections are authoritative.

## Gaps Every Plan Missed Or Underplayed

1. **Forgotten link retrieval.** PMF explicitly includes "that link you saw but forgot." The final AI/Q&A plan should add URL/page/artifact recall as a first-class resolver and test, not only today/week/project/time-at-moment questions.
2. **Historical data repair and cache migration.** All plans mention recompute/invalidation, but the final needs a concrete migration path for existing bad blocks, cached app summaries, week reviews, AI narratives, and memory patterns after the truth model changes.
3. **AI privacy boundary.** Settings says local history and external providers coexist, but none of the plans fully specifies what local history is sent to Claude/OpenAI/Gemini, how exclusions apply before provider calls, and how the user can understand that boundary.
4. **Capture health diagnostics.** Onboarding and Settings should expose whether permissions, browser URL capture, idle detection, private-window filtering, and helper processes are healthy. This is more than first-run permissions.
5. **Future-day semantics.** Week views need an explicit model for future days, no-data past days, tracking-paused days, and idle/off-computer days.
6. **Session-count sanity thresholds.** Plans call Safari 5,977 sessions suspicious, but final acceptance should define sane sessionization benchmarks or alerts so this class of bug cannot regress.
7. **Correction audit trail.** Plans say corrections propagate, but the final should specify how user edits are distinguished from AI inference and how to undo or inspect them.
8. **Destructive data action safety.** `codex` notes row delete risk, but the final should systematically cover delete app/site/page/block operations: confirmation, blast radius, undo or irreversible warning, and downstream cache invalidation.
9. **Packaging vs dev behavior.** MCP config and updates differ in dev vs packaged builds. The final should ensure Settings copy and acceptance criteria cover both, especially because screenshots show dev Electron paths.
10. **Accessibility and keyboard flows.** The AI chat, correction panel, settings forms, and notifications are productivity surfaces; no plan tests keyboard navigation or accessible names.
11. **Manual edit authority.** `gemini` raises this, but the final should generalize it: re-analysis, memory rebuild, app-label overrides, and weekly regeneration must not overwrite user corrections without an explicit reset path.

## Recommended final assembly map

| Final plan section | Pull primarily from | Add from |
|---|---|---|
| Problem Statement | `codex` | `claude` contradiction examples |
| Solution | `claude` | `codex` trust-state framing |
| Feature map | `codex` | `claude` corrected rows and `cursor` missing rows |
| Capture/tracking | `claude` | `codex` gap reasons and invalidation |
| Timeline | `claude` | `codex` live Gemini/Jun16 observations |
| Apps | `codex` | `claude` app-title hierarchy and domain scoping |
| AI chat/Q&A | `codex` | `claude` today-vs-week tool-path nuance |
| Memory | `claude` | `codex` evidence/impact display |
| Morning | `claude` | `codex` clean-start wording |
| Evening | `claude` | `codex` trust alignment |
| Wraps | `claude` | `codex` unverified monthly/annual caution |
| Notifications | `codex` | `claude` carryover-first body |
| Settings | `codex` | `claude` provider centralization and memory rewrite |
| Onboarding | `codex` | `cursor` local-only expectation |
| Trust | `codex` | `claude` BlockView contract; `gemini` manual-edit authority requirement |
| User stories | `cursor` | `codex` privacy/safety stories |
| Implementation Decisions | `claude` | `codex` correction/invalidation contract; validate `gemini` lock concept against existing schema |
| Testing Decisions | `claude` | `codex` privacy/onboarding/correction tests; `gemini` locked-edit and AI persistence tests |
| Build sequence | `claude` | `cursor` phase checklist style |

## Final council call

No plan should be copied wholesale. The strongest final plan is:

1. `claude`'s PMF sequencing and detailed repair plan.
2. `codex`'s live-app evidence, trust/state model, and settings/notification safety.
3. `cursor`'s broader registry additions and checklist style where it makes acceptance easier to execute.
4. `gemini`'s manual-edit protection and durable chat-state implementation ideas, after translating them back into product requirements and checking them against the existing architecture.

The final Round 3 plan must preserve the handoff's truth rule: code can explain why something fails, but only screenshots or live app use can label something as working.
