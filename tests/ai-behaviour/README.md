# AI behavioural harness — the answer-quality eval program (Q6)

Tests the AI the way a user actually uses it: real DB (read-only copy), real provider key from keytar, real `sendMessage` pipeline, real provider call, real LLM judge.

This is NOT a unit test. It's a black-box behavioural runner — the answer-quality eval program from `docs/AI-TAB-V2-SPEC.md` (Q6). Its job is to surface bad answers — hallucinations, refusals when data exists, voice slips, templated follow-ups, timeouts, broken artifacts — that hermetic tests miss, and to do it **per provider** before shipping AI changes.

## Run

```bash
# default: evaluate Anthropic, judged by Anthropic
npm run test:behaviour

# evaluate a specific provider (judge always stays Anthropic)
DAYLENS_EVAL_PROVIDER=google npm run test:behaviour
DAYLENS_EVAL_PROVIDER=openai npm run test:behaviour

# run one scenario by id
npm run test:behaviour -- what_model

# record/refresh the committed per-provider baseline (Q6 reference point)
DAYLENS_EVAL_BASELINE=1 DAYLENS_EVAL_PROVIDER=anthropic npm run test:behaviour
```

The **judge** always runs on Anthropic (a constant, reliable grader). The **subject** under evaluation is `DAYLENS_EVAL_PROVIDER` (default `anthropic`). Results are written to `.ai-behaviour/results-<provider>-<stamp>.json`; baselines (when requested) to `tests/ai-behaviour/baselines/<provider>.json`.

Requirements:
- Anthropic key saved in Daylens → Settings → AI (the judge needs it), plus the subject provider's key if it differs.
- Daylens has been opened at least once so there's a real `daylens.sqlite` to copy.

## Families & rubric

Every answer is graded against a `gold_answer_shape` (what a colleague who watched you work would say) plus rubric flags. The set covers the question families the spec calls out: who-are-my-clients (`client_attribution`), today/at-a-moment (`time_at_moment`), by-project (`specific_work`), by-app / focus / this-week (`time_and_duration`), reports (`generative`), patterns (`reflective`), **files** (`files`, Q2), **identity + follow-ups** (`meta`, Q3), one-grounded-number (`consistency`, Q1), and a fabrication trap (`hallucination_trap`). The judge also grades the **follow-up chips** (Q3/Q4): they must be grounded and must never template a meta-entity (provider/model name) into a canned question.

`tests/aiEvalProgram.test.ts` is the hermetic, free guardrail (runs in `test:ai-chat`): it asserts the eval set stays well-formed and keeps covering every required family, so a future edit can't silently drop one. The graded run above stays out of CI because it bills the API and needs real keys.

### Cross-turn consistency (Q1) — known limitation

The harness sends each scenario as a fresh single turn, so it can't reproduce a *cross-turn* contradiction (the 3h45m-then-25s YouTube case). `youtube_time_consistency` is a single-turn proxy. True cross-turn consistency needs a multi-turn scenario type — tracked as follow-up.

The harness:
1. Copies `~/Library/Application Support/DaylensWindows/daylens.sqlite` (and `-wal` / `-shm` sidecars) to a temp directory. The real DB is never touched.
2. Reroutes Electron's `app.getPath('userData')` to that temp dir so `initDb()` opens the copy.
3. Loads the judge key (`getApiKey('anthropic')`) and the subject key (`getApiKey(DAYLENS_EVAL_PROVIDER)`) from keytar.
4. Pins every provider preference key (`aiProvider`, `aiChatProvider`, `aiArtifactProvider`, `aiSummaryProvider`, `aiBlockNamingProvider`) to the subject for the run.
5. Gathers a compact ground-truth summary (clients, today's blocks, yesterday's blocks, 7-day roll-up).
6. For each scenario in [scenarios.yaml](./scenarios.yaml): calls `sendMessage(...)` directly, captures the verbatim assistant answer + route + source kind + artifact count.
7. Runs an LLM judge (Claude Sonnet 4.5) over the answer with the rubric and ground truth. Verdict is `good | bad | worse | error` with a one-line reason.
8. Prints scenario-by-scenario output to the terminal — colour-coded, scenario, question, route, answer, verdict.
9. Writes `.ai-behaviour/results-<stamp>.json` for diffing across runs.

## Cost

About 2 provider calls per scenario (the subject answer plus the Anthropic judge). 16 scenarios ≈ 32 calls. A single run is well under a dollar with cheap models.

## When to add scenarios

Add a new entry to `scenarios.yaml` whenever:
- A user reports an AI answer that "felt off."
- A new question shape ships (e.g. a new tool registered in `aiTools.ts`).
- A regression was fixed — pin a scenario that would have caught it.

Each scenario has:
- `id` — short slug
- `question` — verbatim user input
- `family` — one of the five PRODUCT-SPEC families plus `hallucination_trap`
- `rubric` — boolean flags the judge enforces

## Exit code

Non-zero only if any scenario errored or > 1/3 of scenarios scored `worse`. The point of the harness is to surface failures, not block CI on every `bad`. Treat the printed verdict + the JSON dump as the signal.

## Why not in CI?

This depends on a real Anthropic key in macOS keychain and a real Daylens DB. Run locally before shipping AI changes. The hermetic `ai:bench` and `test:ai-chat` continue to gate CI for router/gate regressions.

## What this tests vs. what `ai:bench` tests

| Layer | `ai:bench` (live mode) | `test:behaviour` |
|---|---|---|
| Calls real provider | Yes | Yes |
| Calls `sendMessage` (router + tools + voice) | No — bare provider call | Yes |
| Uses real DB | No (seeded fixtures) | Yes (read-only copy) |
| Graded by LLM judge | No (substring asserts) | Yes |
| Inspects voice / hallucination | Substring lists only | Judge explains *why* |
| Cost per run | Free without keys | ~26 Anthropic calls |
