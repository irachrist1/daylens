# AI behavioural harness

Tests the AI the way a user actually uses it: real DB (read-only copy), real Anthropic key from keytar, real `sendMessage` pipeline, real provider call, real LLM judge.

This is NOT a unit test. It's a black-box behavioural runner. Its job is to surface bad answers — hallucinations, refusals when data exists, voice slips, timeouts, broken artifacts — that hermetic tests miss.

## Run

```bash
npm run test:behaviour
```

Requirements:
- Anthropic key already saved in Daylens → Settings → AI (read from macOS keychain).
- Daylens has been opened at least once so there's a real `daylens.sqlite` to copy.

The harness:
1. Copies `~/Library/Application Support/DaylensWindows/daylens.sqlite` (and `-wal` / `-shm` sidecars) to a temp directory. The real DB is never touched.
2. Reroutes Electron's `app.getPath('userData')` to that temp dir so `initDb()` opens the copy.
3. Loads the Anthropic key from keytar via the real `getApiKey('anthropic')`.
4. Pins `aiProvider` + `aiChatProvider` to `anthropic` for the run.
5. Gathers a compact ground-truth summary (clients, today's blocks, yesterday's blocks, 7-day roll-up).
6. For each scenario in [scenarios.yaml](./scenarios.yaml): calls `sendMessage(...)` directly, captures the verbatim assistant answer + route + source kind + artifact count.
7. Runs an LLM judge (Claude Sonnet 4.5) over the answer with the rubric and ground truth. Verdict is `good | bad | worse | error` with a one-line reason.
8. Prints scenario-by-scenario output to the terminal — colour-coded, scenario, question, route, answer, verdict.
9. Writes `.ai-behaviour/results-<stamp>.json` for diffing across runs.

## Cost

About 2 Anthropic calls per scenario (the answer plus the judge). 13 scenarios ≈ 26 calls. Single run is well under a dollar with Sonnet 4.5.

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
