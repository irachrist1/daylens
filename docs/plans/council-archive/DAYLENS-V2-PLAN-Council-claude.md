> ⚠️ **SUPERSEDED — council process artifact (Round 1/2). Do NOT use for implementation.**
> The canonical, assembled plan is [`../DAYLENS-V2-PLAN.md`](../DAYLENS-V2-PLAN.md). Kept for provenance only.

# Daylens v2 — Council scorecard (judge: claude)

Round 2. I scored all three Round-1 plans — `claude` (my own), `codex`, `cursor`
— surface by surface. Per the handoff I judged on merit and was **harder on my
own plan**; where my plan wins below, I've said why in terms a neutral reader can
check against the screenshots.

**Scoring:** each plan 1–5 on **Evidence** (screenshot / live-app backed vs
guessed), **Accuracy of Now**, **Clarity + implementability of Should/Fix**.
"Best" = the single plan I'd pull that surface from in Round 3.

### Honesty caveat on evidence (read before trusting the Evidence column)
- **`codex` claims a live app audit** (`npm start`, inspected Timeline Jun 16,
  Apps today, AI nav, Settings) and reports facts not in any screenshot: a
  **Gemini quota** failure on re-analyze, **Safari 39 sessions / 59m today** (vs
  5,977 / 7d in screenshots), an **8h3m + 7h12m** gap pair on Jun 16,
  `localhost:5173`. If true, that's the strongest evidence base of the three.
- **I (`claude`) and `cursor` both state we could NOT drive the Electron GUI** —
  only launch it. So codex's live-only facts are **not independently verifiable
  by the rest of the council.** I credit codex for their specificity and internal
  consistency (e.g. correctly distinguishing live "today" counts from inflated
  7d screenshot counts), but **Round 3 should mark codex's live-only claims
  "verify before relying," not treat them as ground truth.**
- All three plans are disciplined about **not** calling broken things "works" and
  about marking unverified surfaces — none needs a blanket evidence penalty.

---

## Per-surface scores

Legend: E = Evidence, A = Accuracy of Now, C = Clarity/implementability.

### Capture & tracking
| Plan | E | A | C | Notes |
|---|---|---|---|---|
| claude | 4 | 5 | 5 | Correctly flips registry's exclusion row: toggle **ON but lists empty → still tracks everything**. `BlockView` aggregate + neutral/dual-use rule for the 42s-Netflix case. |
| codex | 5 | 5 | 5 | Live `loginwindow` 50h/30d + live session-count nuance. **Classification precedence ladder** (corrections > denylist > dominant duration > domain > support-as-evidence) is the most implementable spec of the three. |
| cursor | 4 | 5 | 4 | Solid; adds a **live-block-indicator** row others omit. Fixes are mostly "modify `workBlocks.ts`" — correct but less specified than codex's ladder. |

**Best: codex** — precedence ladder + live detail. claude close.

### Timeline / calendar
| Plan | E | A | C | Notes |
|---|---|---|---|---|
| claude | 4 | 5 | 5 | B1–B5: header→tracked/work/leisure, demote score, "mattered" filtered to `kind===work`, **single week-aggregate + legend + work-based Main mode**. |
| codex | 5 | 5 | 5 | Live Jun 16 specifics (6h1m, 13 blocks, gap pair, Gemini). **Single day-payload contract** consumed by detail/stats/shape/week. |
| cursor | 4 | 5 | 4 | Correct fixes incl. demote score + single week source; week "future days grayed not No-data" is a good nuance. |

**Best: codex** (live grounding + day-payload contract); claude essentially tied on the fix.

### Apps view
| Plan | E | A | C | Notes |
|---|---|---|---|---|
| claude | 4 | 5 | 5 | Sharpest Now correction: **7d titles use the *category*, 30d uses a *content title* — two different wrong schemes**; fix = fixed title hierarchy, period changes only numbers. |
| codex | 5 | 5 | 5 | Live "today names better but Safari says needs-more-context." Uniquely flags **destructive per-row delete needs blast-radius + confirmation** — a real safety gap. |
| cursor | 4 | 5 | 4 | App-centric row rewrite + domain scoping + dedupe + delete-domain. Good, slightly less specified. |

