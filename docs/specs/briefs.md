# Briefs

**Status:** Ready for review.

This specification defines the proactive briefs: the morning brief, the evening recap, and the weekly brief. Briefs are part of the Version 2 release; they ship rebuilt on the same corrected facts, interpretation, evidence, and voice as Timeline, Apps, Wrapped, and the AI agent.

A brief is proactive delivery of understanding Daylens already has. It is never a second summarization system: there is exactly one set of period facts and one interpretation, and a brief presents them at a useful moment.

The carryover nudge is removed. It is not part of Version 2 and is deleted with the brief rebuild, not migrated.

## Product behavior

- The **evening recap** arrives near the end of the person's working day and offers the day understood so far: what the day was about, in one or two lines, opening into the full day view.
- The **morning brief** arrives at the start of the next working day and recaps yesterday: one honest line about what yesterday actually was, opening into that day.
- The **weekly brief** arrives at the week boundary and opens into the week's wrap.

Every brief can be disabled independently. Briefs are off until onboarding consent for notifications, and disabling notifications disables all of them.

## One fact system

- A brief's content comes from the same corrected activity facts, period facts, and interpretation used by Timeline, Apps, Wrapped, and the agent. No brief computes its own totals or runs its own summarization pipeline.
- A brief line follows the shared voice contract and the person's chosen tone.
- A brief never contradicts what the person sees when they open the app: the numbers and names in the notification are the numbers and names on the surface it opens.
- Corrections made before a brief is generated are reflected in it; a brief is generated from current facts at delivery time, not from a stale cache.
- Excluded and deleted activity never appears in a brief.

## Scheduling and delivery

The existing rhythm-aware scheduling and operating-system notification delivery are kept: delivery windows derive from the person's work rhythm, a missed window is skipped rather than delivered late into an unrelated part of the day, and model-backed generation attempts are capped per day.

- A brief fires at most once per period; restarts and wakes do not duplicate it.
- Generation happens shortly before delivery so the content reflects the day as captured.
- Managed-allowance exhaustion or an unavailable provider produces either a deterministic fact-only brief or silence — never a degraded guess.

## Notification content and privacy

- The notification shows a short line and opens the full surface; detail lives in the app, not the notification.
- Notification text follows the same exclusion and privacy rules as every surface. Nothing excluded, deleted, private-window derived, or high-sensitivity appears in a notification, which can be visible on a lock screen.
- A person can choose activity-free notification text ("Your evening recap is ready") without losing the brief.
- Analytics receive delivery, open, and dismiss events only — never brief content.

## Honesty

- A brief over a partly captured day says so instead of presenting the fragment as the whole day.
- An empty day produces no recap notification; silence over invention.
- A brief never assigns productivity, focus, or distraction judgments.
- If the underlying evidence conflicts, the brief either states the uncertainty naturally or omits the conflicted claim; it never picks a convenient version.

## Failure behavior

- Generation failure, provider failure, rate limiting, or allowance exhaustion never produces an inaccurate notification. The fallback order is: deterministic fact-only line, then silence.
- Notification-permission loss surfaces once in capture health, not as repeated failed attempts.
- A brief whose target surface cannot render (missing day, deleted data) is not delivered.
- Clock changes, sleep, and timezone travel never fire duplicate or out-of-window briefs.

## Evaluation

- Brief content is covered by the same interpretation and voice fixtures as Wrapped, since it presents the same facts.
- Scheduling has deterministic tests for rhythm windows, missed windows, restarts, day rollover, and attempt caps.
- The private real-day benchmark includes the briefs for the reviewed day and week: their lines must agree with the accepted reconstruction and with what Timeline, Apps, and the wrap show for the same period.

## Acceptance criteria

- Every brief line is traceable to the shared period facts; a brief can never disagree with the surface it opens.
- The carryover nudge is removed from code, settings, and scheduling.
- Each brief can be independently disabled, and none fires before notification consent.
- Missed windows skip; restarts do not duplicate; attempts respect the daily cap.
- Excluded, deleted, and private content never appears in notification text; the activity-free notification option works.
- Provider unavailability produces fact-only briefs or silence, verified by tests.
- Briefs for a reviewed real day agree with the accepted reconstruction in the running product.

## Implementation starting point

The first ticket should delete the carryover nudge and route the evening recap's content through the shared corrected facts and voice contract, keeping today's scheduling and delivery. The morning and weekly briefs follow the same path once the evening recap agrees with Timeline for real days.
