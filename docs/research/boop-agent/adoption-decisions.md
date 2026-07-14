# Adoption decisions

This file converts the Boop research into explicit Daylens dispositions. “Adopt” means the principle is already consistent with accepted Daylens direction. It does not authorize implementation without an accepted specification and active ticket.

## Adopt

| Lesson                                                                 | Daylens application                                                                                                                                       | Owner                                                                                                                                     |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Keep provider runtimes behind one product-owned contract.              | Context, tools, events, errors, cancellation, and evidence meanings remain stable across managed, BYOK, and any approved subscription-backed adapter.     | [Agent runtime and context](../../specs/agent-runtime-and-context.md)                                                                     |
| Make context assembly the core agent system.                           | Construct the smallest evidence-backed packet for the question, then provide narrow retrieval tools for more detail.                                      | [Agent runtime and context](../../specs/agent-runtime-and-context.md)                                                                     |
| Scope tools to the task.                                               | Connectors, files, and workers receive only the relevant sources, entities, time range, and permissions.                                                  | [Agent runtime and context](../../specs/agent-runtime-and-context.md) and [Connectors](../../specs/connectors.md)                         |
| Treat a login or permission as a resumable human handoff.              | Pause visibly, let the person complete the sensitive step in the correct surface, then revalidate state before continuing.                                | [Agent runtime and context](../../specs/agent-runtime-and-context.md) and [Onboarding and consent](../../specs/onboarding-and-consent.md) |
| Show source and account identity.                                      | A person can tell which calendar, repository, workspace, or meeting source supported an answer. Ambiguity is resolved before use.                         | [Connectors](../../specs/connectors.md)                                                                                                   |
| Make agent work inspectable without copying content.                   | Show runtime, model, sources, tools, approvals, duration, status, and redacted failures while keeping captured content out of analytics and generic logs. | [AI agent](../../specs/ai-agent.md) and [Privacy, retention, and sync](../../specs/privacy-retention-and-sync.md)                         |
| Let the desktop own permissions, local services, health, and recovery. | Platform capture and private local memory remain dependable without requiring a terminal to stay open.                                                    | [Capture and evidence](../../specs/capture-and-evidence.md) and [Onboarding and consent](../../specs/onboarding-and-consent.md)           |
| Make setup and verification understandable from the terminal.          | Contributors and agents can start, inspect, and test domain behavior without navigating the UI.                                                           | [Development](../../development.md) and [Testing](../../hygiene/testing.md)                                                               |
| Demonstrate the product before documenting its internals.              | The README uses real screenshots and one connected example across Timeline, Apps, AI agent, evidence, and privacy.                                        | [To-do list](../../TO-DO.md)                                                                                                              |

## Prototype or verify before adopting

| Question                                                                    | Evidence required                                                                                                                                                             | Recorded in                  |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Does Claude Agent SDK or another agent harness outperform the current loop? | Run identical accepted context packets, tools, and representative-day questions. Compare factual correctness, disclosure fidelity, latency, cancellation, recovery, and cost. | [To-do list](../../TO-DO.md) |
| Does a dispatcher-worker split improve Daylens answers?                     | Compare one agent with scoped workers on the same fixtures. Adopt only if a defined quality or context result improves without losing provenance or control.                  | [To-do list](../../TO-DO.md) |
| Should Composio handle long-tail connectors?                                | Pilot one read-only connector behind a pinned Daylens adapter. Measure OAuth benefit, schema drift, privacy, reliability, and maintenance cost.                               | [To-do list](../../TO-DO.md) |
| Can Claude or Codex subscriptions power a commercial Daylens runtime?       | Obtain written permission for the exact third-party authentication and commercial use. Technical login success is insufficient.                                               | [To-do list](../../TO-DO.md) |
| Which terminal harness covers the complete product?                         | Inventory existing tests and expose controlled inputs and authoritative outputs for each domain that currently requires UI operation.                                         | [To-do list](../../TO-DO.md) |

## Defer

- General browser automation. Daylens screen context is evidence acquisition, not autonomous control of logged-in websites.
- Proactive briefs and automations. Correct answers from the existing memory come first.
- A broad end-user CLI. Build terminal test and diagnostic surfaces first; validate a separate customer job before creating another product surface.
- Organizational agent access. The individual product and reviewed-summary sharing boundary come first.
- Agent-assisted application upgrades. Normal signed updates, migrations, and rollback must exist independently of an AI workflow.

## Reject

- A global plaintext cloud database as canonical personal memory.
- Cloud synchronization of raw desktop evidence, screenshots, transcripts, or unrestricted file content.
- Raw connector catalogues or hundreds of vendor tools in model context.
- Write-capable tools being available before a typed preview and confirmation.
- Prompt instructions being treated as authorization, idempotency, or a security boundary.
- Unconfirmed conversational inferences becoming permanent personal facts.
- Automatic destructive memory consolidation.
- Ambient skills or project instructions entering the runtime without explicit selection.
- A general filesystem, shell, persistent browser, or private-network tool for the conversational agent.
- Raw tool inputs and outputs copied into logs for observability.
- Webhooks or scheduled jobs acknowledged before durable, idempotent ownership exists.
- Concurrent turns in one thread without ordering, cancellation, and recovery semantics.
- Deletion that leaves known derivatives in embeddings, traces, caches, sync projections, or snapshots.
- Unsigned, unpacked development topology presented as the production desktop application.

## Result

Boop changes how Daylens should prioritize the work, not what Daylens fundamentally is. The desktop memory and its context assembler remain the foundation. The agent runtime is an adapter around that foundation; connector breadth, workers, additional surfaces, and subscription-backed execution follow only when evidence and permissions justify them.
