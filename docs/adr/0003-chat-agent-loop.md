# ADR 0003 — Chat is one agent loop with a grounded tool surface

**Status:** Accepted · **Date:** 2026-07-12 · **Supersedes:** ADR 0002 *for the chat
surface only* (block labeling, wraps, briefs, and recaps keep the resolve-then-phrase
shape from 0002).

## Context

ADR 0002 deleted the old agentic tool-loop and replaced chat with a deterministic
router plus plan → resolve → phrase. Live testing (2026-07, founder) shows the result:
six distinct answering systems stitched together behind regex gates
(`shouldUseRouter`, `followUpResolver`, greeting/action/transform intercepts), where

- moment questions dump a whole block's pages instead of the minute asked,
- "break that hour into 10-minute increments" restates the previous answer because no
  regex recognizes it,
- hard families (what did I ship, podcasts this month, Excel exports, fuzzy link
  recall) have no path at all, and
- quality flips between precise and wrong depending on which system a phrasing lands in.

Every fix is another regex. The router does not scale to open-ended questions; that is
a structural property, not a bug count.

The 0002 failure that justified deleting the old loop — the model begging *"could you
share the getDaySummary output again?"* — was real, but the root cause was the loop's
**thin tool surface and missing grounding contract**, not the loop shape. The old loop
handed the model nine tools with no miss semantics, no evidence trace, and no
verification, and let it decide what existed. The industry has since converged on the
loop shape (Claude, ChatGPT, Cursor, every serious agent product) with exactly the
guardrails the old loop lacked.

## Decision

Chat becomes **one agent loop** in Electron main, built on the Vercel AI SDK
(`ai@6`, `ToolLoopAgent`), replacing the router, the follow-up resolver, the planner,
the phrase pass, and the router prose pass for the chat surface. The model reasons,
calls read-only tools, asks the user a clarifying question when genuinely stuck, and
answers in the Daylens voice.

Grounding is enforced by contract, not hope:

1. **Tools return real rows or an explicit miss.** Every Daylens tool returns either
   data straight from the store Timeline and Apps read, or `{ found: false, reason }`.
   The model never gets an ambiguous silence to fill.
2. **The tool trace is the evidence.** Every turn persists which tools ran and what
   they returned (message `metadata_json`). A claim that cannot be traced to the
   turn's tool results is a defect.
3. **Post-answer verification.** Clock times, dates, and durations in the final answer
   are checked against the turn's tool results (the `verifyTimestamps` approach from
   the prose pass, generalized). A failed check triggers one retry with the violation
   named; a second failure ships the honest miss, never the fabrication.
4. **Read-only, always.** The tool surface has no write, edit, or delete. In-app
   mutations (rename block, merge, focus sessions, memory) stay outside the loop as
   the existing confirm-gated action widgets.
5. **Caps.** Step count and output tokens are capped per turn; cancel aborts the loop
   and every in-flight tool.

The tool surface, v1: Daylens data tools (day overview, moment evidence, visits,
history search, app usage) wrapping the same `queries.ts`/`aiTools.ts` bodies the
Timeline reads; read-only file reads; read-only git (allowlisted subcommands, no
shell); MCP client for servers the user configures; a clarifying-question tool; a file
artifact tool (csv/xlsx/md). New capabilities are new tools, never loosened prompts.

Providers come from Settings via the AI SDK provider packages — Anthropic, OpenAI,
Google, and OpenAI-compatible (OpenRouter, managed proxy). CLI providers cannot make
structured tool calls; chat says so in one line and points to Settings rather than
silently degrading (invariant 12).

**Bench parity is architectural.** The chat entrypoint is one function,
`sendChatMessage(payload, deps)`; the IPC handler and the terminal bench both call it.
The bench differs only in injected deps (DB copy, stream collector), never in code
path, so a bench PASS is the answer the UI streams.

## Consequences

- One answering system. Quality no longer flips at regex boundaries; follow-ups keep
  context because the loop carries real message history.
- `insightsQueryRouter.ts` (~130KB of intent branches), `followUpResolver.ts`,
  `ai/planner.ts`, `ai/phrase.ts`, the router prose pass, and `shouldUseRouter` are
  deleted from the chat path. Their honesty guardrails (tracking-window bounds,
  empty-day handling) move into tool contracts and the system prompt.
- Every answer costs a multi-step model conversation. `withProviderCallCount` watches
  per-turn call counts; caps bound the worst case.
- The moment bench stops probing the router and drives the real entrypoint, provider
  call included — it becomes the product's acceptance harness.
- Wraps, briefs, labels are untouched: bounded-input narration is what
  resolve-then-phrase is good at. 0002 stays correct there.

## Alternatives considered

- **Keep patching the router.** Rejected: the live failure list is the evidence; each
  new question family costs a new regex and the seams show.
- **Anthropic Agent SDK / OpenAI Agents SDK.** Rejected: Claude-only (breaks the
  Settings-model invariant) / wraps the AI SDK anyway.
- **LangGraph.** Rejected: graph/checkpoint machinery a single chat loop doesn't need.
