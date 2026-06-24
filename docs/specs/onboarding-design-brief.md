# Onboarding — design brief

**For the designer picking this up.** The flow, copy, and behavior are built and working
(see [`onboarding.md`](onboarding.md) for what each step does and the rules it must obey).
What's missing is the *craft*: it doesn't yet feel like one continuous, delightful thing.
This brief says exactly how it should feel and names the two concrete problems to fix. Treat
the copy and step order as settled; treat the look, rhythm, and motion as yours to finish.

Touchstones we like: **Linear** (calm, one clear action per screen), **Opal** and **Dia**
(warmth, personality), **Raycast** (native, uncluttered). Not to copy — to set the bar.

---

## 1. The feeling we're going for

One unbroken, calm story — start to finish — that makes a new person think *"oh, this already
feels like mine,"* not *"I'm filling out a setup form."*

Three words: **warm, minimal, continuous.**

- **Warm** — our mascot **Lumen** is a host, not a logo. Plain, kind language. It greets you by
  name and stays with you the whole way.
- **Minimal** — one idea per screen. Lots of quiet space. Nothing on screen that the moment
  doesn't need.
- **Continuous** — every screen lives in the *same frame*. The content changes; the stage
  around it does not. You should never feel the window "jump."

The current build nails the opening two screens and then loses the thread. Your job is to make
all ten screens feel like they were drawn by the same hand on the same canvas.

---

## 2. The two problems to fix (with the cause)

### Problem A — the page resizes and content gets clipped

What the user sees: on the "Help Daylens read your day" screen the title is cut off at the
top and the last section runs off the bottom; finishing the intro slides makes "everything
become huge" and the proportions change.

Cause: the card is a **fixed width but free height**. It has no maximum height and no internal
scroll, so its height becomes whatever the screen's content happens to be. Short screens
(greeting) render a small centered card; tall screens (personalize) grow past the window and
get clipped — there's nowhere for the overflow to go. Between a short and a tall screen, the
whole card visibly changes size.

The fix is structural, not cosmetic: **a fixed stage frame that never changes size, with the
content scrolling *inside* it.** Detailed in §3.

### Problem B — the opening feels disconnected from the rest

What the user feels: the first slides (greeting, the "why" story) feel like a warm story; from
the permission step onward it feels like a different, colder product — a settings form.

Cause: the opening screens are centered, with a large mascot, a large title, and generous
space. The middle and back screens are left-aligned form headers with dense rows of chips and
**no mascot**. Different alignment, different type scale, different rhythm, and the host
disappears halfway through. It reads as two designs taped together.

The fix: **one layout system for all ten screens** — same header zone, same type scale, same
alignment logic, Lumen present throughout. Detailed in §4 and §5.

### The full issue inventory

Problems A and B are the two structural ones. Below is **everything else** worth fixing,
caught reviewing each screen on a real machine. Severity: **P1** = breaks or looks broken,
**P2** = feels off / cheap, **P3** = polish. Fixing A and B resolves several of these; the
rest are their own decisions.

**Personalize screen (the one in the screenshot — the worst offender):**

- **(P1) The same app list appears twice.** "Which apps count as real work for you?" and
  "Anything Daylens should never track?" render the *identical* set of app chips. It's
  confusing (why am I picking from the same list twice?) and it roughly doubles the screen's
  height — half the reason it overflows. Rethink this: e.g. one app list where each app can be
  marked *focus* / *normal* / *private*, or make "never track" a small "+ add an app to keep
  private" affordance instead of repeating the whole list.
- **(P1) Four sections stacked on one screen.** Categories, focus apps, "why are you here?" +
  a textarea, and keep-private — all at once. It's the opposite of "one idea per screen" and
  is the tall screen that breaks the frame. Decide: condense to the essentials on one calm
  screen, or split into two short ones. Don't just shrink it.
- **(P2) Sections are cramped.** Labels sit right on top of the chips above them; the groups
  don't breathe, so it reads as a wall of buttons.
- **(P3) Seeded apps can skew technical.** The chips come from the user's real top apps, so a
  developer sees Ghostty/Codex/Cursor and a writer sees Word/Docs — that's correct and good.
  Just make sure the design looks intentional with 3 apps *and* with 12.

**"Why" story screen:**

- **(P2) It isn't storytelling yet — it's an FAQ.** Three flat gray boxes of left-aligned text.
  The copy is warm but the layout is a list. This is the emotional "why am I installing this?"
  beat; it should *feel* like a story (one thought at a time, an illustration or Lumen acting
  it out, a little motion), not three stacked paragraphs.

**Mascot (Lumen):**

- **(P2) Reads as a placeholder, not a character.** Small, sitting inside a plain white rounded
  square that looks like a default macOS app-icon placeholder. Lumen needs to feel
  *hand-made and alive* — a real little character with personality, not an app glyph in a box.
