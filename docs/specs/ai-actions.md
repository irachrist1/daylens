# AI actions & widgets — build spec

*The AI chat stops being only a place that answers and becomes a place that acts. You tell
Daylens to change something — a block, your memory, a client — and it does it, showing you an
interactive widget inline so you see and confirm the change instead of reading prose about it.*

## 1. What this is

Today the AI tab answers questions (`ai.md`). This adds the other half: **the AI can change
things, on your instruction, and render the right little interface for each change.** "Merge
these two blocks." "Rename this to networking." "Remember Acme is my biggest client." "Attribute
yesterday afternoon to Acme." It performs the action and a widget appears in the chat — a block
card with the rename ready to confirm, a memory card showing what it saved — so the change is
visible and reversible before it sticks.

The reference feel is **Claude Artifacts** and **ChatGPT Canvas**: the model produces a live,
interactive surface beside the conversation, not just text. The right widget for the right
action, every time.

## 2. The one architecture rule (so this isn't misread)

This does **not** undo ADR 0002. Reading stays resolver-first — the model never fetches its own
facts to answer a question. What's new here is a separate, explicit set of **action tools**
(rename block, merge blocks, write memory, attribute to client…) and a way to **render a UI
component** for each. Reading = resolvers. Acting = action tools + widgets. Two different things;
both honest.

## 3. How an action works — preview, then confirm

Every action follows the same shape, and the shape is the safety:

1. **You say it.** Plain language in chat: "merge these," "rename to X," "remember Y."
2. **The AI proposes the action and renders its widget.** Not done yet — *previewed.* The block
   widget shows the rename; the merge widget shows the two blocks becoming one; the memory card
   shows the fact it would save. Nothing has changed in your data yet.
3. **You confirm (or tweak, or cancel) in the widget.** Only on confirm does the action commit.
4. **It takes effect everywhere** — the same correction pipeline as a manual edit, so it
   survives rebuilds and propagates to every view (`timeline.md` corrections, `memory.md`).

**Never silent mutation.** The AI never changes your day or your memory without showing you the
change first and getting a confirm. A reversible, visible preview is the whole point — it's what
makes handing the AI this power safe.

## 4. Widgets reuse what already exists

Each action renders a real Daylens component, not a reinvented one. The block-edit widget is the
timeline block component. The memory widget is the Manage-memory card (`memory.md`). The client
widget is the client view. This keeps it consistent, fast, and maintainable — one source of
truth for each surface, whether you reach it by clicking or by telling the AI.

## 5. What's in scope to start

Begin with the actions we already have manual equivalents for, so the AI is just a new way to do
a known-safe thing:

- **Block edits** — rename, merge, attribute to client, mark a detour (mirrors `timeline.md`).
- **Memory edits** — remember / forget / correct a fact (mirrors `memory.md`, DEV-107).
- **Client edits** — create a client, add a fact to its scope (DEV-108).

Anything that has no manual equivalent, or that deletes data, gets a stronger confirm and is
considered carefully before it's added.

## 6. This needs research before building

This is a genuinely new pattern for the app — study how it's done before proposing an approach:

- **Claude Artifacts** — model output as a live interactive panel beside the chat.
- **ChatGPT Canvas** — an editable working surface both the model and user edit.
- **Generative UI / Vercel AI SDK** — tool calls that stream and render real components inline
  (the closest technical pattern to "AI renders a widget"). Search "Vercel AI SDK generative UI"
  / "AI SDK tool rendering".

The hard questions to answer in the plan: how an action tool maps to a widget; how preview →
confirm is modeled cleanly; how widgets reuse existing components; how it stays fast and can't
mutate data without consent.

## 7. Invariants (rules this must always obey)

1. The AI only changes data on an explicit instruction, and always previews the change in a
   widget before it commits — never a silent mutation.
2. Reading stays resolver-first (ADR 0002); this adds action tools and widget rendering, it does
   not let the model fetch its own facts.
3. Every action goes through the same correction pipeline as a manual edit — it survives rebuilds
   and propagates to every view.
4. Widgets reuse the real Daylens components, not reinvented ones.
5. Every AI action has a manual equivalent the user could do by hand; the AI is a faster path to
   a known-safe change, never a new way to do something unreviewable.
6. Anything destructive needs a stronger, explicit confirm.
