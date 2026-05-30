# Daylens Contributor Guide

**Before touching any AI code path** (system prompt, tool, router, judge rubric, harness scenario, capture surface), read in this order:

1. `docs/AGENTS.md` — what Daylens is
2. `docs/AI-PRODUCT-DIRECTION.md` — first principles and the P0 directives every agent must respect (activity-not-app, time awareness, minute precision, never-refuse, capture-surface-is-not-fixed, common understanding)
3. `docs/PRODUCT-SPEC.md` — the views and the bar

The open punch-list of unfinished work is delivered as a prompt from the user when a session starts; it is not stored in a doc.

If a plan or diff violates a P0 in `AI-PRODUCT-DIRECTION.md`, stop and ask. No agent ships against the user's first principles.

For everything else, start from code, not prose.

Use sources in this order:

1. Current implementation in `src/main`, `src/renderer`, `src/shared`, `packages/remote-contract`, and the paired `daylens-web` repo when remote behavior is in scope.
2. Behavior tests in `tests/`.
3. `docs/AGENTS.md` for the product contract.
4. The remaining docs only after the code agrees with them.

Rules:

- Existing docs are hypotheses until the code confirms them.
- Use exact file references when helpful.
- Distinguish code-proven, inferred, and runtime-validated claims.
- Use `implemented pending verification` when code exists without runtime proof.
- Documented ≠ shipped. Prompt-tweaked ≠ data-fixed. State plainly which one a change is.
- For remote-companion work, re-audit both `daylens` and `daylens-web` before claiming parity.
- Daylens is one desktop product for macOS, Windows, and Linux. Treat cross-platform behavior as the default requirement for every shared feature, including shortcuts, tray/menu behavior, launch-on-login, packaging, permissions, path handling, diagnostics, and updates.
- Never define done from a macOS-only dev run. Call out what was tested on macOS, Windows, and Linux separately, and mark unproven platforms as pending verification.
- The in-app update path is critical infrastructure. Do not casually change app identity, release tags, artifact names, update feed URLs, `latest*.yml`, signing, download routes, or release workflows. If a change can strand existing users on an old version, stop and ask.
- Release and update notes are product UI. Keep them short, meaningful, user-facing, and free of internal implementation jargon such as function names, regex details, commit dumps, or routing internals.
- The behavioural harness costs real money per run. Run scenarios one at a time with the filter (`npm run test:behaviour -- <scenario_id>`); only run the full suite when the user explicitly authorizes it.
- If a request or product term is unclear, ask a concise clarifying question instead of guessing.