- **(P2) Disappears for most of the flow.** Present on greeting/why/ready, absent on permission/
  proof/tour/voice/personalize. Part of Problem B; calling it out so it's explicit on the
  shot list: Lumen on **every** screen.

**The stage in the window:**

- **(P2) The card floats in a large dark void.** In the default 1100×720 window the light card
  is small and centered with wide empty margins, which both wastes the space and exaggerates
  the size-jump between short and tall screens. Decide how the stage uses the window — fill it
  more confidently, or make the surround a deliberate, designed backdrop rather than dead space.

**Progress / orientation:**

- **(P3) Progress is a row of tiny dots, top-right.** Easy to miss, and gives no sense of how
  far along you are or how much is left. Consider a clearer, friendlier progress treatment so
  the user always knows the end is near.

**Consistency of "pick from chips" moments:**

- **(P3) Several different chip/card treatments.** Intent chips, category chips, app chips, and
  the voice cards are all "choose from these," but don't share one selected/hover/spacing
  language yet. Unify (see §4).

If anything here conflicts with the built copy or step order, the copy/steps win — but every
*visual* and *layout* issue above is fair game.

---

## 3. The frame — one stage, every screen

Design a single **stage** that is identical on every screen. Only the content area inside it
ever changes. This is the heart of the fix.

