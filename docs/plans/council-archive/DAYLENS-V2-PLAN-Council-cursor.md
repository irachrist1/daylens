> ⚠️ **SUPERSEDED — council process artifact (Round 1/2). Do NOT use for implementation.**
> The canonical, assembled plan is [`../DAYLENS-V2-PLAN.md`](../DAYLENS-V2-PLAN.md). Kept for provenance only.

# Daylens v2 — Council scorecard (cursor) — pass 2

**Judge:** `cursor`  
**Plans scored:** 4 — `Daylens-v2-plan-claude.md`, `Daylens-v2-plan-codex.md`, `Daylens-v2-plan-cursor.md`, `Daylens-v2-plan-gemini.md` *(new)*  
**Peer scorecards read:** `DAYLENS-V2-PLAN-Council-claude.md`, `DAYLENS-V2-PLAN-Council-codex.md` (prior pass)

**Scoring:** 1–5 on **Evidence**, **Accuracy of Now**, **Clarity + implementability of Should/Fix** per surface. Best = single plan to pull in Round 3.

### Evidence caveat (council consensus)

- **`codex`** claims live repro: Gemini quota on re-analyze while Settings = Claude Haiku; Apps → AI → "No chats yet"; Jun 16 gap pair; Safari 39 sessions today vs 5,977/7d in screenshots. **Specific and internally consistent** — credit in Evidence scores.
- **`claude`** and **`cursor`** (and **`gemini`**) did not drive the Electron GUI. **`gemini`** has no live-audit section at all.
- Round 3 should label codex-only live facts **"verify before relying,"** not ground truth — but they should **not** be dropped; they are the only independent repro of chat persistence and provider mismatch.

---

## Cross-cutting sections

### Problem statement

| Plan | Ev | Now | Fix | Notes |
|------|:--:|:---:|:---:|-------|
| claude | 5 | 5 | 4 | Six failures, each named screenshot; "works in fixtures, fails on a real day" |
| codex | 5 | 5 | 4 | "Untrusted reality layer → chain reaction"; live evidence paragraph |
| cursor | 4 | 4 | 4 | Six bullets; "downstream cosmetic until Phase 1" |
| gemini | 2 | 3 | 3 | Generic; says AI "hallucinates" — screenshot shows **tool/context failure**, not hallucination |

**Best:** **claude** (enumerated + screenshot-anchored). Open assembled plan with **codex** chain-reaction frame.

---

### Build sequence

| Plan | Ev | Now | Fix | Notes |
|------|:--:|:---:|:---:|-------|
| claude | 5 | 5 | 5 | Phase 0→6: trust → morning → evening → apps/AI; PMF-aligned |
| codex | 4 | 4 | 3 | 9 phases; **morning Phase 6 / evening Phase 7** contradicts PMF wedge |
| cursor | 4 | 5 | 5 | Phase 0–8; fixture must **fail on main first**; screenshot retake acceptance |
| gemini | 3 | 4 | 4 | 5 phases; **morning Phase 2** ✓; skips dogfood Phase 0, corrections phase, clients |

**Best:** **cursor** — falsifiable acceptance + wedge order. **Graft:** codex corrections-invalidation after Phase 1 trust; gemini's locked-block work into Phase 1.

---

### Testing decisions

| Plan | Ev | Now | Fix | Notes |
|------|:--:|:---:|:---:|-------|
| claude | 5 | 5 | 5 | 12 invariants + live checklist; BlockView/duration/kind |
| codex | 5 | 5 | 5 | 16 tests; gap-reason, correction propagation, privacy, onboarding |
| cursor | 4 | 5 | 5 | Table: test → screenshot it would catch; WrappedFacts parity |
| gemini | 3 | 3 | 3 | timeline:eval + 2 tests only; no provider/chat/table regressions |

**Best:** **codex** (breadth) + **cursor** format (screenshot traceability) + **claude** invariants.

---

## PMF surfaces (4-plan matrix)

Legend: **Best** = winner for Round 3 pull.

### Capture & tracking

