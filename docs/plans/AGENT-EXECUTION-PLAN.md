# Daylens v2 — agent execution plan (packets, models, order)

Operating rules: [`/AGENTS.md`](../../AGENTS.md). Canonical plan:
[`DAYLENS-V2-PLAN.md`](DAYLENS-V2-PLAN.md). This file says **who builds what, batched, in
what order**, so the founder gets one notable testable feature per PR and tests between packets.

## Model strengths (why these assignments)

- **Claude Opus 4.8** — SWE-bench Verified 88.6%; best at repository-level / cross-surface
  rewrites; controllable. → the risky seam fixes.
- **GPT-5.5 (high)** — long-horizon autonomous backend, aggregation, test harnesses, build-from-scratch.
- **Sonnet 4.6** — fast, strong frontend + medium-scoped work.
- **Composer 2.5 (Cursor)** — cheap/fast mechanical & UI patches (folded into packets, never solo micro-PRs).

Engines: **Codex** runs via Linear delegate (auto status). **Cursor** runs Opus 4.8 /
Sonnet 4.6 / Composer 2.5 as background agents with Bugbot — pick the model per the table.
Both branch from `main` and PR to `main`. (Claude is *not* a Linear delegate agent, so the
Opus packets run as Cursor agents with Opus 4.8 selected.)

## Packets (build top-down; each = one PR = one testable feature)

| # | Packet (issues) | Lead model | Engine | Depends on | What the founder tests |
|---|---|---|---|---|---|
| **P0** | Truth baseline — DEV-17 | GPT-5.5 | Codex | — | Saved real day/week matches your memory ±15m; the new checks fail on today's app |
| **P1a** | Trustworthy blocks — DEV-22, DEV-19, DEV-18, DEV-20 | Opus 4.8 | Cursor | P0 | A coding day = few believable blocks; one duration everywhere; no `loginwindow` |
| **P1b** | Day view tells the truth — DEV-23, DEV-24, DEV-21 | Sonnet 4.6 | Cursor | P1a | Open yesterday and nod; header = tracked/work/leisure; no leisure in "What mattered" |
| **P2** | Corrections & invalidation — DEV-25 | Opus 4.8 | Cursor | P1a | Rename/merge sticks everywhere + survives re-analysis |
| **P3** | Morning wedge — DEV-26, DEV-27 | Sonnet 4.6 | Cursor | P1b | Morning brief = one screen naming a real open thread; matching notification |
| **P4** | Evening wrap — DEV-28 | Sonnet 4.6 | Cursor | P1b | ≤5 calm cards; 2 on a rest day; totals match the timeline |
| **P5** | Timeline proof + week — DEV-30, DEV-29, DEV-31 | GPT-5.5 | Codex | P1b | Week totals agree + legend; re-analyze uses your model; future days look future |
| **P6a** | Apps identity & attribution — DEV-32, DEV-33, DEV-34 | Sonnet 4.6 | Cursor | P1a | Safari is "Safari" in every period; Netflix under the browser, not Dia |
| **P6b** | Apps detail & labels — DEV-35, DEV-36, DEV-37 | Sonnet 4.6 | Cursor | P6a | Detail loads without Generate; deduped pages; label overrides take effect |
| **P7a** | AI spine — DEV-38, DEV-39, DEV-45 | Opus 4.8 | Cursor | P1a | "What did I work on today?" answers with real times; every AI surface uses your model |
| **P7b** | AI features — DEV-40, DEV-41, DEV-42, DEV-44 | Sonnet 4.6 | Cursor | P7a | Tables + CSV; "turn into bullets" works; calm voice; client breakdown |
| **P7c** | Chat state — DEV-43 | Opus 4.8 | Cursor | P7a | History survives Apps→AI; mid-generation switch never wipes; no duplicate rows |
| **P8a** | Model authority & memory — DEV-46, DEV-48 | Opus 4.8 | Cursor | P7a | Memory shows varied earned categories; settings changes show their effect |
| **P8b** | Clients & MCP — DEV-47, DEV-49 | GPT-5.5 | Codex | P8a | Add a client → "how much on X this week?" answers; MCP off by default in packaged build |
| **P9** | Wraps — DEV-50 | GPT-5.5 | Codex | P5 | Weekly == chart == day rows; answer "what did I do last week/month?" from Daylens |
| **P10** | Onboarding & trust — DEV-51, DEV-52 | Opus 4.8 | Cursor | all | Fresh-profile first-run proves capture; low-confidence items are marked + correctable |

Order: **P0 → P1a → P1b** (the wedge spine, do not reorder), then P2–P4 in parallel-safe
order, then P5 → P6 → P7 → P8 → P9 → P10. One packet in flight per surface.

Engine column below: "Cursor" = launch a Cursor background agent with the listed model;
"Codex" = delegate the issue to Codex from Linear. All branch from `main`, PR to `main`.

## Per-issue model (for reference / Cursor launch)

Opus 4.8: DEV-22, 19, 25, 38, 45, 43, 48, 51, 52 · GPT-5.5: DEV-17, 18, 30, 33, 47, 50 ·
Sonnet 4.6: DEV-23, 21, 26, 28, 29, 31, 32, 34, 35, 37, 40, 42, 44, 46 · Composer 2.5
(folded into the Cursor packets above): DEV-20, 24, 27, 36, 39, 41, 49.

## Merge cadence

One PR per packet into `main`. The founder tests the packet's branch on their Mac, then
merges — that merge is the only thing that lands on `main`. ~16 PRs total across the
project, each a real feature, never a micro-PR.