```
┌──────────────────────────────────────────────┐  ← the stage: fixed size,
│  ◀ Back              ● ● ● ○ ○ ○ ○            │     centered in the window,
│                                               │     never changes between screens
│  ┌─ header zone (fixed) ───────────────────┐ │
│  │  Lumen          Title                    │ │  ← same vertical position
│  │                 Subtitle                 │ │     on every screen
│  └──────────────────────────────────────────┘ │
│  ┌─ content zone (scrolls if it overflows) ─┐ │
│  │                                          │ │  ← the ONLY part that changes;
│  │   …screen-specific content…              │ │     scrolls internally when tall,
│  │                                          │ │     never pushes the frame
│  └──────────────────────────────────────────┘ │
│  ┌─ footer zone (fixed, always visible) ────┐ │
│  │   [ Primary action ]      Skip           │ │  ← pinned; never scrolls away
│  └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

Rules for the stage:

- **Fixed size.** The stage has a set width and a set height and keeps them on every screen.
  Pick one comfortable size that fits the smallest supported window (the app window is 1100×720
  by default and can shrink to **820×580** — the stage must fully fit, with its footer visible,
  at 820×580). Recommended starting point: a stage around **560–620 wide**, height filling the
  available window minus a comfortable margin, capped so it never exceeds the window.
- **The content zone scrolls, the frame doesn't.** When a screen's content is taller than the
  content zone (personalize is the tall one), it scrolls *inside* that zone. The header, the
  progress, and the footer stay put. The card never grows past the window and never clips.
- **The footer is always visible.** The primary button and Skip are pinned to the bottom of the
  stage, never inside the scroll. The user can always act without scrolling to find the button.
- **Scroll should be quiet.** A soft top/bottom fade on the content zone to hint "there's more,"
  rather than a hard scrollbar. No visible jump when a screen happens to fit without scrolling.

If you do only one thing from this brief, do this. It fixes Problem A completely.

---

## 4. The visual system — so every screen feels the same

One set of decisions, applied everywhere. This is what fixes Problem B.

**Type scale** — pick **one** title size and use it on every screen (the build currently uses
40px on the opening screens and 30px on the rest — collapse to one). Suggest: one Title, one
Subtitle, one Body, one Label, one Caption. Nothing else.

**Alignment** — choose one and hold it. Recommendation: **header left-aligned on every screen**
(title + subtitle sit in the same spot each time), with Lumen as a small fixed companion beside
or above the title. The pure-center treatment should be reserved for at most the very first
greeting and the final "all set" — and even then, the header *zone* stays in the same place so
the transition doesn't lurch.

**Lumen is present throughout.** Today the mascot appears on greeting/why/ready and vanishes in
between. Give Lumen a small, persistent home in the header zone on *every* screen, with a few
gentle expressions that match the moment (waving hello, watching during the proof step, a small
nod on success). Small and calm — a companion, not a cartoon.

**One component language.** The chips, cards, inputs, and buttons should look like one family:

- **Chips** (categories, apps, intents) — one chip style, one selected state, one hover. The
  three chip groups on the personalize screen must look identical in size and spacing.
- **Selection cards** (the voice picker) — one card style shared with any other "pick one of
  these" moment.
- **Inputs** — the name field, the intent textarea — one input style.
- **Buttons** — one primary, one quiet/secondary, one barely-there Skip (low contrast, small;
  present so nobody's trapped, but never competing with the primary action).

**Rhythm.** One spacing unit, used for the gaps between sections, so a dense screen and an airy
screen still feel related. Sections on the personalize screen need clear breathing room between
groups (right now they're cramped).

**The card is light, the surround is dark.** Onboarding pins a dark backdrop with a light card
on purpose (so embedded pieces never render light-on-dark). Keep that. Lean into the existing
aurora-gradient header accent as the one recurring flourish.

---

## 5. Screen by screen — the intent (not the pixels)

Same frame for all. This is the *feeling* each content zone should carry.

1. **Greeting** — the warmest moment. Lumen waves. "Hi {name} 👋." One name field
   (placeholder is the person's computer name). Spacious, inviting. One button.
2. **Why** — the short story: *why let an app watch my laptop?* Three calm beats (private to
   this device · no screenshots/video · you get an honest recap). Should feel like reassurance,
   not a feature list. Quiet Skip.
3. **Grant access** — one ask: Accessibility. Plain, trustworthy, with a clear "open settings"
   action and an honest live status. Never a dead end.
4. **First signal (proof)** — the trust moment: real captured activity from *their* machine,
   shown the Daylens way. Lumen "watching." This must feel earned and true — never a fake demo.
5. **Narrated day (tour)** — one relatable everyday day told back beautifully (apps merge into
   one block, a quick detour is absorbed, the day resolves into two clean blocks, a recap, a
   weekly wrap). Advance with a clear control; small Skip. No "tap anywhere."
6. **Pick your voice** — three sample recaps of the same day (Straight · Warm · Witty). The
   choice should feel consequential and fun — it really does change how recaps read. One card
   style, clearly selectable, default Warm.
7. **Make it yours (personalize)** — *this is the screen in the screenshot that breaks.* Light
   personalization: categories you care about · which apps are "real work" · why you're here ·
   apps to keep fully private. It is intentionally the longest screen — so it is the screen the
   scroll-inside-the-frame rule exists for. Give the groups real breathing room; never let the
   title clip or the footer disappear.
8. **AI setup** — optional, clearly separate, easy to skip. Capture works without it.
9. **Ready** — the soft landing. "You're all set, {name}." Show a sample recap in *their* chosen
   voice so the personalization pays off visibly. Lumen happy. One button into the app.

---

## 6. Motion

Calm and continuous — motion should reinforce "one stage, changing content," never "new page."

- **Between screens:** the frame holds still; the content zone cross-fades / slides a few pixels.
  No full-card resize, no whole-window transition.
- **Within a screen:** gentle entrance for the content (a soft stagger is fine), and small,
  satisfying feedback on selection (chips, voice cards).
- **Lumen:** small idle motion (a slow blink/bob) and a matching expression per moment.
- **Respect reduced-motion:** everything must be calm-or-still when the OS asks for less motion.

---

## 7. Constraints (don't design these away)

These come from how the product actually works — they're not negotiable.

- **Fits 820×580.** The stage, including a visible footer, must fully fit the smallest window.
- **Proof is real.** The first-signal screen shows the user's actual captured activity, never a
  canned mockup. Design it to look good with real, slightly messy data.
- **Permission is Accessibility only.** Don't reintroduce a Screen-Recording ask — capture
  doesn't use it, and asking traps people.
- **The voice choice is real output.** The picker drives actual recap wording; the samples must
  honestly represent the three voices.
- **Light card on dark surround, always.** Onboarding ignores the app's light/dark theme on
  purpose.
- **Skip is present but quiet** on the optional steps (why, tour, AI). Nobody is trapped; nobody
  is nudged to bail either.

---

## 8. Done when…

A designer can consider this finished when:

- [ ] The stage is the **same size on every screen**; nothing resizes when you move between
      steps, at any window size down to 820×580.
- [ ] The tall screen (personalize) **scrolls inside the frame**; its title never clips and the
      footer button is always visible.
- [ ] **Personalize no longer repeats the same app list twice**, and no longer crams four
      sections — it's condensed or split into calm, breathing groups.
- [ ] The **"why" screen feels like a story** (one thought at a time, illustrated/animated),
      not three stacked FAQ boxes.
- [ ] **Lumen looks like a character**, not an app-icon placeholder, and is **present on every
      screen** with expressions that fit the moment.
- [ ] All ten screens share **one type scale, one alignment, one chip/card/input/button
      language, one spacing rhythm.**
- [ ] The **stage uses the window well** — no small card floating in dead dark space — and
      progress reads clearly.
- [ ] The front (greeting/why) and the back (voice/personalize/ready) feel like **one
      continuous piece**, not two designs.
- [ ] Transitions are calm — content changes inside a still frame; reduced-motion is respected.
- [ ] Every **P1/P2 item in the §2 issue inventory** is resolved.
- [ ] It still obeys every rule in [`onboarding.md`](onboarding.md) §7 (real proof, honest
      permissions, AI optional, never bluffs).