**Best: codex** (destructive-action safety + live). claude has the best single Now diagnosis (the 7d/30d title split) and should be merged in.

### AI chat & Q&A
| Plan | E | A | C | Notes |
|---|---|---|---|---|
| claude | 5 | 5 | 4 | Best **diagnosis**: "today fails *while week returns a full per-day HH:MM breakdown*" (`ai-7-days-detailed-day-breakdown.png`) → bug is the today tool-result, not the data layer. Labels week **partial**, which the screenshot supports. |
| codex | 5 | 5 | 5 | Best **fix**: **resolver-first** — deterministic local resolvers fetch facts, LLM may narrate but "cannot invent missing tool results." CSV resolver. Live "No chats yet after Apps→AI." |
| cursor | 4 | 4 | 4 | Correct direction (fix tool context, route via `WrappedFacts`, persist threads, tables) but least architecturally specified. |

**Best: codex** (resolver-first is the most robust + implementable). **claude has the most accurate Now** (week is partial, not broken — codex & cursor both overstate it as "broken" despite the working screenshot). Round 3 should take codex's fix + claude's Now.

### Memory
| Plan | E | A | C | Notes |
|---|---|---|---|---|
| claude | 5 | 5 | 5 | Sharpest Now: **all 19 patterns tagged "browsing" @ identical 65%** incl. Teams/Claude/Apple-docs; fix = classify from the same kind/domain logic, **never default to browsing**, real confidence, rebuild. |
| codex | 4 | 5 | 5 | Strong principle: memory = **reviewable attribution layer**, "used in N recent blocks," **bad memory never overrides stronger live evidence**, rebuild reports what changed. |
| cursor | 4 | 4 | 4 | Wire patterns into label resolver ahead of "Development"; rebuild triggers relabel. Correct but thinner. |

