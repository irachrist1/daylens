# Onboarding and consent

**Status:** Accepted.

This specification defines the first run: how a new person consents to capture, grants the operating-system permissions Daylens needs, sees proof that capture works on their own machine, and sets their first privacy boundaries.

Onboarding exists to earn trust with real behavior, not to tour features. It is the consent boundary that [Capture and evidence](capture-and-evidence.md) depends on: capture begins only after the person explicitly agrees on this surface.

## Product behavior

By the end of onboarding a person has:

1. Understood what Daylens captures, what it never captures, and where the data stays.
2. Explicitly consented to capture.
3. Granted the operating-system permissions capture needs on their platform.
4. Seen their own real activity captured and named the Daylens way.
5. Had the chance to exclude private applications and websites before history accumulates.
6. Optionally set up AI access; capture, Timeline, and Apps work without it.

The flow is skippable forward but never fakeable: if a permission is missing, the proof step says so plainly and offers to fix it rather than showing canned success.

## Consent

The consent screen precedes any capture. It states in product language:

- what is captured by default: foreground applications, window titles, active browser pages, and machine state
- what is never captured: private or incognito windows, screenshots and screen video, audio, keystrokes, message bodies, and file contents
- that activity stays in the local database unless the person later enables a feature that sends selected context elsewhere
- that pause, exclusions, deletion, and export are always available

Declining leaves Daylens open with capture off and a clear way to consent later. Consent is recorded with its policy version. A material change to the capture policy re-presents consent before the changed behavior takes effect.

## Platform permissions

- **macOS** requires Accessibility for window titles. Onboarding explains the benefit, deep-links to the system pane, detects the grant, and advances automatically. Screen Recording is not requested during onboarding; the screen-context experiment owns that permission separately. Browser tab access that triggers a system Automation prompt is requested in context, not up front.
- **Windows** needs no system privacy grant for foreground capture; onboarding verifies that the capture helper is running.
- **Linux** support depends on the desktop session. Onboarding reports the detected support level honestly and links to capture health instead of implying full capture where the session cannot provide it.

A missing permission produces a visible capture-health state, never silent half-capture presented as complete.

## Proof step

After permissions are granted, onboarding waits briefly for real capture and then shows what Daylens can already see, interpreted in the product voice. The proof uses only genuinely captured activity from this machine. If nothing was captured, the step says why and offers the fix.

## First privacy boundaries

Before onboarding completes, the person can:

- add applications and websites to never track, seeded from their actual visible activity
- learn that private browser windows are always excluded and that pause is one click away

Exclusions set here use the same enforcement as Settings: rejected before persistence, effective immediately.

## Optional profile and AI setup

- A display name may be requested for greeting only.
- The person may optionally name clients or projects they work with; these seed entity resolution and can be edited or removed later in memory management.
- AI setup is clearly optional and follows [Billing and entitlements](billing-and-entitlements.md): start the trial, bring your own key, or skip. Skipping changes nothing about capture, Timeline, Apps, or search.

Onboarding does not require role, tone, or preference choices to complete.

## Capture-health diagnostics

A plain-language "is Daylens seeing everything?" panel is reachable from onboarding and later from Settings. It shows permission state, helper state, browser page-context state, and the specific fix for anything missing.

## Failure behavior

- Denied or revoked permission produces an explained, recoverable state at any point in the flow.
- Quitting mid-onboarding preserves consent state; capture never runs beyond what was consented.
- The proof step times out into an honest "nothing captured yet" state with diagnostics, not a spinner.
- Analytics receive step progression and permission-state categories only, never captured content or names.

## Acceptance criteria

- Capture is verifiably off before consent and on after it, across supported platforms.
- Each platform's permission flow is tested on a real machine, including deny-then-grant.
- The proof step shows real captured activity and cannot show fabricated activity.
- Exclusions added during onboarding prevent persistence immediately.
- Declining AI setup leaves a fully working local product.
- Re-running onboarding after a policy-version change re-presents consent.

## Implementation starting point

The first ticket should make consent an explicit recorded state that gates every capture adapter, verified by a regression test that no capture path persists evidence before consent. Flow and visual changes follow once the gate is proven.
