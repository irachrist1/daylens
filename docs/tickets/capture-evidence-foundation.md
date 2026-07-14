# Focus events validate through one typed contract behind one repository

## Why

The capture specification's first migration slice: shared evidence types and a repository boundary around the existing `focus_events` contract, so later slices can extend the canonical repository without changing visible behavior.

## Current behavior

Partially implemented in the working tree, ahead of formal specification acceptance:

- `src/main/core/evidence/focusEvent.ts` defines the typed focus-event contract (event types, sources, confidence, schema version) with validation guards.
- `src/main/db/focusEventRepository.ts` provides insert, range-list, and count operations over `focus_events`.
- `tests/focusEventContract.test.ts` and `tests/focusEventRepository.test.ts` cover the contract guards and repository behavior.

Native macOS and Windows helper events do not yet route their validation through this shared contract, and existing consumers still query `focus_events` directly.

## Desired behavior

Per the [capture and evidence specification](../specs/capture-and-evidence.md) implementation starting point: macOS and Windows helper events validate through the same adapter, repository tests cover stable identity and idempotency, and no renderer or product query gains a new dependency on raw evidence storage. Timeline output does not change.

## Dependencies

- Acceptance of the capture and evidence specification confirms the envelope direction before the slice extends beyond the current contract.

## Acceptance checks

- Both native helpers' events pass through one validation path with rejected events counted as capture-health failures.
- Repository tests cover ordering, idempotent duplicate handling, and stable identity.
- No new direct `focus_events` query appears outside the repository.
- Timeline and Apps output for a representative day is unchanged.

## Verification

- `npm test -- focusEvent` plus the capture suites (`captureFoundation`, `windowsFocusCapture`, `macFocusFallback`).
- Running-app check on macOS and Windows that capture health and the live day behave as before.
