# Daylens: What We're Building

## The Point

Daylens is **automatic work memory for your laptop**. It watches what you do, builds a calendar of it, and briefs you — so you can look back yesterday, last week, or last month without journaling every day.

Your Google Calendar shows what you *planned*. Daylens shows what you *actually did* — hour by hour, on your laptop, filled in automatically. Same idea as a calendar, but the source is reality, not intention.

---

## The Problem

You remember today — but that's only today. If I asked what you did last Thursday, would you know? Probably not. Last month? Even worse.

Existing solutions make you keep a journal or time-track every single day. The friction just isn't worth it — so most people give up and fall back on memory and action. That shouldn't be the case.

---

## What We're Building

1. **A scrollable calendar of what you actually did** — pick any day, scroll through time blocks like a calendar, with proof of exactly what was open.
2. **Daily, weekly, monthly, and annual wraps** — recaps you actually want to open.
3. **Morning and evening briefs** — **Morning:** what you left open yesterday, so you know what to pick up today. **Evening:** an honest recap of what you actually got done before you close the laptop.
4. **Natural-language Q&A** — ask what you shipped on Daylens last week, which day you had that meeting, what you were doing Thursday at 4pm, or that link you saw but forgot. It just gets you.

You wear every hat — founder, consultant, eng lead. Daylens is the record-keeper you'd be if you had time for that. You don't. So it does it for you.

---

## Plan (codebase → PMF)

### Where we are

A lot of the hard infrastructure already exists:

| PMF goal | Code today | Status |
|----------|------------|--------|
| Calendar of what you did | `Timeline.tsx` — day rail + week view + block evidence | Built; trust varies on real days |
| `kind` axis (work/leisure) | `src/shared/workKind.ts` + hard cuts in `workBlocks.ts` | Built; eval passes |
| Humanized labels | `src/shared/humanize.ts` | Built; must be on every surface |
| Facts spine (mattered / carryover) | `src/main/lib/wrappedNarrative.ts` | Built in backend |
| Morning notification | `dailySummaryNotifier.ts` → opens `DayWrapped` for yesterday | Built |
| Evening notification | Same, fires after 6pm with 45m+ tracked | Built |
| AI Q&A | `/ai` + `insightsQueryRouter.ts` | Built; same trust dependency |
| Week/month recap | `src/renderer/lib/recap.ts` | Built; not the wedge |
| Offline eval | `npm run timeline:eval` — 7 fixtures, all green | Passes fixtures, not a substitute for dogfooding |

**The gap is not missing capture.** It's **the brief surfaces don't match the PMF**:

1. **Morning** is still a 3–4 slide carousel (`DayWrapped.tsx`) with focus/identity slides — not "what's still open from yesterday" on one screen.
2. **Evening** is still an **8-slide** deck (Scale → Focus → Peak → TopApp → …) while `wrappedNarrative.ts` already defines a **5-card calm model** the UI never uses.
3. **Morning fallback copy** (`morningLead` / `morningNudge`) still uses focus % and peak-block heuristics when AI hasn't loaded — ignores `facts.carryover`.
4. **Acceptance bar** is fixture eval, not *your* real week — you can't yet answer "what did I ship on Daylens last Tuesday?"

---

### Phase 1 — Trust the record (foundation)

*Everything else fails if this is wrong.*

1. **Dogfood fixture** — export one real day (yours) into `tests/timeline-eval/fixtures/` and add it to eval. The mixed-work-leisure fixture (`2026-06-03`) is the template; add a **founder week** fixture from your machine.
2. **Run the app on a real day** — checklist after each build:
   - Coding and Netflix are separate blocks
   - Leisure never in `mattered` / `carryover`
   - Labels are humanized (no raw filenames / video titles)
   - Timeline matches what you remember ±15 min
3. **Fix gaps eval misses** — only if dogfood fails: segmentation in `workBlocks.ts`, kind in `workKind.ts`, labels via `humanize.ts` / `userVisibleBlockLabel`.

**Done when:** you open yesterday's timeline and nod — no correcting blocks before reading the brief.

---

