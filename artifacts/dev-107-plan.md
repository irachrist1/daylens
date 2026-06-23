## Memory v2 — plan (for confirm, not built yet)

**The one decision for you:** I want to ship DEV-107 as *general* memory you grow by talking —
"remember…", "forget…", "actually it's X not Y" — plus a clean Manage-memory view. **Per-client
memory stays in DEV-108 (the Clients issue, #103), which is built to sit on top of this.** Confirm
that split and I'll build.

### What changes for you

- In the AI chat you can say **"remember that Acme is my biggest client"**, **"forget that I use
  Notion"**, or **"actually I work in Digital Operations, not engineering"** — and Daylens updates
  its own memory, then tells you in one line what it saved. No opening Settings to type in a box.
- Daylens will sometimes **offer** to remember something it noticed ("your mornings are mostly the
  Ubiquiti work — want me to remember that?"), and only saves if you say yes.
- A redesigned **Manage memory** page (Settings → Memory) shows everything as plain sentences in
  sections, lets you edit or delete any fact by hand, forget everything, and see a short list of
  what was remembered/edited/forgotten. Editing or deleting wins and survives forever.
- The next answer visibly uses what you changed — that's the whole test.

### How it builds on what we shipped (DEV-92)

DEV-92 already gave us the durable plumbing: each fact has an identity, a hand-edit flips it to a
"you wrote this" correction a rebuild never overwrites, deletes leave a tombstone so forgotten
things stay gone, and memory already feeds the AI prompt. **I keep all of that and extend it** —
the new part is growing memory *through conversation* and organizing it into scopes.

### How it works (the pattern, not invented)

- **ChatGPT's split** — explicit "saved memories" (what you told it, auditable) vs background
  proposals. That's our model: a tell-it path + an optional propose path.
- **mem0's extract→update loop** (ADD / UPDATE / DELETE / NOOP) is exactly "tell it and it
  remembers" — a small model step pulls the fact from your message and decides whether to add,
  change, or remove a memory.
- **Letta/MemGPT tiering** — general memory always in the prompt (core), client memory pulled in
  only when relevant (archival). DEV-107 lays this foundation; DEV-108 fills the client side.
- I read OpenAI's **June 2026 "dreaming"** writeup: background synthesis that keeps memory fresh
  and current (revising stale facts as time passes). I'm **not** building a background dreamer in
  this issue — that's a bigger, compute-heavy system. The "propose what it noticed" offer is the
  small, honest, on-demand version that fits Daylens today; full background curation can be a later
  issue if you want it.

### The one architectural note

This is the first time the AI **does something** (writes a memory) instead of only answering. The
chat today is read-only (plan → fetch → phrase). I'll add a small "is this a memory instruction?"
step in front of that: if yes, extract + write + confirm; if no, the normal answer path runs
untouched. This doesn't break the resolver-first rule (that was about *reading* data to answer).

### Guardrails I won't cross

Memory is **context, never fact-of-record** — it colors how Daylens reads your real activity, it
never invents hours; the numbers always come from tracked evidence. Everything stays visible,
editable, auditable. No opaque rows, no confidence badges. Forgotten-on-purpose stays gone.

### One flag

I could only read this issue's body via the GitHub mirror (#104); the Linear **pinned comment**
didn't come through. If it has anything beyond the spec, paste it and I'll fold it in.

---

**Ask:** Confirm (1) the DEV-107 = general memory now / clients in DEV-108 split, and (2) that
including the lightweight "want me to remember that?" proposal is in-scope here. Then I'll build.
