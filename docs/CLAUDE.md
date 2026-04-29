# Daylens Contributor Guide

Start from code, not prose.

Use sources in this order:

1. Current implementation in `src/main`, `src/renderer`, `src/shared`, `packages/remote-contract`, and the paired `daylens-web` repo when remote behavior is in scope.
2. Behavior tests in `tests/`.
3. `docs/ISSUES.md` for current status wording.
4. `docs/AGENTS.md` for the product contract.
5. The remaining docs only after the code and status ledger agree.

Rules:

- Existing docs are hypotheses until the code confirms them.
- Use exact file references when helpful.
- Distinguish code-proven, inferred, and runtime-validated claims.
- Use `implemented pending verification` when code exists without runtime proof.
- Keep `docs/ISSUES.md` as the implementation-status ledger.
- For remote-companion work, re-audit both `daylens` and `daylens-web` before claiming parity.
- Daylens is one desktop product for macOS, Windows, and Linux. Treat cross-platform behavior as the default requirement for every shared feature, including shortcuts, tray/menu behavior, launch-on-login, packaging, permissions, path handling, diagnostics, and updates.
- Never define done from a macOS-only dev run. Call out what was tested on macOS, Windows, and Linux separately, and mark unproven platforms as pending verification.
- The in-app update path is critical infrastructure. Do not casually change app identity, release tags, artifact names, update feed URLs, `latest*.yml`, signing, download routes, or release workflows. If a change can strand existing users on an old version, stop and ask.
- Release and update notes are product UI. Keep them short, meaningful, user-facing, and free of internal implementation jargon such as function names, regex details, commit dumps, or routing internals.
- If a request or product term is unclear, ask a concise clarifying question instead of guessing. Use available skills when they fit: `grill-me` for stress-testing a plan, `grill-with-docs` for reconciling product language with docs/code, and `to-prd` for turning settled context into an implementation-ready PRD or issue.
