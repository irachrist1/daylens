# Product and documentation

## The lesson

Boop explains itself in the order a person needs: what it is, what it looks like, what it can do, what it is built from, how to run it, and where the code lives. The README functions as a product page and a practical entry point at the same time.

Daylens currently explains the idea more clearly than the running product. Someone can understand the promise, but they cannot yet see the Timeline, Apps, AI agent, evidence, corrections, or privacy controls before installing it. That is the gap to close.

## What works in Boop

### It demonstrates the product immediately

The README opens with a one-sentence description, identifies both supported runtimes, links a walkthrough, and shows the actual iMessage experience before explaining architecture ([`README.md`, lines 1–32](https://github.com/raroque/boop-agent/blob/31979130b1371acd9defbea115279a06c63c1fb4/README.md#L1-L32)). It later shows the agent activity, automations, memory, and connection surfaces with captions that explain what a person can do there ([`README.md`, lines 43–84](https://github.com/raroque/boop-agent/blob/31979130b1371acd9defbea115279a06c63c1fb4/README.md#L43-L84)).

Daylens should use the same principle with its own product hierarchy:

1. Show a real Timeline that explains a recognizable day.
2. Show Apps explaining what happened inside an application.
3. Show the AI agent answering a difficult question from the same memory.
4. Show the supporting evidence, correction, and privacy controls that make the answer trustworthy.

The screenshots should demonstrate one connected story rather than four unrelated screens. Their captions should explain the human outcome, not name UI components.

### It gives the architecture a shape

The small diagram near the top makes Boop's request flow understandable before the implementation details appear ([`README.md`, lines 27–39](https://github.com/raroque/boop-agent/blob/31979130b1371acd9defbea115279a06c63c1fb4/README.md#L27-L39)). The project layout later connects important files to that flow ([`README.md`, lines 580–646](https://github.com/raroque/boop-agent/blob/31979130b1371acd9defbea115279a06c63c1fb4/README.md#L580-L646)).

Daylens needs the equivalent at two levels:

- The README should contain one small product flow: device activity and connected sources become evidence, organized memory, Timeline and Apps, then agent answers.
- The architecture document should trace the real implementation from platform capture through normalization, storage, projections, retrieval, and presentation.

A project tree is useful only when verified against the repository. It should explain ownership and flow, not list every directory.

### It treats quick start as part of the product

Boop reduces a complicated multi-service setup to an interactive setup command and one development command ([`README.md`, lines 138–174](https://github.com/raroque/boop-agent/blob/31979130b1371acd9defbea115279a06c63c1fb4/README.md#L138-L174)). The scripts perform preflight checks, start dependent services, wait for readiness, and print useful endpoints instead of leaving the contributor to infer which process failed.

Daylens should aim for the same experience without copying Boop's dependencies or mutable packaging. A new contributor should be able to:

1. Install deterministic dependencies.
2. Run one setup or diagnostic command.
3. Start the desktop application and any required local companions with one command.
4. Run the complete offline verification path from the terminal.
5. Understand a failure from the command output without searching several logs.

### Its contributor guidance has a point of view

Boop's contributing guide begins by defining the repository as something small enough to read and fork, then names the changes that belong and asks for one concern per pull request ([`CONTRIBUTING.md`, lines 1–16](https://github.com/raroque/boop-agent/blob/31979130b1371acd9defbea115279a06c63c1fb4/CONTRIBUTING.md#L1-L16)). Its `CLAUDE.md` is short because it contains only repository-wide rules and one conditional pointer for Convex work ([`CLAUDE.md`, lines 1–30](https://github.com/raroque/boop-agent/blob/31979130b1371acd9defbea115279a06c63c1fb4/CLAUDE.md#L1-L30)).

Daylens should keep the same restraint:

- `AGENTS.md` contains only instructions that should enter every agent session.
- Product direction, implementation behavior, and workflow details stay in their owned documents.
- `CONTRIBUTING.md` explains what belongs, how to verify it, and what acceptance means in direct language.
- Documentation never claims a surface or command that the current code cannot provide.

The lesson is not to imitate Boop's wording. It is to make each document earn its place.

## Where Boop falls short

Boop's README grew to cover product pitch, setup, architecture, integrations, operating details, upgrades, and troubleshooting in one long file. Several claims drifted from the UI and build. Daylens should use its strong opening and demonstration style without turning the README into the complete manual.

Boop also documents itself as a personal template with explicit security and cost caveats ([`README.md`, lines 88–92](https://github.com/raroque/boop-agent/blob/31979130b1371acd9defbea115279a06c63c1fb4/README.md#L88-L92)). Daylens is intended to become a dependable product. Honest status language is useful; treating missing security or release work as an acceptable permanent boundary is not.

## Daylens application

The root README should eventually contain real product media, the core flow, the short source quick start, and the documentation index. Detailed installation, architecture, specifications, security, testing, and release information remain in their owned files.

This work is recorded in the [to-do list](../../TO-DO.md). Screenshots and product demonstrations must be captured from the running application; placeholders and borrowed Boop media are not acceptable.