| Plan | Ev | Now | Fix |
|------|:--:|:---:|:---:|
| claude | 5 | 5 | 5 |
| codex | 5 | 5 | 5 |
| cursor | 4 | 5 | 4 |
| gemini | 3 | 4 | 4 |

**Best:** **claude** — A1–A4, BlockView, exclusions toggle-ON/lists-empty correction, dual-use rule for 42s Netflix.  
**Merge:** codex classification **precedence ladder**; gemini **5-minute leisure dwell** threshold (300s) as explicit product number; gemini **SYSTEM_NOISE_APPS** denylist.

**Drop (Round 3):** codex council note — "exclusions broken because lists empty" overstates; empty = no user config yet, not proof exclusion engine fails. System noise + verify configured exclusions instead.

---

### Timeline

| Plan | Ev | Now | Fix |
|------|:--:|:---:|:---:|
| claude | 5 | 5 | 5 |
| codex | 5 | 5 | 5 |
| cursor | 4 | 5 | 4 |
| gemini | 3 | 3 | 3 |

**Best:** **claude** (B1–B5) + **codex** live Now for re-analyze.

**Drop:** **gemini** (and my prior pass) claim Thu–Sun "No data even when data exists" — on **Jun 17, 2026**, Jun 15–21 week: Thu–Sun are **future days**. Final plan needs **future vs missing-capture** semantics, not blanket "broken."

---

### Apps view

| Plan | Ev | Now | Fix |
|------|:--:|:---:|:---:|
| claude | 5 | 5 | 5 |
| codex | 5 | 5 | 5 |
| cursor | 4 | 5 | 4 |
| gemini | 3 | 4 | 4 |

**Best:** **codex** (live Today nuance, delete blast-radius) + **claude** Now (7d category-as-title vs 30d content-as-title — two wrong schemes).

**Drop:** "30d descriptive titles partially work" as positive — documentary title as **app row** is still wrong (codex council).

---

### AI chat & Q&A

| Plan | Ev | Now | Fix |
|------|:--:|:---:|:---:|
| claude | 5 | 5 | 5 |
| codex | 5 | 5 | 5 |
| cursor | 4 | 3 | 4 |
| gemini | 3 | 3 | 3 |

**Best:** **codex** (resolver-first, live sidebar loss) + **claude** Now (**today fails; week returns detailed HH:MM** — `ai-7-days-detailed-day-breakdown.png`).

**Drop:** Treating **week AI as fully broken** — **cursor**, **gemini**, registry default; week path is **partial** (no tables/projects/attribution).

---

### Memory

| Plan | Ev | Now | Fix |
|------|:--:|:---:|:---:|
| claude | 5 | 5 | 5 |
| codex | 4 | 5 | 5 |
| cursor | 4 | 4 | 4 |
| gemini | 3 | 4 | 3 |

**Best:** **claude** — all 19 patterns **"browsing" @ identical 65%** including Teams/Claude/malaria doc.  
**Merge:** codex "bad memory never overrides live evidence"; rebuild reports what changed.

---

### Morning brief

| Plan | Ev | Now | Fix |
|------|:--:|:---:|:---:|
| claude | 4 | 4 | 5 |
| codex | 4 | 4 | 5 |
| cursor | 4 | 4 | 5 |
| gemini | 3 | 3 | 4 |

**Best:** **claude** — carryover screen, delete slides 1–3, `narrative.nudge` first, Phase 2.

**Drop:** gemini citing `settings-notifications-clients-appearance.png` as evidence for **carousel** — that screenshot shows toggles only, not morning UI.

---

### Evening wrap

| Plan | Ev | Now | Fix |
|------|:--:|:---:|:---:|
| claude | 4 | 4 | 5 |
| codex | 4 | 4 | 5 |
| cursor | 4 | 4 | 5 |
| gemini | 3 | 3 | 4 |

**Best:** **claude** / **cursor** (tie) — ≤5 cards, leisure = 2, Phase 3. Merge codex "wrap totals = day header."

---

### Wraps (daily / weekly / monthly / annual)