**Best: claude** — most precise Now + the fix targets the actual "everything is browsing @65%" bug. (I checked this for self-bias: codex's "never override live evidence" principle is excellent and should be **merged in** — but the root-cause Now and the classification fix are tightest in claude.)

### Morning brief (the wedge)
| Plan | E | A | C | Notes |
|---|---|---|---|---|
| claude | 3 | 4 | 5 | One screen from `facts.carryover[0]`; delete slides 1–3; notification `nudge` first; remove `morningLead/Nudge` heuristics. **Sequenced as Phase 2.** |
| codex | 3 | 4 | 5 | Equivalent Should (carryover-only + clean-start; notification == screen). **But sequenced at Phase 6 — deprioritizes the wedge, contradicting PMF.** |
| cursor | 3 | 4 | 5 | Equivalent + concrete teaser-matches-first-card; **Phase 2**, matches PMF most directly. |

**Best: cursor** (narrow) — correct Should *and* correct phasing, most concrete deep-link. claude tied on content/phasing. **codex penalized on sequencing here, not content.**

### Evening wrap
| Plan | E | A | C | Notes |
|---|---|---|---|---|
| claude | 3 | 4 | 5 | Explicit 5 cards with per-card conditions (work card only if ≥15m; thread card only if carryover; leisure day = 2 cards); distraction stays dead. Phase 3. |
| codex | 3 | 4 | 5 | 5 cards, totals must equal day header, hide empty cards. Phase 7 (deprioritized). |
| cursor | 3 | 4 | 5 | 5 cards from `WrappedFacts`, leisure = 2. Phase 3. |

**Best: claude / cursor (tie)** — both nail content + correct phasing. codex's "totals must equal the day header" is a good invariant to merge.

### Daily / weekly / monthly / annual wraps
| Plan | E | A | C | Notes |
|---|---|---|---|---|
| claude | 4 | 5 | 4 | Weekly = single aggregate + legend + work Main mode; monthly deferred; annual out. |
| codex | 4 | 5 | 5 | **Weekly from frozen daily fact-snapshots, fail-closed on incomplete data**, "No data only when truly none, with reason." Most robust. |
| cursor | 4 | 4 | 4 | Weekly single-source hours fix now; defer monthly/annual. |

**Best: codex** (frozen snapshots + fail-closed).

### Notifications
| Plan | E | A | C | Notes |
|---|---|---|---|---|
| claude | 3 | 4 | 3 | "After F/G, verify delivery + carryover body." Thin. |
| codex | 3 | 4 | 5 | **"Send test notification" dev/acceptance path**; payload carries route/date/context; text never references an unavailable provider. Most implementable. |
| cursor | 3 | 4 | 4 | Wire copy to spine; live-test delivery. |

**Best: codex** (the test-notification mechanism is the unlock for autonomous acceptance).

### Settings & configuration
| Plan | E | A | C | Notes |
|---|---|---|---|---|
| claude | 4 | 5 | 4 | Provider centralization, build clients, memory rewrite, label propagation. Good, not exhaustive. |
| codex | 5 | 5 | 5 | Broadest map (provider errors, analytics, profile persona, app updates); **recompute/invalidate on every interpretive change + "last applied + affected surfaces"**; MCP off-by-default in prod; env-aware config. |
| cursor | 4 | 4 | 4 | Single `resolveActiveProvider()`, clients CRUD→resolver, label propagation. |

**Best: codex.**

### Onboarding
| Plan | E | A | C | Notes |
|---|---|---|---|---|
| claude | 2 | 3 | 3 | Audit live; permissions + value prop; trust earned by A–G. |
| codex | 2 | 3 | 5 | Permissions/privacy/AI-optional/first-proof; "not a feature tour"; first success = "captured X min + can show evidence." |
| cursor | 2 | 3 | 4 | "Set expectation: reality calendar, not planner"; verify permission flow on clean install. |

**Best: codex** (clearest first-success definition). All three are necessarily unverified.

### Trust (cross-cutting)
| Plan | E | A | C | Notes |
|---|---|---|---|---|
| claude | 4 | 4 | 4 | Trust earned by A–G; explicit unverified-items list. |
| codex | 4 | 5 | 5 | **Trust as a product surface with explicit states**: "No data because tracking paused," "Low-confidence label," "Edited by you," "Provider error: selected model unavailable." Best. |
| cursor | 4 | 4 | 4 | Shared facts spine + dogfood fixture; same-question-same-answer. |

**Best: codex.**

---

## Cross-cutting sections

### Problem Statement
| Plan | E | A | C | Notes |
|---|---|---|---|---|
| claude | 5 | 5 | 4 | 6 enumerated failures, **each tied to a named screenshot**; "works in fixtures, fails on a real day." Fully auditable. |
| codex | 4 | 5 | 4 | Best **conceptual frame**: "every downstream surface depends on an untrusted reality layer — a chain reaction"; live evidence base. Less enumerated. |
| cursor | 5 | 5 | 4 | 6 concrete points; "until Phase 1 is done, every downstream surface is cosmetic." |

**Best: claude / cursor (tie, marginal)** for screenshot-anchored enumeration; codex's chain-reaction framing is the best single sentence and should open the assembled plan.

### Build sequence
| Plan | E | A | C | Notes |
|---|---|---|---|---|
| claude | 4 | 4 | 4 | Phase 0–6, **PMF order** (trust→morning→evening→apps→AI→clients), run-the-app acceptance per phase. |
| codex | 4 | 4 | 4 | Most detailed (9 phases) and uniquely adds a **Corrections & invalidation phase**. **But morning=Phase 6 / evening=Phase 7 contradicts the PMF wedge priority** — its biggest flaw. |
| cursor | 4 | 5 | 5 | Phase 0–8, **PMF order**, **checkbox acceptance tied to specific screenshot retakes** ("screenshot retake of `timeline-today-*` matches"), and Phase 0 requires the **fixture to fail on current main** first. Most autonomous-ready. |

**Best: cursor** — correct wedge order + screenshot-linked, falsifiable acceptance. **Round 3 must graft codex's "Corrections & invalidation" phase into cursor's ordering** (see Gaps).

### Testing
| Plan | E | A | C | Notes |
|---|---|---|---|---|
| claude | 4 | 5 | 4 | 12 invariants (duration, kind/tag, provider routing, today-no-apology, memory-not-all-browsing) + live acceptance. |
| codex | 5 | 5 | 5 | 16 tests; uniquely covers **correction-propagation, gap-reason, privacy/exclusion, onboarding smoke**; "live screenshots after every phase." Broadest. |
| cursor | 4 | 5 | 5 | Table format **"test → would catch [screenshot]"** — most directly answers the handoff's ask; WrappedFacts-alignment test (morning carryover === AI "left open" answer) is a great cross-surface check. |

**Best: codex** (coverage) — but adopt **cursor's screenshot-traceability format** for the final test plan.

---

---

## Second pass — `gemini` plan (added after a 4th plan landed)

Scored on the same rubric, judged independently (I did not read the other
agents' scorecards). `gemini` cites screenshots correctly but reports **no live
audit**; its evidence base is screenshots + the registry.

**Character of the plan:** the most **code-concrete** of the four (SQL migration,
a `SYSTEM_NOISE_APPS` set, a numeric 300s context-switch threshold, a root-level
React store) — but the **least independent**: its Feature map is largely the
`FEATURE-REGISTRY.md` rows verbatim with `UNVERIFIED` flags added, so it carries
few fresh Now-corrections (it misses the AI-week-actually-works nuance, the 7d/30d
Apps-title split, and the "all patterns are browsing" framing). Its standout is a
genuine idea **no other plan has** (see Gaps #6).

| Surface | E | A | C | Note |
|---|---|---|---|---|
| Capture | 4 | 4 | 5 | Denylist + **explicit 300s threshold** before a category shift + locked-block preservation. Accuracy mostly inherited from registry. |
| Timeline | 4 | 4 | 4 | Legend, single duration source, pass Settings model to re-analyze IPC. Less week-aggregate depth than codex/claude. |
| Apps | 4 | 4 | 4 | Domain-under-parent-browser, dedupe, delete-row. Correct; missed the 7d/30d title-scheme split. |
| AI | 4 | 3 | 4 | **Most concrete persistence fix** (global store mounted at `App.tsx` root so chat survives unmount). But keeps week = "broken" (less accurate than claude's partial). |
| Memory | 4 | 4 | 4 | Notes identical-65%; fix = compute real match % and feed `workBlocks`. Concrete; less root-cause framing than claude. |
| Morning | 3 | 4 | 5 | Single-page with a code snippet + concrete example; Phase 2. Equal to claude/cursor. |
| Evening | 3 | 4 | 5 | 5 cards, leisure=2 with sample copy, `hasDistractionData=false`. Equal to claude/cursor. |
| Wraps | 3 | 4 | 3 | Defer monthly/annual; standardize `weeklyBrief`. Thinner than codex. |
| Notifications | 3 | 4 | 4 | `narrative.nudge`-first body. Concrete. |
| Settings | 4 | 4 | 3 | Covers model/clients/labels/memory; lacks codex's recompute/affected-surfaces depth. |
| Onboarding | 2 | 3 | 3 | Minimal. |
| Trust | 4 | 4 | 5 | **Best edit-integrity primitive of any plan**: a `locked` block flag that AI re-analysis must never overwrite. |
| Problem statement | 4 | 5 | 4 | Concise + accurate ("foundation untrustworthy → all upstream fail"); less enumerated/cited than claude/cursor. |
| Build sequence | 3 | 4 | 4 | PMF-correct order, concrete tasks — **but Phase-1 acceptance leans on `npm run timeline:eval` passing**, which the handoff explicitly says is *not* product truth; no Phase-0 fail-first, lighter run-the-app acceptance than cursor/claude. |
| Testing | 3 | 3 | 3 | Thin — segmentation + persistence + locking only; misses duration-invariant breadth, provider-routing, table, and today-no-apology tests the others have. |

**Does gemini take any "best" crown?** It does not displace codex (breadth +
architecture) or cursor (build sequence) overall, and it's the least independent
on Now-accuracy. **But it wins one surface: edit-integrity within Trust** — the
`locked`-block mechanism is the single best answer to the registry's "rename is
untrusted / re-analysis overwrites edits" problem, and Round 3 should adopt it.
On Morning/Evening it ties claude/cursor.

**One thing to DROP from gemini:** its build-sequence acceptance that treats
`timeline:eval` green as a phase gate — replace with cursor's run-the-app /
screenshot-retake acceptance, per the handoff's "green tests ≠ working product."

---

## Things to DROP / fix in Round 3
- **codex build-sequence ordering** — drop the morning(Phase 6)/evening(Phase 7)
  placement; it contradicts PMF ("this week = Phase 1 + Phase 2 morning"). Use
  cursor's/claude's trust→morning→evening order.
- **"AI ask-about-week = broken"** in **codex** and **cursor** — overstated; the
  `ai-7-days-detailed-day-breakdown.png` screenshot shows a working detailed
  answer. Use claude's **partial** (data path works for ranges; only *today* and
  *tables/attribution* are broken).
- **codex's live-only facts** (Gemini *quota* specifically, 39-sessions-today,
  localhost port, exact gap minutes) — don't promote to ground truth; label
  "verify before relying," since two of three council agents couldn't reproduce
  live behavior.
- No plan calls a broken feature "works," so there's nothing to drop on that count.

## Gaps EVERY plan missed (or all but one) — add as open work in Round 3
1. **Correction → downstream cache invalidation/staleness.** Only **codex** made
   it first-class; **claude** and **cursor** mention propagation but not marking
   generated AI/wrap text stale when a block is corrected. Must be in the final
   plan.
2. **Day-boundary / timezone definition.** None define when "a day" starts (local
   midnight?), how late-night work crossing midnight is bucketed, or DST. This
   directly affects "today/yesterday" correctness and the big sleep "gaps."
3. **Historical data migration / backfill.** Changing segmentation + kind alters
   *existing* blocks. No plan states whether history is re-derived or only new
   data is — yet the dogfood bar is "open *yesterday* and nod," which needs past
   data fixed.
4. **Performance at scale.** Safari 5,977 sessions, 119h/30d. Re-segmentation and
   aggregation cost over a large local history is unaddressed by all three.
5. **A concrete definition of "session."** All four flag inflated counts as
   untrusted; none specify the fix (micro-session debounce/merge threshold).
6. **Locked / protected user edits.** Only **gemini** raises it: manual
   rename/merge/split must set a `locked` flag that automatic re-analysis and AI
   re-labeling never overwrite. The other three describe correction *propagation*
   but not correction *protection* — yet "rename is untrusted" is a registry-level
   defect. Adopt gemini's `locked`-block mechanism in Round 3.

## Tally (best-surface votes, all four plans)
- **codex: ~10** — capture, timeline, apps, AI(fix), wraps, notifications, settings, onboarding, trust(as-surface), testing.
- **cursor: 3** — morning, evening(tie), build sequence; co-best problem statement.
- **claude: 3** — memory, AI(Now-accuracy), evening(tie); co-best problem statement.
- **gemini: 1.5** — trust(edit-integrity / `locked` blocks); ties on morning/evening.

**Overall:** **codex is the strongest single plan** — breadth, the reality-layer
contract, resolver-first AI, trust-as-surface, corrections-invalidation — *if* its
live claims hold (flagged "verify before relying"). Its one real flaw is
build-sequencing the wedge too late. **cursor** owns the most autonomous-ready
build sequence + testing traceability and correct wedge order. **claude** owns the
sharpest individual Now diagnoses (AI today-vs-week is *partial* not broken,
memory "all browsing @65%", the 7d/30d Apps-title split). **gemini** is the most
code-concrete and contributes the one idea the others all missed — `locked`
blocks — but is the least independent on Now-accuracy and leans on `timeline:eval`
for acceptance.

The ideal Round-3 assembly: **codex's architecture + cursor's sequencing/acceptance
+ claude's Now corrections + gemini's `locked`-block edit protection**, plus the 6
missed gaps above.

*Round 2 (2nd pass) complete. I scored all four plans including my own; I did not
read the other agents' scorecards, and I did not edit any plan or the registry.
Stopping here.*
