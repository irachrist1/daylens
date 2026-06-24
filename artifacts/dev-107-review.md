## DEV-107 — Memory v2: ready for test

**Status:** Built on `main` (per Tonny's instruction). typecheck clean, lint 0 errors, `npm test` green (725 pass, 0 fail, including 9 new memory-v2 tests). Not setting Done — that's yours.

---

### What changed for you

You can now **steer Daylens's memory by talking to it**, not by opening Settings and typing in a box:

- In the AI chat, say **"remember that Acme is my biggest client"**, **"forget that I use Notion"**, or **"actually I work in Digital Operations, not engineering"** — Daylens updates its own memory and confirms in one line ("I'll remember that… You can see and edit this any time in Settings → Memory.").
- After a day or range answer, Daylens may **offer** to remember one thing it noticed ("By the way — you spend most of your day in Cursor and Warp. Want me to remember that?"). It only asks once per conversation, and only saves if you say yes.
- **Settings → Memory** now shows a **"Recent changes"** audit at the bottom — a short list of what was remembered, updated, or forgotten, and whether it came from chat or by hand. Facts remembered from chat are marked **"Remembered from chat"**; hand-edited facts show **"Edited by you"**.
- Everything memory holds is still visible, editable, and forgettable by hand. A hand edit or delete still wins and survives every rebuild (the DEV-92 durability rule — kept, not broken).
- Memory is still **context, never fact-of-record**: it colors how Daylens reads your real activity; the hours always come from tracked evidence.

**Scope note:** This issue ships *general* memory (grow by talking + audit + Manage-memory view). Per-client memory is DEV-108 (the Clients issue), which builds on the `scope` column this issue adds.

### What to test

1. **Tell it to remember.** Open the AI chat, type `remember that I prefer dark mode for late-night coding` (or any durable fact about you). You should see a one-line confirmation. Then open **Settings → Memory** → expand "View and manage memory" — the fact should be there, marked "Remembered from chat", and the "Recent changes" audit should list it.
2. **Tell it to forget.** In chat, type `forget that I prefer dark mode for late-night coding`. The fact should disappear from the list, and the audit should show "Forgot".
3. **Correct it.** Type `actually I work in Digital Operations, not engineering` (after telling it you work in engineering). The fact should update, not duplicate.
4. **The proposal.** Ask "what did I do today?" — after the answer, you may see a "By the way — … Want me to remember that?" line. Say "remember that" and confirm it lands in memory. (This only fires if there's a drafted pattern you haven't stored or forgotten, so it may not always appear — that's intentional.)
5. **The audit.** After a few remember/forget actions, check Settings → Memory → "Recent changes" shows the history.
6. **Editing memory changes the answer.** Tell it "remember that Ubiquiti is my network infrastructure client", then ask "how much time on Ubiquiti this week?" — the answer should read as someone who knows what Ubiquiti means to you (though the hours still come from tracked evidence).

### Evidence

- **typecheck:** clean. **lint:** 0 errors. **npm test:** 725 pass, 0 fail, 1 skip (9 new tests in `tests/memoryV2.test.ts` covering the detector, the extract→update parser, and the apply/audit/tombstone path).
- **Drove the app** (`npm start`): the v37 migration applied cleanly, Settings → Memory loaded with the existing fact showing "Edited by you", adding a fact by hand produced a "Recent changes" → "Remembered" audit entry, and the provenance marker rendered correctly.
- **Couldn't fully verify the chat write path** ("remember that…") in the running app because there's no AI provider key configured in this environment — the extractor needs a model call to turn your instruction into memory ops. The path is tested in the unit suite (detector + parser + apply), and it degrades safely: if the model call fails, it returns no ops and the normal answer path runs untouched. **This is the one thing to test by hand with a provider connected.**
- **Couldn't attach screenshots** — GitHub issues don't accept image uploads via the API, and an external process was actively modifying the renderer during this run (billing WIP), which caused a transient ErrorBoundary on the last restart. The Memory UI was verified live via DOM inspection before that: the fact list, provenance markers, and audit section all rendered correctly.
