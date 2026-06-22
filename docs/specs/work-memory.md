# Work memory — build spec

## 1. What work memory is

A short, readable description of **what Daylens knows about you** — the context that makes its
naming, categories, and answers feel like they're about *your* work, not a stranger's. Think
of it exactly like **ChatGPT's memory**: a handful of plain-language facts you can read, edit
by hand, and delete. Not a black box.

> You're a solo founder building Daylens, a macOS activity tracker. You spend most of your day
> in Cursor, Warp, and Codex on development, and in Zen browsing docs and GitHub. "Ubiquiti"
> and "UniFi" mean your network-admin work, not shopping. Malaria-notebook work is a school
> assignment. You treat YouTube and X as background, not focus.

That paragraph is the whole feature. It is small, it is yours, and it visibly shapes what the
AI says.

## 2. What's broken now and how it should work

Today work memory is the opposite of this:

- **It's opaque "patterns," not readable context.** 19 rows, every one tagged "browsing" at an
  identical 65% confidence — including Teams, Claude, the malaria report, and Apple Dev Docs.
  It tells you nothing and it's clearly wrong.
- **You can't edit it.** There's no way to fix a wrong memory or add a true one by hand. You
  can only "forget" the whole thing.
- **It doesn't visibly do anything.** Rebuild and consolidate run, but you can't see what
  changed or whether the AI got smarter.
- **It learns garbage.** "Everything is browsing at 65%" is not memory; it's noise dressed up
  as confidence.

The fix is to throw out the pattern-table model and build the editable-profile model above.

## 3. How it works

### 3.1 It's a profile, assembled and editable

Daylens drafts the profile from **real evidence** — the apps and sites you actually use, the
threads that recur, the corrections you've made. It's written in plain sentences, grouped into
a few simple facts (who you are, what you work on, what your tools mean, what's background).
It uses everyday words and explains any technical term it keeps, so the profile makes sense
without knowing how Daylens stores or categorizes activity.

You can **edit any of it by hand**: rewrite a sentence, add a fact Daylens couldn't infer
("Acme is my biggest client"), or delete one that's wrong. Your edits are **corrections** and
they win — a rebuild never overwrites a fact you wrote or deleted (same rule as block
corrections, `timeline.md` §3.5; `PRODUCT.md` rule 3).

### 3.2 It actually shapes the AI

The profile is handed to the model as context on every AI surface (naming, recaps, chat,
wraps). That's what makes the AI's voice feel like it knows you — "your network-admin work,"
not "the Ubiquiti website." If editing a fact doesn't change how the AI talks, the feature is
broken.

It is **context, never fact-of-record.** The profile colors interpretation; it never invents
activity. The AI still narrates only the real evidence the resolver returns (`ai.md` §4) — the
memory helps it *read* that evidence the way you would.

### 3.3 Rebuild and forget report what they did

- **Rebuild** re-drafts the profile from current evidence (keeping your hand edits) and tells
  you what changed in one line — "added: you've shifted to network work this week," not a
  silent refresh.
- **Forget** clears a fact (or all of them) and says so. A forgotten fact stays gone until
  re-learned; if you forgot it on purpose, a rebuild doesn't drag it back.

### 3.4 No confidence theater

No "65%" badges on everything. If a fact isn't solid enough to state, Daylens doesn't invent a
number for it — it either states the fact plainly or leaves it out (the admit-uncertainty
rule, `PRODUCT.md`). Confidence is not a feature; a true, readable profile is.

## 4. Good vs bad — the contrast

| Bad (today) | Good (the bar) |
| --- | --- |
| `browsing — 65%` ×19, every app the same | "You spend most of your day in Cursor and Warp on development." |
| Opaque rows you can't read or edit | A paragraph you can read in 10 seconds and edit inline |
| "Forget all" is the only control | Edit a sentence, add a fact, delete one — by hand |
| Rebuild changes nothing visible | "Rebuilt: added that Ubiquiti = your network work" |
| Confidence numbers on noise | Plain facts; nothing stated that isn't supported |

## 5. Invariants (rules this view must always obey)

1. Work memory is a short, human-readable profile — never an opaque table of patterns.
2. The user can edit and delete any fact by hand; a hand-edited or deleted fact is a
   correction and survives every rebuild.
3. The profile is handed to every AI surface as context, so editing it visibly changes how the
   AI talks.
4. Memory is context, never fact-of-record: it shapes interpretation and never invents
   activity the evidence doesn't show.
5. Rebuild and forget each report what changed in plain language; nothing happens silently.
6. No confidence badges on unsupported facts — a fact is stated plainly or left out.
