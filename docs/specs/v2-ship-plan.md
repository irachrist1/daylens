# Daylens V2 ship plan — orchestrated execution

Status: active 2026-07-11. This is the execution plan for shipping V2. It merges the
founder's ship audit (daylens-v2-ship-checklist, July 11) with the orchestrator's live
verification pass. The orchestrating session assigns waves to subagents; every claim a
subagent makes gets verified against the real tree before its work merges.

## Brief

Eight outcomes stand between this build and V2. The code is largely built and the
verification floor is green (typecheck clean, lint clean, 1,163 tests passing, billing
sandbox 9/9, wrapped benchmark 62/64 slides on six real days). What remains is:
three foundation bugs (timeline crosses real absences, Apps counts deleted blocks,
no provider circuit breaker), one quality gate (Wrapped's full-day set + whole-deck
coherence), one ops project (billing has zero deployed infrastructure), storage
hygiene (the largest real DB is 660 MB and 55% of it is untrimmed AI telemetry), and
proof (packaged apps on real machines, which only the founder can do).

Two standing decisions are recorded here so no agent relitigates them:

1. **The day model (`docs/specs/day-model.md`) is NOT in V2.** It is the first V3
   project. Tasks 2–3 (gap guard, one corrected truth) are the bridge toward it —
   build them so they don't have to be torn up when the day model lands.
2. **"B-Link" means the managed billing stack as built** (Polar + Flutterwave +
   LiteLLM + Postgres on Railway). No new vendor work.

## How execution runs

- The orchestrator (main session) sequences waves, launches subagents in isolated
  worktrees, verifies their claims, and merges. Parallel agents never share a tree.
- Every agent reads `AGENTS.md` first and obeys it: platform notes required, monorepo
  lanes respected, no touching `docs/specs/` content, tests green before done.
- Independent review lane: Codex (`codex exec --model gpt-5.5 -s read-only`) blind-
  reviews the timeline gap-guard diff and the billing service before deploy.
- Only the founder marks an outcome done, after testing on a real day / real machine.

## Wave 0 — checkpoint (orchestrator, first, sequential)

- [ ] Commit the mixed working tree in three feature groups (AI chat cleanup; shared
      activity/date contracts + Apps split; Wrapped catalog finalization), full suite
      green after the final commit. `tests/artifactPreview.test.ts` is deleted with
      `tests/reportMarkdown.test.ts` as its replacement — verify that covers it.
- [ ] Push `main` to origin. V2 must stop existing only on one laptop.

## Wave 1 — foundation fixes (parallel worktree agents)

**W1-A. Timeline truth (report tasks 2 + 3, one agent — same files).**
Deterministic gap guard: no Analyze, merge, or correction may join work across a real
absence of ≥15 minutes. Repair path for already-stored bad days (July 10 has a block
spanning a 97-minute absence; July 8 has raw JSON titles and sub-15-minute fragments).
Then one corrected truth: Apps totals must read corrected block facts, not raw
sessions — a deleted/trimmed Timeline block changes Apps immediately; a category
override reaches Timeline, Apps, AI, and future wraps. Cross-view tests. The repair
must be a re-analyze path in app code, never a direct edit of anyone's live DB.

**W1-B. Provider circuit breaker + telemetry retention (report task 7 + audit).**
When a provider returns `quota_exhausted` or credit-empty, background AI jobs for that
provider stop for a real cooldown (hours, persisted) instead of retrying; foreground
user actions may still try once and surface the honest error. Retention policy for
`ai_usage_events` (888k rows, ~364 MB with indexes in the founder's real DB): keep
recent detail + monthly rollups old rows compact to; user corrections and anything
yearly recaps need stays rebuildable. Perf numbers on a large fixture before/after.

**W1-C. AI chat finish line (report task 5).**
Real cancel (UI through to provider call). Bound the history sent to providers, not
just what's on screen. Remove or reconcile the report/identity fallbacks that violate
the no-fake-AI rule. Fix duplicate sidebar conversation groups ("This Week Focus" /
"Focus Session" appear twice). Tests for rename, paging, tab switching, retry, quota,
mid-generation switching.

**W1-D. Wrapped quality gate (report task 6 + whole-deck judge).**
Add a whole-deck judge to the benchmark: one pass that reads the entire deck and fails
on cross-slide repetition, broken arc, or slides contradicting each other — today
every anchor and score is per-slide and nothing evaluates the deck as one story. Make
catalog, coverage copy, preflight copy, guards, and tests agree. Get the complete
day fixture set green twice; add week to the required gate; month/year need quality
fixtures. Adversarial checks for attendance, unobserved time, reading, watching,
finishing, attention, inferred plans. Surface export errors instead of swallowing
them. `shipped` and `plan-vs-actual` slides stay explicitly future work.

## Wave 2 — review + merge (orchestrator + Codex)

- [ ] Verify each W1 claim against the diff; run the full suite on the merged tree.
- [ ] Codex blind review of W1-A (timeline) and the billing service (`services/
      billing/`) pre-deploy. Findings fixed or explicitly waived by the founder.

## Wave 3 — go live (founder-gated; orchestrator prepares, founder executes)

**Billing (report task 4).** Founder: Polar payout approval + Flutterwave Rwanda live
approval in writing — or explicitly choose the one rail that ships. Then deploy
Postgres, LiteLLM, billing API per `services/billing/README.md`; `billing.daylens.app`
healthy over HTTPS (DNS currently does not resolve); webhooks registered; sandbox →
test mode → smallest real payment; prove free credit, subscribe, cancel, portal,
exhaustion, BYOK bypass. Desktop rebuilt with the production billing URL.

**Signing + secrets (report task 8).** 13 of 17 CI secrets are unset: all six Apple
notarization/signing values, both Mac certificate values, all three Windows
certificate values, and `SENTRY_DSN`. Founder buys the Windows Authenticode cert
(~$300/yr) and decides on Apple Developer ($99/yr); orchestrator wires CI.

**Release matrix.** Packaged builds on macOS, Windows, Linux; install + update proven
on real machines. Founder acceptance day on each promised platform: track a real day,
analyze, inspect gaps and names, rename/trim/merge/delete/rebuild, reconcile Apps
totals, ask AI what happened, open a wrap, ask about a slide, export, reopen,
regenerate, restart, confirm every correction survived. Then publish V2.

## Already fixed — do not reopen

Version 1.0.45; platform + monorepo rules in AGENTS.md; onboarding clients are real
records; Settings honesty; Apps split with filtering bugs tested; chat rename/lookup/
paging/formatting built; Wrapped facts/gates/persistence/coverage/export built; the
runaway AI loop is quiet (storm was May–June, single-digit calls/day now).
