# Daylens — agent entry point

**Before doing any work in this repo, read [`AGENTS.md`](AGENTS.md) and
[`docs/plans/AGENT-EXECUTION-PLAN.md`](docs/plans/AGENT-EXECUTION-PLAN.md) and follow them
exactly.** They define the autonomous build of Daylens v2: the work packets, model routing,
branch model (branch from `main` per packet → PR to `main`), Linear status protocol, quality
gate, and the rule that only the founder marks an issue Done after testing.

The founder's only job is to test. Build in packets (2+ related issues → one notable,
testable feature → one PR), keep checks green, update Linear, tag `/bugbot`, never push to
`main` directly.
