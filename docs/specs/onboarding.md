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

Short, honest, warm, and front-loaded with the permission grant because nothing works
without it. It should feel **minimal and delightful**, told as a small story, with our
mascot **Lumen** (a friendly camera-lens character) present. Every example reads for a
normal person — a proposal, a call, an inbox — **never developer-specific**.

1. **Greeting** — Lumen waves. *"Hi {name} 👋 — great to have you on Daylens."* A single
   name input whose placeholder is derived from the computer's friendly name
   ("Christian's MacBook Pro" → `Christian`, via `app.getComputerName()`). The name is only
   ever used to greet the user.
2. **Why (the story)** — answer the real first question, *"why let an app watch my whole
   laptop?"*, in a few calm beats: it all stays on this device, no screenshots/video ever,
   and at the end of the day you get an honest recap of what you actually got done. A small,
   low-contrast **Skip** so the keen path is default but nobody is trapped.
3. **Grant capture** — ask for **Accessibility** (window titles). Screen Recording is **not**
   required — capture reads titles via the AX API only (see §7 inv. 1 / `trackingPermissions`).
   Deep-link to the macOS pane; detect the grant and advance automatically; never trap.
4. **Wait for first capture** — a brief, honest "watching…" moment. No fake progress bar.
5. **Show the proof** — *"Here's what I can already see"*: real captured activity, named the
   Daylens way. **Real captured data, never a canned demo.**
6. **Narrated day (tour)** — one *relatable* everyday day told back the Daylens way (merge,
   absorbed detour, two clean blocks, recap, weekly wrap). Advances by an explicit control,
   small Skip — **no "tap anywhere"**.
7. **About you** — `userRole` (Consultant · Designer · Engineer · Founder · Writer · …, single
   pick) plus *why you're here* (intent chips + free text). The role seeds the next screen's
   suggestions, so it pays off immediately. Lumen reflects the pick back ("I'll tune your day
   for designer work").
8. **Pick your voice** — three sample "tunes" of the same day (**Straight · Warm · Witty**,
   default Warm); the choice drives every recap/wrap prompt (`src/shared/summaryVoice.ts`).
9. **Your work** — categories you care about + which apps count as *real work* (one deduped
   list seeded from your actual top apps).
10. **Who you work with, and when** — `userClients` (add chips, optional) + `workRhythm`
    (early bird · nine-to-five · night owl · always on). Optional, skippable.
11. **Keep it private** — apps to **never track**, added via a "+ keep private" affordance with
    quick-add from your real apps (reuses tracking exclusions). Not a repeated full app list.
12. **AI setup** — care-first money moment, adaptive to the real `getBillingAccess()` snapshot:
    leads with **$5 of AI free every month, on us** (covers recaps/wraps/briefs), offers a paid
    plan for unlimited chat when checkout is live, and **bring your own key** for anyone who'd
    rather not pay. Optional and clearly separate; capture and Timeline work without it.
13. **Ready** — *"You're all set, {name}."* Reflects the whole profile back — role, voice, real-work
    apps, clients, private apps — plus a sample recap in the chosen voice.

Onboarding is skippable-forward but not fakeable: if permissions aren't granted, the proof
step says so plainly and offers to fix it, rather than showing a fake success.

> **Deferred:** a desktop "connect to Screen Time" cross-check (Opal-style) was considered
> but skipped this pass — macOS exposes Screen Time only through an undocumented protected
> store, so it isn't reliably readable by a third-party app yet.

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

The **visual craft is now implemented** (`src/renderer/views/Onboarding.tsx`,
`src/renderer/components/Mascot.tsx`): one fixed *stage* frame that never resizes and scrolls
its content inside the frame (fits the 820×580 floor with the footer visible), a single
type/chip/card/input/button system, Lumen present on every screen with per-moment expressions,
and calm reduced-motion-aware transitions. The original brief is kept for reference in
[`onboarding-design-brief.md`](onboarding-design-brief.md).

## 7. Invariants (rules this view must always obey)

1. Onboarding secures the capture permission (**Accessibility** — the only one capture
   uses; window titles come from the AX API, not Screen Recording) before handing the user
   the app, and never traps them on the grant step.
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
