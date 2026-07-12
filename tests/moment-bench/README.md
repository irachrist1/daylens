# Chat bench — the terminal is the UI

Runs the hard question families against the **exact `sendMessage` entrypoint the
AI tab's IPC handler calls** (ADR 0003, ai.md §4.3), on a read-only copy of the
live DB, with the real Settings provider + keys from keytar. A PASS here is the
answer the UI streams for the same question on the same data — same code path,
same model, same tools. The only injected difference is the deps that *cannot*
be shared: the DB file is a temp copy (bench turns never appear in your
sidebar) and clarifying questions get a scripted answer.

**This bench makes real provider calls and costs money.** Run it deliberately;
it needs approval like the other provider-hitting suites (`AGENTS.md`).

| Tool | What it runs | Cost | Use when |
|---|---|---|---|
| `npm test` / `agentTools.test.ts` | Seeded in-memory DB, tool layer only | Free | CI / regression |
| **`npm run moment:bench`** (this) | Live-DB copy + real `sendMessage` + real model | API $$ | Proving chat behavior end to end |
| `npm run test:behaviour` | Live-DB copy + real `sendMessage` + LLM judge | API $$ | Pre-ship grading (needs approval) |

## Run

```bash
npm run moment:bench                       # all cases
npm run moment:bench -- tuesday_3pm_youtube  # one case
npm run moment:bench -- --ask "What was I watching Tuesday at 3pm?"
BENCH_VERBOSE=1 npm run moment:bench       # also print tool status lines
```

## Case families (cases.yaml)

- **Moments** — the exact video/page at one minute, never a block dump. Ground
  truth verified with sqlite against `website_visits` before pinning.
- **Follow-ups** — multi-turn cases run in one thread; "break that hour into
  10-minute increments" must cite ≥4 distinct clock times from the same hour.
- **Recall** — "find me the link" must return a real URL.
- **Exports** — "Excel of YouTube this month" must attach a real, non-empty
  `.xlsx` on disk.
- **Podcasts / shipped** — `dataDependent: true`: hard guards only (no begging,
  no hedging, banned phrases) plus a printed answer for human judgment.
- **Voice guards** — every answer in every case fails on the global banned
  phrases ("I don't have access", "could you share", "it appears that", …).

Thread titles are asserted not-weak on every case's first turn (deterministic
`deriveTitleFromMessage`, never a model).