| Plan | Ev | Now | Fix |
|------|:--:|:---:|:---:|
| claude | 5 | 5 | 5 |
| codex | 5 | 5 | 5 |
| cursor | 4 | 4 | 4 |
| gemini | 3 | 4 | 3 |

**Best:** **codex** — frozen daily snapshots, fail-closed weekly review. **claude** — single week aggregate + legend.

---

### Notifications

| Plan | Ev | Now | Fix |
|------|:--:|:---:|:---:|
| claude | 3 | 4 | 3 |
| codex | 4 | 4 | 5 |
| cursor | 3 | 4 | 4 |
| gemini | 3 | 3 | 3 |

**Best:** **codex** — manual test notification path, route/date/context payload, no wrong-provider text in body.

---

### Settings

| Plan | Ev | Now | Fix |
|------|:--:|:---:|:---:|
| claude | 4 | 5 | 5 |
| codex | 5 | 5 | 5 |
| cursor | 4 | 4 | 4 |
| gemini | 3 | 4 | 3 |

**Best:** **codex** (live Gemini mismatch, recompute/invalidation, MCP prod default-off) + **claude** provider centralization detail.

---

### Onboarding

| Plan | Ev | Now | Fix |
|------|:--:|:---:|:---:|
| claude | 2 | 3 | 3 |
| codex | 2 | 3 | 5 |
| cursor | 2 | 3 | 4 |
| gemini | 2 | 3 | 3 |

**Best:** **codex** — first success = "captured X min + can show evidence"; not a feature tour. All evidence-poor.

---

### Trust

| Plan | Ev | Now | Fix |
|------|:--:|:---:|:---:|
| claude | 4 | 4 | 4 |
| codex | 5 | 5 | 5 |
| cursor | 4 | 4 | 4 |
| gemini | 3 | 3 | 4 |

**Best:** **codex** — explicit states (low-confidence, edited, provider error, paused, future day).  
**Merge:** **gemini** `locked` column on blocks — only plan with schema-level **user edit immunity** from re-analysis; not screenshot-proven but high implementability.

---

## Overall rankings (4 plans)

| Plan | Avg Ev | Avg Now | Avg Fix | Surface wins | Verdict |
|------|:------:|:-------:|:-------:|:------------:|---------|
| **claude** | 4.4 | 4.5 | 4.7 | **11** | Strongest product spec + Now diagnoses |
| **codex** | 4.5 | 4.5 | 4.6 | **9** | Strongest live evidence + trust/state; fix sequencing in Round 3 |
| **cursor** | 3.6 | 4.0 | 4.3 | **2** | Best autonomous acceptance checklists; thinner fixes |
| **gemini** | 2.8 | 3.3 | 3.5 | **0** | Registry derivative; useful locked-block + 5m threshold snippets |

### Best-surface tally (pass 2)

| Plan | Wins |
|------|------|
| claude | capture, timeline, memory, morning, evening, wraps (daily/weekly), problem (tie), testing (tie) |
| codex | apps, AI (fix), wraps (frozen snapshots), notifications, settings, onboarding, trust, problem frame |
| cursor | build sequence, testing format |
| gemini | — *(contributions only: locked blocks, 300s threshold, morning Phase 2)* |

---

## Council drops (apply in Round 3)

| # | Drop | Plans affected |
|---|------|----------------|
| 1 | Week AI uniformly **broken** | cursor, gemini, registry default |
| 2 | Thu–Sun **No data** = capture bug without future-day context | gemini, cursor (prior) |
| 3 | Exclusions **broken** because lists empty | claude correction over-applied if read as "engine broken" |
| 4 | AI **hallucinates** as primary failure | gemini — use tool/context failure |
| 5 | LIVE block indicator **missing** | gemini — `timeline-today-afternoon-duplicate-development-blocks.png` shows LIVE tag |
| 6 | Morning/evening Now from **code alone** as product proof | all — keep PMF/founder/code-described + UNVERIFIED |
| 7 | **`npm test` / timeline:eval green = ship** | all — live screenshot per phase required |
| 8 | codex **morning Phase 6** ordering | codex build sequence |

