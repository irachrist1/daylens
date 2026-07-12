# Moment bench — terminal answer-quality checks (no chat UI)

**I built this today** — it was not an existing harness. Existing related tools:

| Tool | What it runs | Cost | Use when |
|---|---|---|---|
| `npm test` / `momentPageTitles.test.ts` | Seeded in-memory DB | Free | CI / regression |
| **`npm run moment:bench`** (this) | Live DB + deterministic router + title deriver | Free | Daily iteration without opening chat |
| `npm run test:behaviour` | Live DB + real `sendMessage` + LLM judge | API $$ | Pre-ship grading (needs approval) |
| `npm run ai:bench` | Seeded fixtures + optional live provider | Mixed | Router corpus regressions |

## UI linkage (important)

Chat `sendMessage` does this for moment questions:

1. `shouldUseRouter(question)` → must be true
2. `routeInsightsQuestion(...)` → **same function this bench calls** → structured fact string
3. `routerProsePass(question, structured)` → Settings model (e.g. Haiku) rewrites into prose
4. UI streams the prose (or falls back to the structured string if prose fails checks)

So: **facts are linked; display wording is not identical.** This bench asserts the fact layer the UI is grounded on. If the title/video is wrong here, the UI will be wrong too. If facts are right here but UI wording feels off, the prose pass is the suspect.

Chat titles use `deriveTitleFromMessage` — same function — and never call a model.

## Run

```bash
npm run moment:bench
npm run moment:bench -- tuesday_3pm_youtube
npm run moment:bench -- --ask "What was I watching on Tuesday, July 7 at 3:00pm?"
```

Never opens the chat UI. Never calls a model. Never writes to your DB (read-only).
