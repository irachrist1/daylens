# Reconcile real-day Timeline, Apps, and AI facts

## Why

The private real-day replay for 2026-07-13 reaches three production consumers of the same captured activity and they disagree materially. The Timeline renderer projection reports 10,731 tracked seconds, the direct Timeline payload used by AI and wrap paths reports 23,454 seconds, and Apps reports 36,667 seconds. The direct payload also reports 33,874 focused seconds, which is greater than its tracked duration.

This result must remain a failing real-day comparison. It must not be accepted as the expected day merely because each surface is internally deterministic.

## Desired behavior

- Timeline, Apps, search, memory, MCP, wrap, and AI read one corrected canonical interpretation of the same intervals.
- Browser time is attributed without being double-counted or discarded.
- Focused duration never exceeds eligible tracked duration for the same scope.
- Persisted and rebuilt projections produce the same result unless an explicit versioned migration changes the interpretation.
- Calendar events are distinguished from captured meetings, and supported matches appear consistently across Timeline and AI.

## Dependencies

- Acceptance of the capture/evidence, Timeline, and Apps specifications.
- A reviewed private real-day baseline for at least one activity-rich day.

## Acceptance checks

- The accepted real-day comparison has no unexplained Timeline/Apps duration disagreement beyond its recorded tolerance.
- Direct payload, renderer IPC projection, AI tools, and wrap facts agree on totals and block ownership.
- Focus time is clamped to canonical active intervals.
- Calendar-only, captured-only, and matched meetings are reported separately; no calendar event becomes claimed work without supporting evidence.
- Correction, exclusion, and deletion update every consumer without resurrecting removed evidence.

## Verification

- Run `npm run verify:real-day` against the accepted private fixture.
- Run `npm run verify:real-day:desktop` on a disposable clone to compare renderer DOM with production IPC and exercise correction and deletion.
- Run the deterministic synthetic and strict Timeline gates for controlled edge cases.
