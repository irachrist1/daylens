# Build the screen-context lifecycle and terminal harness

## Why

Screen-context capture and processing are an accepted experiment design, not current production code. Creating a fake test-only implementation now would provide false confidence.

## Current behavior

Normal capture, exclusions, canonical evidence, deletion, search, AI context, MCP, and sync privacy have terminal coverage. There is no production frame lifecycle, extractor, quarantine repository, or deletion owner for a test to exercise.

## Desired behavior

Implement the lifecycle state machine and repositories described in `docs/specs/screen-context.md`, with injected frame and extractor adapters only at the operating-system and model boundaries.

## Dependencies

- Acceptance of `docs/specs/screen-context.md`.
- A production decision for the local extraction runtime.

## Acceptance checks

- Pause, protected surfaces, and exclusions apply before frame capture.
- Extraction and derived-evidence commit are atomic before raw deletion.
- Failures remain quarantined, visible, retryable, and deletable.
- Delete removes raw and derived records from Timeline, Apps, search, memory, AI, MCP, export, and sync.
- Logs, analytics, crash reports, and sync contain measurements only, never captured content.

## Verification

- Add a fake-frame source and deterministic extractor fixture to a production lifecycle harness.
- Run packaged multi-display and permission checks on macOS and Windows.