### Phase 2 — Morning brief (the wedge)

*PMF: what you left open yesterday → pick up today.*

**Backend (small):**
- `deriveCarryover()` in `wrappedNarrative.ts` already picks open threads — ensure `intent.subject` is populated for real Daylens work (notebook names, repo threads) via `workIntent.ts`.
- Notification body in `dailySummaryNotifier.ts`: use `narrative.nudge` (carryover) first, not `lead` (shape of day).

**Frontend (main work):**
- Replace morning `DayWrapped` carousel with **one screen**:
  - Greeting
  - **Carryover line** from `facts.carryover[0]` — or "Nothing left open — clean start."
  - One link: "See yesterday" → timeline
- Delete morning slides 1–3 (category identity, video bg, "recap is waiting").
- Remove legacy `morningLead` / `morningNudge` heuristics — always render from `getWrappedNarrative()` facts (fallback is already carryover-aware).

**Files:** `DayWrapped.tsx`, `dailySummaryNotifier.ts`, `wrappedNarrative.ts`

**Done when:** notification says *"The malaria notebook was still open — pick it up?"* and one tap shows that — no slideshow.

---

### Phase 3 — Evening wrap (you love this — make it honest)

*PMF: honest recap before you close the laptop.*

**Backend:** `buildFallbackSlides()` in `wrappedNarrative.ts` already has the 5-card model (shape → what you worked on → where time went → open thread → close). AI prompts match.

**Frontend (main work):**
- Replace evening 8-slide carousel with **5 cards max** driven by `WrappedFacts` / `aiSlides`:
  1. Shape (one sentence)
  2. What you worked on (only if work ≥ ~15m)
  3. Where time went (single breakdown)
  4. Open thread (only if carryover exists)
  5. Quiet close
- Keep `hasDistractionData = false` — guilt slides stay dead.
- Leisure day = 2 cards (shape + close).

**Files:** `DayWrapped.tsx` (evening branch ~1847–1877)

**Done when:** you open evening wrap at end of work and it matches the timeline — no contradictions, no focus lecture on a rest day.

---

### Phase 4 — Timeline as proof

*PMF: scrollable calendar with proof.*

Already mostly there. Polish only:

- Day header: `5h 24m tracked · 52m work · 3h 51m leisure` (no score/focus % up front)
- Default = read-only list; corrections behind "Not right?" only (`Timeline.tsx` ~1097)
- Tapping a block shows evidence (apps, sites, why grouped)

**Done when:** morning brief cites a thread → you tap timeline → evidence is there.

---

### Phase 5 — Q&A uses the same truth

*PMF: "what did I ship on Daylens last week?"*

- Route "what did I leave open yesterday?" / "what did I work on yesterday?" through `buildWrappedFactsFromPayload` + carryover — same spine as morning brief (`insightsQueryRouter.ts` or thin wrapper).
- Project questions ("Daylens last week") already partially exist via attribution resolvers — verify against dogfood week.

**Done when:** morning brief, evening wrap, and `/ai` give the same answer for the same question.

---

### Phase 6 — Later (not the wedge)

- Weekly / monthly wraps (`recap.ts`) — after daily briefs trust
- Annual wrap — not built; defer
- Calendar/email integrations — different product layer; not needed for laptop-memory PMF

---

### Build order (sequential)

```
Phase 1 (trust)     →  Phase 2 (morning)  →  Phase 3 (evening)
        ↓                      ↓                    ↓
   dogfood fixture        1-screen brief      5-card wrap
        ↓
   Phase 4 (timeline proof)  →  Phase 5 (Q&A alignment)
```

**This week's focus:** Phase 1 + Phase 2. Don't touch weekly wraps or new features until morning brief works on your real yesterday.

---

### How you know PMF (for you)

1. Morning notification names a real open thread from yesterday — or honestly says nothing's open.
2. You tap through to timeline and the evidence checks out.
3. Evening wrap is short, honest, worth opening.
4. You ask `/ai` "what did I work on Daylens last week?" and trust the answer.
5. Next Tuesday you can actually answer what you did last Thursday — from Daylens, not memory.

---
