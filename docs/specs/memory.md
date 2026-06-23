# Memory — build spec

*Supersedes `work-memory.md`. The old spec described an editable paragraph you maintain by
hand; this is the real thing — memory Daylens builds and manages, that you steer through
conversation. It also absorbs clients: a client is just memory with a scope.*

## 1. What memory is

Memory is everything Daylens knows about you and your work, so its answers feel like they come
from someone who actually knows you — not a stranger reading your activity for the first time.
The bar is **how Claude's memory works**: you can tell it something in plain conversation and
it remembers going forward, it organizes what it knows into readable sections, and you can open
a "Manage memory" view to see, edit, or forget any of it. The AI does the bookkeeping; you
steer.

This replaces what we have now — a single paragraph you edit by hand in Settings. That was a
step up from the old opaque "65% patterns," but it still made *you* do the writing. Memory
should write itself from what you tell it and what it observes, and let you correct it.

## 2. The two things that are new

### 2.1 You tell it, it remembers

The main way memory grows is **conversation.** In the AI chat you say "remember that Acme is my
biggest client" or "I work in Digital Operations at Andersen" — and Daylens captures that into
memory itself. You're not opening Settings and typing into a box; you're talking, and the
assistant updates its own memory the way Claude does. It can also propose remembering something
it noticed ("Looks like you spend most mornings on the Ubiquiti work — want me to remember
that?") rather than silently absorbing everything.

Everything memory writes is still a **fact you can see and undo** — nothing is hidden. A thing
it remembered from a conversation is marked as such, and you can correct or delete it (§3).

### 2.2 Memory has scopes — and clients are one

Memory isn't one flat blob. It's organized, the way Claude splits **Work context** and
**Personal context** — and, crucially, **projects and clients have their own separate
memory.** That line in Claude's manage-memory screen — *"does not include projects, which have
their own specific memory"* — is the whole idea behind Daylens clients.

So there are two kinds of memory:

- **General memory** — who you are, how you work, your tools, your style. Always in play.
- **Scoped memory** — everything tied to one **client or project.** What Acme is, where their
  files live, what you've done for them, their deadlines, the people involved. This memory only
  comes into play when the question is about that client.

A **client** in Daylens is exactly this: a named scope with its own memory. When you ask "how's
the Acme work going" or "how much time on Acme this week," Daylens pulls Acme's scoped memory
*plus* the real tracked activity attributed to it. That's what makes it feel like an assistant
who's actually on top of your accounts, not just a timer.

## 3. Managing memory

A clean "Manage memory" view (in the redesigned, sectioned Settings — `billing.md` §6, same
Claude-settings bar) where you can read and steer everything:

- **See it, organized.** General memory in its sections (work, personal, …), and each client's
  memory under that client. Plain, readable sentences — never opaque rows or confidence
  badges.
- **Edit any fact by hand.** Rewrite a sentence, add one Daylens couldn't infer, delete one
  that's wrong. A hand edit is a **correction** and it wins — a rebuild never overwrites or
  resurrects a fact you wrote or deleted (the correction rule, `PRODUCT.md`; same durability
  the shipped work-memory already has — keep its `topic_key` tombstone behavior).
- **Forget.** Drop a single fact, a whole client, or everything. Forgotten-on-purpose stays
  gone.
- **A short audit.** Like Claude's "manage edits" — you can see what was remembered, edited, or
  forgotten, so memory never feels like it's changing behind your back.

**Visual bar (the first build looked like a debug dump — don't repeat it).** Match Claude's
Capabilities/Memory panel: [`docs/research/settings-references/ref-claude-capabilities-memory.png`](../research/settings-references/ref-claude-capabilities-memory.png).
The Memory *settings page* opens calm — a couple of clean toggle rows (each a bold title + a
muted one-line description, control right-aligned) and a **prominent full-width
"View and manage memory · Updated <relative time>" row with a chevron** that opens the
auditable view above. The auditable view itself reads as plain organized sentences in
sections, not a stack of bordered textareas with Save/Forget buttons on every line. Trustworthy,
spacious, "set and forget" — see `settings.md` §10.4.

## 4. How memory shapes the AI

Memory is handed to the model as **context** on every surface (chat, recaps, wraps, naming) —
general memory always, the relevant client's scoped memory when the question is about that
client. That's what makes editing memory visibly change how Daylens talks. If changing a fact
doesn't change the answers, memory is broken.

It is **context, never fact-of-record.** Memory colors how Daylens *reads* your real activity;
it never invents activity that the evidence doesn't show. The resolver still hands the model
only the real facts for the question (`ai.md` §4) — memory helps it read those facts the way
you would. "Ubiquiti" means your network work because memory says so; the *hours* still come
from the tracked evidence, never from memory.

## 5. What carries over from the shipped work-memory

We shipped real durability in DEV-92 — don't throw it away, build on it:

- `topic_key` identity, the drafted-vs-user origin flip on a hand edit, tombstones so
  forgotten things stay gone, and memory already feeding the AI prompt. Keep all of that.
- What changes: memory is now grown mainly through **conversation** (not a Settings textbox),
  it's **organized into scopes** (general + per-client), and the management view matches the
  Claude-style "see / edit / forget" experience. The plumbing underneath is the same idea,
  extended.

## 6. Invariants (rules this must always obey)

1. You can grow memory by telling Daylens in conversation; the assistant writes to its own
   memory — you don't have to open Settings to do it.
2. Every fact memory holds is visible and editable; a hand-edited or deleted fact is a
   correction that wins and survives every rebuild.
3. Memory is organized — general context plus separate per-client scopes. A client is a named
   memory scope.
4. Client questions pull that client's scoped memory plus the real tracked activity attributed
   to it.
5. Memory is context, never fact-of-record: it shapes interpretation and never invents activity
   the evidence doesn't show.
6. Editing or forgetting memory visibly changes what the AI says next.
7. No opaque rows, no confidence theater — plain, readable facts, with a short audit of changes.
8. Forgotten-on-purpose stays gone; nothing silently resurrects.
