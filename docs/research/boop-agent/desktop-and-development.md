# Desktop and development

## The lesson

Boop's desktop work is valuable because it recognizes that a local agent needs a durable home. The application owns operating-system permissions, launches and monitors local services, reports their health, and survives normal use without requiring someone to keep a terminal open.

Daylens needs the same ownership for a different reason: capture, evidence, local storage, indexing, and the primary memory experience already live on the device. The desktop application is the product's first complete milestone, not a temporary wrapper for the web companion.

## Permissions belong to the application

Boop moved Apple-data access into its desktop application so Full Disk Access and Automation permissions were granted to a recognizable app rather than whichever terminal happened to launch the server. That is better product behavior even though Boop's complete Apple-data and security model should not be copied.

Daylens should own and explain every platform permission it needs:

- why the permission is required
- which feature depends on it
- whether capture is active now
- what remains available when it is denied
- how to grant, verify, revoke, pause, or exclude it
- whether a relaunch or settings change is required

Permission status should be derived from authoritative platform checks. A green indicator cannot be inferred only because a child process started.

## The desktop shell owns lifecycle and recovery

Boop's Electron shell supervises its server, Convex, dashboard, and tunnel and exposes start, stop, restart, readiness, and runtime-folder controls. Its implementation is development-grade, but the ownership model is correct.

Daylens should make the health of its own components visible without presenting internal machinery as the primary product:

- platform capture and idle/lock signals
- browser context where supported
- local database and migrations
- evidence projection and repair jobs
- local search and embedding index
- configured model access
- connectors and sync when enabled

Normal failures should have a bounded recovery action and a terminal diagnostic. Restart recovery must distinguish incomplete, failed, retriable, and completed work rather than treating process exit as the truth.

## Terminal operation is a product requirement

An agent developing Daylens cannot rely on visually clicking the application for every verification. Every important domain behavior should have a deterministic terminal entry point or fixture path, including capture-event ingestion, privacy filters, Timeline construction, Apps totals, memory retrieval, context assembly, agent tool calls, connector normalization, migrations, billing policy, and sync boundaries.

This does not mean recreating the graphical product as a CLI. It means separating domain behavior from Electron and renderer state so agents and CI can supply controlled input and inspect authoritative output.

The independent testing review will decide the precise harness and gaps. Boop contributes the broader lesson: the same services should be operable through one well-explained development path, with readiness and failure visible from the terminal.

## Setup should be productized

Boop's `npm run setup`, preflight, and `npm run dev` scripts turn several dependencies into one guided flow. Daylens should adopt the experience with stricter reproducibility:

- use the lockfile and pinned tools
- keep generation and migrations in normal verification
- verify required native/platform dependencies before launch
- never download or execute an unpinned latest package as a convenience fallback
- report which service or prerequisite failed and the exact recovery command
- ensure the command CI runs is the command contributors are told to run

One development command should start everything required for the selected surface and stop its children cleanly. It should not make a development server the production desktop architecture.

## Form factor follows the job

Boop moved from web to native iOS to iMessage because the agent was most useful inside an existing conversation surface. Daylens has a different primary loop: the desktop creates the memory, displays the reconstructed day, and hosts the private local evidence. Its first agent belongs inside that product.

The later web companion has a narrower job: remote search and agent chat over explicitly synchronized organized facts. It should not become a remote control for raw desktop evidence or a second implementation of capture.

Other surfaces can be evaluated later by whether they reduce friction for a real job. A CLI may be valuable for development, exports, diagnostics, and scripted retrieval. A system tray or quick agent entry may be valuable for immediate questions. Neither should be added merely because another agent product uses that form.

## Open-source upgrades and migration

Boop is a fork-and-own template. It checks for upstream changes and provides an agent-assisted upgrade procedure that previews changes, creates a rollback point, applies updates, runs verification, and surfaces breaking migrations ([`README.md`, lines 650–695](https://github.com/raroque/boop-agent/blob/31979130b1371acd9defbea115279a06c63c1fb4/README.md#L650-L695)).

Daylens is an application rather than a template, so it should not copy the fork synchronization workflow as its primary update mechanism. The useful principles are:

- breaking changes are explicit and paired with a migration
- migrations are idempotent and testable
- updates have a rollback or recovery plan
- customized open-source forks can understand what changed
- release notes describe user-visible changes in plain language

Repository skills should not be loaded into every agent session to implement migrations. If an agent-assisted migration exists later, the person explicitly invokes it and the migration remains backed by normal versioned code and tests.

## Code and documentation style

Boop's strongest style choice is restraint: a small top-level instruction file, direct contributor guidance, a clear project map, and comments mainly where behavior is surprising. Daylens should keep its existing documentation ownership model and apply the same test to every file: does this help a contributor understand the product, current implementation, accepted behavior, active work, or operating procedure?

Generated coverage ledgers, session diaries, duplicated explanations, and promises that someone will fill something in later do not pass that test.
