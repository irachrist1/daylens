# Reconcile real-day Timeline, Apps, and AI facts

## Why

The private real-day replay for 2026-07-13 reaches four production consumers of the same captured activity and they disagree materially. Worse, when asked about the day, the agent claimed the surfaces agreed. A product whose one promise is a trustworthy memory cannot show four different day lengths and then deny the difference.

This result must remain a failing real-day comparison. It must not be accepted as the expected day merely because each surface is internally deterministic, and the private day is reviewed for acceptance only after the surfaces genuinely agree.

## Current behavior

For 2026-07-13, the same captured activity produces:

- Timeline renderer projection: 10,731 tracked seconds (2h 59m)
- Direct Timeline payload used by AI and wrap paths: 23,454 tracked seconds (6h 31m), reporting 33,874 focused seconds — more focus than tracked time
- AI day-overview tool: about 24,800 seconds (6h 53m)
- Apps: 36,667 seconds (10h 11m)

Asked about the day, the agent asserted there was no disagreement between surfaces instead of naming the conflict.

The packaged desktop replay adds a fourth divergence class: the rendered Apps view does not visibly present one of the five largest applications reported by its own IPC summary for the same date, so `verify:real-day:desktop` currently fails on its DOM-versus-IPC comparison.

## Desired behavior

- Timeline, Apps, search, memory, MCP, wrap, and AI read one corrected canonical interpretation of the same intervals.
- Browser time is attributed without being double-counted or discarded.
- Focused duration never exceeds eligible tracked duration for the same scope.
- Persisted and rebuilt projections produce the same result unless an explicit versioned migration changes the interpretation.
- Calendar events are distinguished from captured meetings, and supported matches appear consistently across Timeline and AI.
- When surfaces or evidence genuinely conflict, the agent names the conflict; it never asserts agreement it has not verified.

## Dependencies

This is Wave 1 work and follows its order: capture and evidence migration, then the shared corrected activity-fact query, then Timeline and Apps on that shared seam, then agent context and answers. It requires:

- Acceptance of the capture/evidence, Timeline, and Apps specifications.
- The shared corrected activity-fact query ticket.

The failing 2026-07-13 comparison guides this work. A reviewed private baseline is the exit of this ticket, not an entry condition: the day is reviewed and accepted only when Timeline, Apps, meetings, and AI agree and the reconstruction is genuinely useful.

## Acceptance checks

- The real-day comparison has no unexplained Timeline/Apps duration disagreement beyond its recorded tolerance.
- Direct payload, renderer IPC projection, AI tools, and wrap facts agree on totals and block ownership.
- Focus time is clamped to canonical active intervals.
- Calendar-only, captured-only, and matched meetings are reported separately; no calendar event becomes claimed work without supporting evidence.
- Correction, exclusion, and deletion update every consumer without resurrecting removed evidence.
- Asked about a day whose surfaces or evidence conflict, the agent states the specific conflict.
- The 2026-07-13 reconstruction passes review and is accepted as the private baseline.

## Verification

- Run `npm run verify:real-day` against the private fixture until the disagreement is resolved, then accept the reviewed day.
- Run `npm run verify:real-day:desktop` on a disposable clone to compare renderer DOM with production IPC and exercise correction, deletion, and one approved AI turn.
- Run the deterministic synthetic and strict Timeline gates for controlled edge cases.
