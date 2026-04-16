# Docs Cleanup Summary

## Removed

- Historical change logs and issue audits
- Old implementation plans and inference-first drafts
- Prompt files for backend/frontend agents
- The standalone activity-tracking note that duplicated the current-state summary
- Windows parity audits, schema snapshots, and cross-platform contract drafts
- Stale build/release notes that duplicated code or workflow configuration
- The old `docs/improvement-plan.md` note that was already ignored by `.gitignore`

## Rewritten

- `README.md` was cut down to a short product overview and pointer to the source of truth.
- `docs/CURRENT_STATE.md` was added as the single concise reference for current product, architecture, data, direction, and constraints.

## Kept as source of truth

- `README.md` for a minimal entry point
- `docs/CURRENT_STATE.md` for the current product map

## Remaining gaps

- There is no separate public API contract doc anymore; the code is the source of truth.
- If browser tracking, sync, or AI provider behavior changes materially, `docs/CURRENT_STATE.md` will need a small refresh.
