# Session B — PostHog feature-event taxonomy

**Read `docs/full-audit-2026-07-07.md` and `docs/implementation-2026-07-07.md` first.** Do not
redo work already recorded there.

> Run this session against a **running dev build with PostHog reachable** — it cannot be
> completed headless. Verification (events landing in PostHog) is part of "done."

---

## Operating doctrine (applies to this whole session)

**Model & effort.** Run as Fable 5 at **HIGH** reasoning effort. Not xhigh/max/ultra — they
over-reason, overdo the code, and cost multiples more without being smarter. HIGH is right.
Effort is per-step thinking, not how long you can work.

**Model routing (defaults, not limits).** *Intelligence* = hardest problem handled
unsupervised; *taste* = UI/UX, code quality, API design, copy. **Fable 5 (you):** best
intelligence + taste, steer everything. **Opus 4.8:** high taste, cheaper, good reviewer.
**GPT-5.5 via Codex:** high intelligence, low taste, effectively free — use liberally for
bulk reads and computer-use, but have Fable/Opus review its code. Cost is only a tie-breaker;
for anything that ships, intelligence > taste > cost. Escalate to a smarter model the moment
output misses the bar, without asking.

**Shelling out to GPT-5.5 (Codex) — verified working here.** Reads/analysis:
`codex exec -m gpt-5.5 -s read-only "<self-contained prompt>"` — effort is a Codex config
value, not a CLI flag (no `--effort`). Prompt it simply and literally; "nothing found" is valid,
don't loop. **No computer-use skill is installed and `codex exec` can't drive the GUI** — do not
have it launch the app or screenshot; live app checks go to the founder.

**Sub-agents vs. workflows.** Fan out independent reads to sub-agents; write a JS workflow
when work has real stages. Reach GPT-5.5 inside a workflow via a Sonnet-on-low sub-agent that
calls Codex and reports back. Prefix 5.5-driven work with `[5.5]`.

**Verification rule (non-negotiable).** Done = (1) code is correct, (2) verified — the agent
asserts event payloads headlessly **and** the founder confirms the live events land in PostHog,
(3) committed. Green tests are not proof. You have no computer-use tool, so you do the headless
half and hand the live check to the founder. If you can't verify your half, say so and stop.

**When the ground contradicts the prompt.** This came from an audit and may be stale — flag
mismatches, never invent to make an instruction true.

---

## Task 1 — Audit what fires today (verify the claim, don't assume)

The audit claims "currently nothing works." Treat that as a hypothesis to confirm.

- Read `src/main/services/analytics.ts` and **every call to `capture()` across the whole
  codebase** (fan this read out to Codex). 
- Produce a short list: every event that is *supposed* to fire, and for each, whether it
  actually reaches PostHog today or is broken (and why — missing key, wrong init, dead code
  path, never called).
- Fix the ones that are broken. Getting the existing pipeline reliably firing is prerequisite
  to adding new events.

## Task 2 — Implement exactly these ten events

Each must fire **exactly once** at the moment described, with the listed properties. Do not
add any events beyond these ten. Ten events that always fire correctly beats thirty that fire
inconsistently.

- **`app_launched`** — `platform, version, days_since_install, has_completed_onboarding,
  subscription_status`
- **`view_opened`** — `view_name (timeline|apps|insights|settings|recap), date_context
  (today|past), block_count` (block_count for timeline). Fire on every navigation to a view.
- **`analyze_day_clicked`** — `date, tracked_hours, block_count_before`. Fire on the Analyze
  Day click.
- **`ai_chat_sent`** — `thread_id, message_length, has_date_context, model_used`. Fire when
  the user sends a chat message.
- **`block_edited`** — `block_id, what_changed (label|category|time|deleted)`. Fire on save in
  the block editor.
- **`tracking_paused` / `tracking_resumed`** — `reason (user|app_excluded|incognito)`.
- **`onboarding_step_completed`** — `step_name, step_index, total_steps`.
- **`paywall_seen`** — `trigger (onboarding|proof_screen|day3_prompt|settings)`.
- **`subscription_started`** — `plan, price, trigger`.
- **`crash_recovery_shown`** — `db_size_mb, integrity_check_result`. Fire if the corruption
  screen appears.

## Verify & hand off, then commit

You do **not** have a computer-use tool and `codex exec` can't drive the Electron GUI, so split
verification:

**Agent verification (headless):**
- Static-verify each of the 10 events: correct name, single fire-once call site, and exact
  properties — cite each by `file:line`.
- Confirm the PostHog client actually flushes: `posthog-node` buffers and will silently drop
  events unless `flush()`/`shutdown()` runs on the relevant lifecycle (app quit, etc.). Verify
  this in `analytics.ts` — it's the most common reason "events don't show up."
- Where feasible, exercise the pipeline headlessly: call the emitting functions from a small
  node harness/test against a PostHog test key and assert the payloads. Do not fake this via a
  running GUI.

**Founder handoff (the live 60-second check):** give the founder exact steps — launch the app,
open three views, click Analyze Day, open AI chat + send a message — and have them confirm the
five events land in PostHog within 60s with correct properties. Only the founder marks it done.

Commit after headless verification passes; note in the commit that the live check is pending
founder. Append three sentences to `docs/implementation-2026-07-07.md`.