---

## Gaps all four plans missed or underplayed

1. **Duplicate chat sidebar entries** — `ai-chat-sidebar-with-history.png` lists "Last 7 days by project" twice under TODAY.
2. **Re-analyze stuck UI** — "Re-analyzing…" with no recovery on failure/timeout (`timeline-day-jun16-*`).
3. **Session definition** — inflated counts flagged; no debounce/merge threshold specified (gemini's 300s is for **kind**, not sessions).
4. **Score/focus UX after trust** — demote vs remove Score 71 from shape panel unspecified.
5. **Forgotten link retrieval** — PMF promises "that link you saw"; no plan has URL/page recall resolver (codex council).
6. **Historical backfill** — segmentation changes affect yesterday; no migration/re-derive policy (all councils).
7. **Day boundary / timezone** — midnight bucket, DST, late-night carry (claude council).
8. **AI privacy boundary** — what local history ships to external providers; exclusions before API calls (codex council).
9. **Capture health diagnostics** — permissions, URL capture, helper process status in Settings (codex council).
10. **Correction audit trail + cache invalidation** — stale week review / AI narrative after merge/rename (codex only partial).
11. **Packaged vs dev** — MCP paths, updates; screenshots show dev Electron (codex council).
12. **Distraction alerts** — all UNVERIFIED; no false-positive bar.

---

## Round 3 assembly map (updated for 4 plans)

| Section | Primary | Also merge |
|---------|---------|------------|
| Problem | claude | codex frame + live observations (tag verify) |
| Solution | claude BlockView seam | codex trust states |
| Feature map | codex + cursor rows | claude corrections; gemini locked/hide rows |
| Capture | claude A1–A4 | codex ladder + gap reasons; gemini 300s + denylist |
| Timeline | claude B1–B5 | codex day-payload + live Gemini; future-day semantics |
| Apps | codex | claude C1–C5 title split |
| AI | codex resolver-first | claude D1 today-vs-week; tables/CSV |
| Memory | claude E3 | codex evidence/impact UI |
| Morning | claude F | cursor Phase 2 acceptance; codex test notification |
| Evening | claude G | codex header-total parity |
| Wraps | codex snapshots | claude week aggregate |
| Notifications | codex | claude carryover body |
| Settings | codex | claude provider centralization |
| Onboarding | codex | cursor local-only expectation |
| Trust | codex affordances | **gemini `locked` column**; claude BlockView |
| Build sequence | **cursor** | claude phases; codex corrections after Phase 1; **not** codex Phase 6 morning |
| Testing | codex + cursor format | claude invariants; gemini locking test idea |

---

## New plan assessment: `gemini`

**Strengths worth keeping:**
- Explicit **300-second** leisure dwell before category shift (implementable constant).
- **`locked` column** + skip re-label on locked blocks — fills gap others only implied.
- Concrete schema/SQL and morning JSX snippet — rare among plans.
- PMF build order (morning Phase 2) matches claude/cursor.

**Weaknesses:**
- No screenshot audit ledger; mostly registry paste.
- Weaker evidence discipline (hallucination, wrong LIVE/missing, weak morning evidence).
- Thin testing and no Phase 0 dogfood harness.
- Suggests new `AIStoreContext.tsx` without addressing existing `useAIChat.ts` guards — may duplicate state.
- References `weeklyBrief.ts` / `workMemory.ts` without verifying module names against codebase.

**Scores vs council average:** below claude/codex/cursor on all three axes; **do not use as primary source** for any surface. Treat as **snippet donor** for locked blocks and dwell threshold.

---

## Self-critique (cursor plan, pass 2)

Still **below claude/codex** on depth and live evidence. Pass 1 correctly flagged UNVERIFIED items; pass 2 agrees with peer councils that **week AI partial** and **future-week No data** corrections belong in final plan. cursor retains value for **screenshot-retake acceptance** and **registry row additions** — not for core Should/Fix prose.

---

*Pass 2 complete. Judge: cursor. Plans scored: 4. Peer scorecards: 2. No plan files edited.*
