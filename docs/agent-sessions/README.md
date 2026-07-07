# Agent sessions — 2026-07-07 six deliverables

The original single mega-prompt has been split into **four sequenced sessions**, each a
self-contained prompt you paste into a fresh agent. Run them **one at a time, in order** —
they are heterogeneous work with different blockers, and one context window can't hold
good state across all of them. (This is the lesson from the model-routing doctrine baked
into each file: one orchestrator per natural batch, decomposing to sub-agents/Codex itself.)

## Order

| # | File | Deliverable(s) | Blocked? |
|---|------|----------------|----------|
| A | `session-a-journey-map.md` | Reconstruct `implementation-2026-07-07.md`, then D1 interactive user-journey map | No — **start here** |
| B | `session-b-posthog-events.md` | D2 PostHog event taxonomy (audit + implement 10 events, verify live) | Needs running app + PostHog access |
| C | `session-c-monorepo-cleanup.md` | D4 monorepo cleanup (irreversible — supervised) | No, but do **not** run headless/autonomous |
| D | `session-d-shipping-and-linear.md` | D5 shipping checklist + D6 Linear setup | Needs Linear workspace access |
| E | `session-e-intercom.md` | D3 Intercom (Fin) in the Electron app | Partially — App ID in hand; token + IV secret still needed |

## Session E — Intercom credential status

App ID **`y4l8ype0`** is confirmed (public). Still needed before Session E can fully finish
(founder fetches from Intercom settings, pastes into `services/billing/.env`, never committed):
REST access token, Identity Verification secret, and OAuth client id/secret (only if using a
custom OAuth app). The Messenger + client-side identify are buildable/testable **now** with
just the App ID; `user_hash` and server-side attribute sync are blocked until those secrets
exist. See the file for the client-vs-backend security split.

## Corrections folded into the prompts (the original was written from a stale audit)

- `docs/implementation-2026-07-07.md` **did not exist** — Session A Task 0 reconstructs it
  from git range `6df04fa..HEAD` so later sessions have the "already done" baseline.
- D4 named `packages/snapshot-schema` and `packages/prompt-builder` — they actually live at
  **`apps/web/packages/`**, not top-level. Session C investigates before adding workspace globs.
- D4 said "move the SwiftUI directory `daylens-swiftUI`" — **there is no SwiftUI dir in this
  repo** (only `probes/capture-probe.swift`). Session C flags this instead of inventing it.
- D2 asserted "currently nothing works" — Session B treats that as a claim to verify first,
  not gospel.

## Environment reality (verified 2026-07-07 — read before trusting the doctrine)

The model-routing doctrine is adapted from a Fable-5 workflow video. Not all of that video's
setup exists here. What was actually checked on this machine:

- ✅ **Codex CLI works.** `codex-cli 0.142.5`, logged in via ChatGPT. `codex exec -m gpt-5.5
  -s read-only "..."` runs (test returned OK). Native `codex exec review` exists. So the
  **read / analyze / review lane is real** — use it freely for token-heavy reads.
- ⚠️ **No `--effort` flag.** Codex effort is a config value (`-c model_reasoning_effort=...`),
  not a CLI flag. Default here is `xhigh`, which is fine for GPT-5.5 (the "keep it on high"
  warning is about the Claude 5-family, not GPT-5.5). The prompts use `codex exec -m gpt-5.5
  -s read-only`.
- ❌ **No Codex computer-use skill, and `codex exec` cannot drive a GUI.** Only three codex
  skills are installed (`codex-cli-runtime`, `codex-result-handling`, `gpt-5-4-prompting`).
  The video's computer-use/review/implementation skills were hand-built and not shared.
  Computer-use in the video is the Codex *desktop app*, which is not wired to Claude Code here.
  **Therefore: agents verify headless; the founder does every visual/real-app check.** This
  matches AGENTS.md ("only the founder marks something done after testing on a real day").
- ⚠️ **"Workflows"** (Theo's staged JS engine) aren't a confirmed primitive here. The real
  orchestration primitive is **sub-agents via the Agent tool** (`deep-reasoner`, `fast-worker`,
  `codex-peer` are defined). Treat "write a workflow" as "orchestrate sub-agents" unless the
  harness proves out a workflow engine.

### ⚠️ PostHog wizard collision (Session B)

A PostHog setup wizard is/was running via the **`integration-python`** skill — but Daylens'
analytics is **`posthog-node`** (TypeScript, `src/main/services/analytics.ts`). A *Python*
wizard is the wrong SDK for this codebase; treat its code output with suspicion (its dashboard/
planning steps may still be useful). Run **Session B after** the wizard and have it audit the
wizard's output as the existing messy state — not assume a clean slate.

## The shared doctrine

Every session file opens with the same **Operating doctrine** block: Fable 5 at HIGH effort
(never xhigh/max/ultra), the intelligence-vs-taste model routing, how to shell out to
GPT-5.5 via Codex, sub-agents vs. workflows, and the verification rule (done = runtime-
confirmed + committed, never "tests pass"). It's repeated verbatim in each file so each is
self-contained.
