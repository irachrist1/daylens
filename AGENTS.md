# Daylens v2 — Autonomous agent operating contract

**Read this first, every run. It is binding for every coding agent (Cursor background
agents, Codex, Claude Code) working this repo.** It is also read by Cursor and Codex
automatically. If anything here conflicts with a tool default, this file wins.

The founder's only job is to **test**. Everything else — code, tests, quality, Linear
updates, PRs — is yours. Do not ask the founder questions mid-run. Make reasonable
decisions, document them, and surface only when a packet is ready to test.

---

## 1. The goal (your standing objective)

Take Daylens from a half-working build to the PMF vision by completing the 36 issues in
the Linear project **Daylens v2** (workspace `irachrist1`). Source of truth:

- `docs/plans/DAYLENS-V2-PLAN.md` — the canonical plan (north star; read the relevant § only).
- `docs/plans/AGENT-EXECUTION-PLAN.md` — **who builds what**: model routing + work packets + order.
- Each Linear issue — its own self-contained spec (Problem / Checks it should pass).

You are done with the whole goal only when every issue is **Done**, and only the founder
marks Done.

## 2. The loop (how you run for hours, unattended)

1. Open `AGENT-EXECUTION-PLAN.md`. Find the **lowest-numbered packet that is not yet merged
   and whose dependencies are merged**. That is your packet.
2. Confirm you are the assigned model/engine for it. If not, stop — the right agent takes it.
3. Move every issue in the packet to **In Progress** in Linear.
4. Build the whole packet (see §3–§5). Iterate until the quality gate (§5) is green.
5. Open ONE PR for the packet (§4), tag `/bugbot`, address its findings.
6. Move the packet's issues to **In Review** + add the `ready-to-test` label, and comment
   on each (§6).
7. Pick up the next eligible packet and repeat. Keep going without pausing for the founder.

**Never run two packets that touch the same area at the same time on `v2`** — it creates
merge chaos. One packet in flight per surface.

## 3. Work in packets — never micro-PRs

- A **packet = 2+ related issues** that together produce **one notable, testable feature**.
  Packets are defined in `AGENT-EXECUTION-PLAN.md`. Do the whole packet in one run.
- **Do not** open a PR for a single small issue, and never a ~100-line PR the founder can't
  meaningfully test. If a packet ends up trivial, fold the next related issue in so the
  founder always has **at least one notable feature to test** per PR.
- A large standalone architectural rewrite (e.g. the block-fact contract, corrections
  system, chat-state rewrite) may be its own packet — those are substantial enough alone.

## 4. Branching & PRs (the founder is a 1–3 branch person)

- **Base branch is `v2`.** All work targets `v2`. Never push to `main` directly (it is
  protected: PR + typecheck required).
- One packet → one PR. Keep the number of live branches tiny; delete your working branch
  after merge.
- **Merge to `main` happens per phase, as one PR**, after the founder has tested that
  phase on `v2`. Do not open `main` PRs for individual packets.
- **Tag `/bugbot` on every PR** and resolve its findings before requesting test.

## 5. Quality gate — nothing reaches the founder broken

Before moving anything to In Review:

- `npm test` and `npm run timeline:eval` pass. Typecheck passes. Lint clean.
- For any UI/behavior change, **run the app and capture a screenshot** proving it — green
  tests are NOT product truth (see the plan's Truth Rule). Compare against the named
  failure screenshots in `docs/plans/screenshots/`.
- Self-review your diff for correctness, reuse, and dead code. Fix it yourself.
- If you genuinely cannot verify a thing live, leave the issue **In Progress**, add the
  `unverified` label, and say exactly why. Code passing is not proof.

## 6. Linear protocol (keep the founder's test queue clean)

- Status flow: **Todo → In Progress** (on start) → **In Review** + `ready-to-test`
  (done AND self-verified). 
- **Never set an issue to Done.** Only the founder does, after testing. If the founder
  sends it back, it returns to In Progress with their notes — fix and re-submit.
- When you move a packet to In Review, comment on each issue with:
  1. **What changed** (plain language).
  2. **How to test** — copy the issue's "Checks it should pass" steps; add the exact
     screen/path and any seed data needed.
  3. **Evidence** — screenshot(s) + the PR link.
- The founder filters on `ready-to-test` / the In Review column. That filtered list must
  always be testable features, never half-work.

## 7. Hands-off rules

- Don't ask the founder anything mid-run. Resolve ambiguity from the plan + issue; if still
  unclear, choose the simplest option that satisfies the issue's Checks and note it in the PR.
- Don't burn the founder's attention on trivia. Batch, finish, then surface.
- Plain language in all founder-facing text (Linear comments, PR descriptions). No jargon,
  no meta-commentary. State the feature and how to test it.

## 8. Model routing

Each packet has an assigned model + engine in `AGENT-EXECUTION-PLAN.md`. Respect it — the
assignment is based on each model's measured strengths (architecture vs. backend vs.
frontend vs. cheap mechanical). If you are not that model, don't take the packet.
