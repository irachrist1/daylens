# Agent architecture

## The lesson

Boop reinforces a central Daylens decision: an agent is not primarily a model. It is the model plus the context, tools, permissions, memory, execution loop, human handoffs, and product surface around it.

The most important Daylens question is therefore not “Should we use the Claude Agent SDK?” It is “What should the agent know for this request, and what may it do with that knowledge?” A runtime can improve the loop, but it cannot answer that product question for us.

## Context is the Daylens advantage

Boop's own walkthrough reaches the same conclusion after adding Apple data and a logged-in browser: an agent is only as good as the tools and data supplied to it. Daylens has a stronger opportunity because its core product already creates an evidence-backed account of the day.

For every request, Daylens must decide:

- the relevant time range and timezone
- the people, projects, clients, meetings, applications, pages, repositories, and files involved
- which corrected facts and Timeline blocks are authoritative
- which source is fit to support each claim
- what is uncertain, excluded, stale, or contradictory
- which additional connector or file evidence is necessary
- what may be disclosed to the selected model
- which narrow tools are required to finish the investigation

That is the context assembler specified in [Agent runtime and context](../../specs/agent-runtime-and-context.md). It belongs to Daylens and remains the same when the runtime changes.

## Runtime adapters, not runtime ownership

Boop places Claude Agent SDK and Codex App Server behind a shared request and result contract ([`server/runtimes/types.ts`, lines 1–54](https://github.com/raroque/boop-agent/blob/31979130b1371acd9defbea115279a06c63c1fb4/server/runtimes/types.ts#L1-L54)). That seam is worth adopting. It prevents provider-specific sessions, events, tools, and errors from leaking through the complete application.

Daylens should keep its own runtime contract and test candidates against identical context packets, tools, and representative-day questions. Claude Agent SDK may prove better at long-running tool use, interruption, or workers. Codex App Server may offer different strengths. The existing AI SDK loop may be sufficient for V2. The comparison is empirical; the product should not be restructured around a candidate before it wins that comparison.

Boop's ability to use a person's Claude Code or Codex login is not evidence that Daylens may sell the same capability. Technical authentication and permitted third-party commercial use are separate questions. Subscription-backed adapters remain excluded until the relevant provider gives written permission.

## Front agent and workers

Boop uses a small interaction agent as a dispatcher and gives focused workers the integrations needed for a task ([`README.md`, lines 45–58](https://github.com/raroque/boop-agent/blob/31979130b1371acd9defbea115279a06c63c1fb4/README.md#L45-L58)). The useful part is capability scoping, not the assumption that every request needs a worker.

Daylens should begin with one conversational agent and narrow retrieval tools. A worker is justified when a bounded investigation would otherwise flood the main thread, take materially longer, require an isolated capability, or benefit from parallel independent retrieval. Each worker receives only its task, time range, entities, evidence budget, and permitted tools. It cannot expand those permissions or recursively create an uncontrolled worker tree.

This must be decided through fixtures that compare one agent with a dispatcher-worker split on correctness, evidence fidelity, latency, cost, cancellation, and recovery.

## Tools and connectors

Boop's integration registry and per-spawn toolkit selection are useful boundaries. Its broad Composio exposure is not. In some paths a worker can receive hundreds of raw vendor tools and version checks are skipped. That lets the connector vendor's catalogue become the product's capability and security model.

Daylens should expose a small set of owned tools with stable meanings:

- retrieve corrected activity and memory
- inspect supporting evidence and provenance
- resolve entities and source conflicts
- search a specifically connected source
- request a specific connection when a material gap exists
- propose a reversible Daylens change
- preview and confirm a permitted action

Calendar, GitHub, Linear, Granola, and later connectors are adapters behind those contracts. A broker such as Composio may reduce OAuth and long-tail integration work, but its raw tools, credentials, schemas, and availability do not become Daylens contracts.

## Files are evidence, not an open filesystem

An agent SDK often makes filesystem access feel natural. Daylens cannot translate that into unrestricted access to a person's machine.

The [runtime specification](../../specs/agent-runtime-and-context.md) separates three states:

1. Daylens observed that a file was active.
2. The person allowed Daylens to index its content locally.
3. A relevant excerpt may be disclosed to the selected model for this request.

The runtime receives a Daylens tool for permitted excerpts, not a general filesystem or shell. Version, sensitivity, provenance, deletion, and revocation remain enforceable outside the model.

## Human intervention

Boop handles a logged-out browser by opening a visible browser, asking the person to authenticate, and continuing after confirmation. The pattern is useful beyond browsers: an agent must be able to stop for a login, operating-system permission, clarification, correction, or action confirmation without losing the task.

Daylens should represent these as durable pending states. Resuming rechecks permissions, connector state, file versions, exclusions, and action validity. It should never ask a person to send credentials through chat.

Chat-based settings changes are also useful when the change is unambiguous and reversible. The agent may offer to change a Daylens setting, show the exact change, and use the same validation and confirmation path as Settings. Sensitive permissions and external provider authentication still use their dedicated system or browser surface.

## Inspection without copying private content

Boop makes agent runs understandable by showing runtime, model, task, integrations, accounts, tools, status, duration, and failures. Daylens should adopt that information hierarchy so a person can understand why an answer exists or why it failed.

It must not copy Boop's raw tool logging. Daylens traces should retain tool identity, source/account identity, evidence identifiers, policy decisions, timing, status, and redacted summaries. Email bodies, titles, URLs, extracted screen content, file text, and other captured content should not be duplicated into analytics or general diagnostic logs.

## Boundaries Daylens must not copy

- global plaintext cloud memory without per-person authorization
- prompt-only approval while write-capable tools remain available
- unconfirmed facts written from conversation as permanent memory
- ambient project skills that differ by provider and enter context automatically
- unrestricted shell, filesystem, browser, or connector toolkits
- retries that can repeat an external side effect without an idempotency record
- chat turns that can complete out of order in the same thread
- deletion that leaves embeddings, snapshots, logs, or sync derivatives behind

These are product trust boundaries, not implementation refinements.
