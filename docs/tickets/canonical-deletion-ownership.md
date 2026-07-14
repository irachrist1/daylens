# Centralize deletion ownership across organized facts

## Why

Current block deletion consistently hides owned activity from Timeline, Apps, search, memory context, AI tools, and MCP while preserving raw capture. V2 adds organized entities, relationships, summaries, actions, exports, AI threads, and encrypted sync objects that need one explicit deletion owner instead of surface-specific cleanup.

## Current behavior

The deterministic suite proves correction and ignored-span behavior across current local fact surfaces. Remote omission deletion is covered at the frozen remote boundary. Future organized facts and encrypted tombstones do not exist yet.

## Desired behavior

Define ownership and deletion propagation once for every organized fact, derived index, cache, queued action, export, model-context source, MCP result, and sync object.

## Dependencies

- Acceptance of the capture, memory, AI-agent, and privacy specifications.
- Stable organized-fact identifiers and provenance.
- The encrypted sync object contract before remote tombstone behavior is implemented.

## Acceptance checks

- A correction remains authoritative after restart, projection rebuild, reindex, and sync.
- Deleting raw evidence, one organized fact, one day, one thread, or all data removes exactly the records owned by that scope.
- Timeline, Apps, search, memory, AI, MCP, exports, web, and sync agree immediately and after recovery.
- Queued work cannot recreate a deleted fact; remote reconnection converges through tombstones.
- Unrelated raw evidence and user-authored facts remain intact.

## Verification

- Extend the synthetic-day harness with ownership fixtures for every organized object type.
- Run delete, retry, restart, rebuild, reindex, offline, reconnect, duplicate, and reordered-tombstone cases through production repositories and projections.
