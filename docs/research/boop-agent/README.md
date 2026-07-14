# What Daylens can learn from Boop

Boop is useful because it treats an agent as a complete product rather than a chat box around a model. Its runtime, tools, permissions, memory, desktop shell, setup, documentation, and interaction surface are designed as one system.

That is the main lesson for Daylens. The model is replaceable. The difficult and valuable work is deciding what the agent knows, which evidence it can retrieve, which tools it can use, how people remain in control, and whether the whole system is understandable and dependable.

Boop is a reference, not a foundation for Daylens. It is a young, single-user personal-agent template with security, durability, privacy, and release assumptions that cannot support the Daylens product as written. We should copy its clarity and narrow patterns, not its complete architecture.

## Conclusions

- The Daylens agent should be built around a Daylens-owned context and tool boundary. Claude, Codex, or another runtime sits behind that boundary.
- The context assembler is the core agent system. It decides which facts, files, connectors, corrections, and evidence the agent needs for a specific question.
- Tools should be narrow and task-scoped. A model should not receive every connector, file, or capability because it might become useful.
- The desktop application owns capture, permissions, local services, health, and recovery. It is not merely a wrapper around a website.
- Setup and terminal verification are product surfaces. One setup path and one development command should make the entire local system understandable.
- Product documentation should demonstrate the working product with real screenshots, a fast start, an honest status, and a verified project map.
- Subscription-backed Claude or Codex runtimes are technically interesting but are not a commercial plan until the providers permit the intended use in writing.
- Boop's global cloud memory, raw-tool exposure, prompt-only action approval, ambient skills, and development-grade desktop packaging must not be copied.

## Read the useful analysis

1. [Product and documentation](product-and-documentation.md) — why Boop is easy to understand and what Daylens documentation should adopt.
2. [Agent architecture](agent-architecture.md) — runtime, context, tools, files, connectors, human intervention, and observability.
3. [Desktop and development](desktop-and-development.md) — permissions, process supervision, setup, terminal workflows, and open-source maintainability.
4. [Adoption decisions](adoption-decisions.md) — what Daylens adopts, prototypes, defers, and rejects, linked to its specifications.

## Sources and scope

This analysis is based on:

- [`raroque/boop-agent` at `3197913`](https://github.com/raroque/boop-agent/tree/31979130b1371acd9defbea115279a06c63c1fb4)
- the repository README, contributor instructions, architecture, setup scripts, runtime adapters, agent loops, Electron shell, integrations, memory implementation, tests, and release configuration
- Chris Raroque's two walkthroughs describing the original open-source release and the later Claude/Codex, browser, Apple-data, and desktop work

The original investigation inspected the full repository and traced important claims into code. These documents keep the decisions and supporting evidence without retaining a file-by-file inspection ledger. Research does not override an accepted Daylens product specification. Any change to product behavior still belongs in `docs/product`, `docs/specs`, or an active implementation ticket.
