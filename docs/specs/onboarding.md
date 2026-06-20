# Onboarding — build spec

## 1. What onboarding is

The first five minutes. A new user opens Daylens and, by the end, has **granted the
permissions Daylens needs and seen it already understand a slice of their real day.** The job
isn't to tour features — it's to earn trust fast by showing, on their own machine, that the
core promise works.

The bar: by the end of onboarding the user has thought *"oh — it actually sees what I do,"*
not *"okay, I've clicked through five slides about features I haven't tried."*

## 2. What's broken now and how it should work

- **It's undocumented and unverified** — there's no specced first-run, and what exists hasn't
  been confirmed on a real machine.
- **Capture needs permissions that nobody asks for clearly.** Window titles need macOS
  Accessibility; some surfaces need Screen Recording. Without a clean grant step, capture is
  half-blind from minute one (`docs/findings.md` §2.1) — which is the root cause of "Computer
  activity" blocks.
- **There's no proof step.** Nothing shows the user that capture is working before asking them
  to rely on it.
- **Capture health is invisible.** When a permission is missing or URL capture is off, the
  user has no way to see or fix it.

## 3. The flow

Short, honest, and front-loaded with the permission grant because nothing works without it.

1. **What Daylens is** — one screen, one sentence: *"Daylens quietly watches what you do on
   your computer and tells you what you actually got done. Nothing leaves your machine unless
   you ask."* Privacy stated up front, because that's the first question.
2. **Grant capture** — ask for **Accessibility** (window titles) and **Screen Recording** if
   needed, each explained in plain terms ("so Daylens can see *what* you're working on, not
   just which app"). Deep-link straight to the macOS settings pane; detect the grant and
   advance automatically.
3. **Wait for first capture** — a brief, honest "watching…" moment while real activity is
   recorded. No fake progress bar.
4. **Show the proof** — *"Here's what I can already see"*: the last few minutes of their real
   activity, named the Daylens way (the app they're in, the page they're on). This is the
   moment that earns trust — it must use **real captured data**, never a canned demo.
5. **Done** — drop them on the Timeline, live block running. Optionally offer to connect an AI
   provider now or later (briefs/recaps need it — `ai.md` §5), but capture works without it.

Onboarding is skippable-forward but not fakeable: if permissions aren't granted, the proof
step says so plainly and offers to fix it, rather than showing a fake success.

## 4. Capture-health diagnostics

A small, always-available "is Daylens seeing everything?" panel (surfaced in onboarding and
reachable later from Settings). It shows, in plain language, the health of capture:

- **Permissions** — Accessibility and Screen Recording granted or not, with a one-tap fix.
- **Window titles** — whether titles are actually being captured (the thing that was at 0/59
  on a real day — `findings.md` §2.1), not just whether the permission is on.
- **Browsers** — which browsers are being read, so a missing one (Zen) is visible and fixable
  (`apps.md` §3.4).
- **Idle / paused / private** — why a gap exists, so "nothing tracked" is always explained.

This panel is how a user (or we) tells a *permission* problem from a *capture* bug without
opening a database.

## 5. Trust affordances (carried into the app)

Onboarding sets the tone, but trust is ongoing. Across the app, Daylens marks its own
uncertainty instead of hiding it:

- Inferred or low-confidence items are visibly marked and easy to correct.
- Corrected-by-you, hidden, deleted, excluded, and stale states are distinguishable.
- A future day looks like a future day; a missing past day gives a reason; "no data" appears
  only when there genuinely is none.

These aren't a separate screen — they're the honesty the rest of the specs already require,
introduced here so a new user learns Daylens never bluffs.

## 6. Look & feel — get references first

The flow and content above are specced; the **visual design is deliberately not.** Onboarding
is the first impression, so the look matters — and it's exactly the kind of work where the
implementing agent **must collect reference screenshots from Tonny before building it** (see
`AGENTS.md` → "Design work — ask before you invent a look").

Touchstone to start the conversation, not to copy: **Raycast's onboarding** — calm, native,
one clear action per screen, no clutter, keyboard-friendly; **Dia** for warmth of voice. Ask
Tonny for the specific onboarding flows he likes and agree a direction **before** writing any
UI.

## 7. Invariants (rules this view must always obey)

1. Onboarding secures the capture permissions (Accessibility, and Screen Recording where
   needed) before handing the user the app.
2. The proof step shows **real captured activity** from the user's own machine — never a
   canned or demo screen.
3. If a permission isn't granted, onboarding says so plainly and offers to fix it; it never
   fakes a success.
4. Capture health (permissions, window-title capture, browsers read, idle/paused/private) is
   visible and fixable without touching a database.
5. AI setup is optional and clearly separate — capture and the Timeline work before any
   provider is connected.
6. Daylens never bluffs: inferred, low-confidence, future, paused, and missing states are
   always distinguishable from real, confident data.
