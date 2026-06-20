# ADR 0002 — How the AI gets data: plan → resolve → phrase

**Status:** Accepted · **Date:** 2026-06-20

## Context

The AI tab is the question-answering surface ("what did I work on today?"). Today it has
**two** answering systems bolted together behind a `shouldUseRouter` gate in
`aiService.ts`:

- a deterministic router (`routeInsightsQuestion`, `insightsQueryRouter.ts`), and
- an **agentic tool-loop** — the model is handed nine tools (`getDaySummary`, `getAppUsage`,
  `searchSessions`, `getBlockAtTime`, …) and orchestrates them itself.

When the router doesn't recognize a question, it falls through to the tool-loop. The most
important question in the app lands in the fragile path, and the tool-loop is exactly what
produces *"I don't have the tool results — could you share the getDaySummary output again?"*
(see `docs/findings.md` §3.1). The model is being asked to *find* the data and *decide
whether it exists*, which it has no reliable way to do, so it begs the user.

This contradicts `ai.md`, which has always said: the app resolves the data, the model only
phrases it.

## Decision

Every answer is built in three steps, always in this order. **The agentic tool-loop is
deleted, not patched.**

1. **Plan.** A planner maps the question to one or more **resolver** calls from a fixed,
   typed set — choosing which resolvers and filling their parameters. Common shapes route
   deterministically; the long tail may use a **single constrained model call that only emits
   a structured query** against the resolver schema. The planner never executes, never loops,
   never fetches.
2. **Resolve.** The app runs the chosen resolvers against the same store the Timeline and Apps
   views read. Deterministic: it finds data or it doesn't, and it knows which.
3. **Phrase.** The model is handed *only* the resolved facts and writes the answer in the
   Daylens voice. It does not decide what is true.

The model may **select, parameterize, and phrase**. It may never **execute or loop**. That is
the line between this and an agentic tool-loop.

### The resolver set (app-owned)

`getDay`, `getRange`, `getApp`, `getBlockAtTime`, `recall`, `getAttribution`, `listClients`.
New question types are served by **adding a resolver**, never by loosening the model. Declared
in one place, with types — the same resolvers the Timeline and Apps views read, so the AI
cannot disagree with them.

## Consequences

- The "I don't have the tool results" / "share the output again" failure class is gone — the
  model is never responsible for fetching.
- Answers are reproducible and groundable: a number in the AI tab is the resolver's number, which
  is the Timeline's number. One truth, three views (`ai.md` invariant 6).
- The long tail degrades honestly: if nothing maps, the answer says so in one line and offers
  the nearest answerable thing — it never falls back to free-form tool calls or begging
  (`ai.md` §4.2).
- This is the same shape as block **labeling** (`timeline.md` §3.5) and the best trackers'
  categorization (`docs/research/prior-art.md` §2): resolve/deterministic first, model for the
  ambiguous remainder, never the model deciding truth.
- Borrowed from the Raycast v2 rewrite (`docs/research/prior-art.md` §5): **one capability lives
  in one place**, and **contracts are declared once and typed** so capture → resolvers → views
  cannot drift. The resolver schema is that contract for the data layer.
- Reversible-ish: deleting the tool-loop is a real code change, but the resolvers already exist
  as the nine tools' implementations — we keep the bodies, drop the model-facing orchestration.

## Alternatives considered

- **Keep the agentic tool-loop, fix the prompts.** Rejected — the failure is structural, not a
  wording problem. Letting the model decide whether data exists is the bug.
- **Pure deterministic keyword router, no model planning.** Rejected — it can't cover the long
  tail of question phrasings; that brittleness is *why* the tool-loop fallback was added. A
  single constrained planning call keeps coverage without handing the model execution.
