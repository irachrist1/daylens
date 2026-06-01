# Daylens AI Tab — V3 Device Feedback (2026-06-01)

**Context.** The AI tab V2 stack (D1 sidebar, D3 ⌘K palette, D4 per-chat settings,
D5 composer, D6 transforms, S1 natural search, M1 model catalog, T3 tracking
controls — see `docs/AI-TAB-V2-SPEC.md`) was built and tested on-device. Real
progress, genuinely good for a v1. This doc is the **fix list** from that test pass.
Every item is a concrete defect or polish with what's wrong, what right looks like,
acceptance criteria, and file pointers.

**How to work this (owner instruction):**
- **Work directly on `main`.** No long-lived feature branch. Commit to main, push to
  main. If you open a PR for CI, merge it the same session — do not leave a branch.
- **Precondition (already satisfied):** the V2 stack (PRs #23–#33) is merged to
  `main` and its branches are cleaned up. All the components referenced below
  (`ConversationSidebar`, `ChatActionPalette`, `naturalSearch`, etc.) are on `main`.
  Build on `main` directly.
- Follow `docs/AI-PRODUCT-DIRECTION.md` and `docs/CLAUDE.md`. Start from code, not
  prose. Don't regress `docs/AI-TAB-V2-SPEC.md` §2 "DO NOT REGRESS".
- Screenshots for this round are saved on the owner's **Desktop** (filenames noted
  per item); Appendix A also describes each so you don't strictly need them.
- After changes: `npm run typecheck`, `npm run test:ai-chat`, `npm run build:all`
  all green before merging.

---

## The big themes
1. **One command surface, not three.** There is now a global ⌘K palette, a new
   header ⌘K button, AND a wide top search bar. Collapse to a single ⌘K. (FB1, FB2)
2. **Declutter the header.** Remove the duplicate new-chat button and the inline
   search bar; make the model subline actually do something. (FB2, FB3, FB8)
3. **Make the AI actually generate.** "Turn into…" and the report are producing
   static/empty text instead of real grounded output. (FB7)
4. **Quality still off.** Follow-ups and auto-titles are still weak. (FB6, FB10)

---

## FB1 — Consolidate to ONE ⌘K command palette (keep the original)
- **Severity:** P0 · **Area:** renderer
- **Symptom:** ⌘K behavior is now duplicated/confused — pressing it does the wrong
  thing (opened another tab/surface), and there are effectively two command surfaces:
  the original global palette and the newly added D3 in-chat palette + header ⌘K
  button.
- **What's right:** Exactly **one** ⌘K, and it is the **original global command
  palette** (`src/renderer/components/CommandPalette.tsx`, toggled in `App.tsx`). Keep
  that one. The D3 chat-action accelerators (regen, copy, rate, regen-on-other-model)
  should live inside that single palette (contextual section when a message is
  focused), not as a separate competing palette. ⌘K from anywhere opens this one
  palette and never creates a tab/chat.
- **Acceptance:**
  - [ ] Pressing ⌘K anywhere in the app opens the one global palette, never a new
        chat/tab.
  - [ ] There is no second/duplicate palette component mounted.
  - [ ] The D3 message actions are reachable from that palette when a message is
        focused.
- **Pointers:** `App.tsx` (⌘K handler), `components/CommandPalette.tsx`,
  `views/insights/ChatActionPalette.tsx` (fold in / remove), `AIWorkspace.tsx`
  (header ⌘K button).
- **Screens:** header with ⌘K button + search + theme + new-chat.

## FB2 — Move search INTO ⌘K; remove the top search bar; fine-tune it
- **Severity:** P0 · **Area:** renderer + search
- **Symptom:** The wide "Search history — or ask in plain language" bar in the header
  "looks horrible," takes up space, and is redundant. Its results panel styling is
  rough. The natural-language interpretation is decent but still a little off.
- **What's right:** **Delete the inline header search bar.** Its functionality —
  local history search + the S1 natural-language interpretation — moves **into the ⌘K
  palette** (FB1), which already searches actions and should now also search history
  and accept plain-language queries. Fine-tune the natural-language path (better term
  extraction / ranking; see Appendix examples where "the link for canvas" and "intro
  to ml course deadline" worked but ranking/styling was rough).
- **Acceptance:**
  - [ ] No inline search input in the AI header.
  - [ ] ⌘K palette searches history + accepts natural-language queries, with the
        result cards cleanly styled (not the current rough look).
  - [ ] Short literal queries stay instant (no provider call); long/NL queries use
        the interpreter as in S1.
- **Pointers:** `views/insights/HistorySearch.tsx` (remove from header),
  `naturalSearch.ts`, `searchTerms.ts`, `search:natural` IPC, `CommandPalette.tsx`
  (add history + NL search).
- **Screens:** the "horrible" search bar; "the link for canvas" and "intro to ml
  course deadline" interpreted-search panels.

## FB3 — Remove the duplicate "New chat" button (keep one)
- **Severity:** P1 · **Area:** renderer
- **Symptom:** Two new-chat buttons — one in the sidebar (`Chats`) header and one in
  the top-right app header. No reason for both.
- **What's right:** Keep **one**. Since the sidebar is hidden by default (FB4), keep
  the **top-right header** new-chat button (always reachable) and remove the
  sidebar-header duplicate. Pair it with a tooltip + ⌘N.
- **Acceptance:** [ ] Exactly one new-chat affordance, in the header, working, with
  tooltip + ⌘N.
- **Pointers:** `AIWorkspace.tsx`, `ConversationSidebar.tsx`.

## FB4 — Hide the chats sidebar by default
- **Severity:** P1 · **Area:** renderer
- **Symptom:** The D1 conversation sidebar is open by default and crowds the chat.
- **What's right:** Sidebar **collapsed/hidden by default**; the user opens it with
  the existing toggle (and the state persists per the existing localStorage key). The
  empty-hero and conversation should have full width when it's closed.
- **Acceptance:** [ ] Fresh launch shows the sidebar hidden; toggling opens it;
  choice persists.
- **Pointers:** `ConversationSidebar.tsx`, `AIWorkspace.tsx` (default collapsed
  state).

## FB5 — Recency group headers are invisible (low contrast)
- **Severity:** P1 · **Area:** design
- **Symptom:** In the sidebar, the "TODAY / YESTERDAY / PREVIOUS 7 DAYS" group labels
  are the same color as everything else, so the grouping doesn't read.
- **What's right:** Make group headers visually distinct — stronger weight/size or a
  muted-but-clearly-different treatment (uppercase eyebrow style, more contrast),
  consistent with the app's design tokens. The groups should be obvious at a glance.
- **Acceptance:** [ ] Group headers are clearly distinguishable from chat rows.
- **Pointers:** `ConversationSidebar.tsx`.

## FB6 — Chat titles don't make sense; rename/improve
- **Severity:** P1 · **Area:** title gen
- **Symptom:** Sidebar shows confusing/duplicate titles: multiple "today", "Day report
  2026-05-31", "in detail tell me evrything i did o…", "Time on Video consumption
  and…". Chat threads titled "today" are meaningless; day-report threads and chat
  threads are visually indistinguishable.
- **What's right:** Titles should describe the conversation in 2–5 meaningful words
  (Raycast-style). Don't title a chat "today" just because the first word was today.
  Distinguish auto-generated **Day report** threads from user chats (e.g. an icon or a
  separate group), and don't let raw first-message text become the title verbatim.
- **Acceptance:**
  - [ ] No chat titled with a bare stopword like "today"; titles summarize the topic.
  - [ ] Day-report threads are visually distinct from user chats.
- **Pointers:** `deriveTitleFromMessage` (title logic), `useAIChat.ts`,
  `ConversationSidebar.tsx`. Cross-ref Q5 in `AI-TAB-V2-SPEC.md`.

## FB7 — "Turn into…" must actually generate (it's static); reports are empty
- **Severity:** P0 · **Area:** main / aiService + renderer
- **Symptom:** Clicking "Turn into…" (shorter / checklist / bullets / report) does not
  generate anything real — it emits canned blobs of text. The generated
  "shareable-report" artifact is generic and hollow ("A system day with mixed
  signal", "There was not one clean work stretch strong enough to name confidently"),
  not grounded in the actual conversation/answer.
- **What's right:** Each transform must run a **real model call** that transforms the
  *actual answer/conversation content* into the requested form, grounded in the same
  data — a genuine shorter version, a real checklist, real bullets, a real report with
  the actual numbers from the answer. No static templates. The report artifact must
  contain the real content of the answer it was generated from, not a generic day
  shell.
- **Acceptance:**
  - [ ] "Turn into shorter/checklist/bullets" produces a model-generated transform of
        the specific answer, different each time per content, grounded in its numbers.
  - [ ] "Turn into report" produces a report whose body reflects the real answer
        content, not a generic "system day" stub.
  - [ ] Transforms go through the rate-limiter/retry path (R1) and show errors via the
        branded card (R4).
- **Pointers:** D6 transform module (canned re-prompts today) + `aiService.ts`
  (`sendMessage`/report generation), the report/artifact generation path. Make
  transforms real prompts to the model, not string templates.
- **Screens:** "Turn into…" button; the hollow Day-report artifact opened in a viewer.

## FB8 — Clicking the model subline should open a Raycast-style model selector
- **Severity:** P1 · **Area:** renderer
- **Symptom:** The "Claude · Claude Haiku 4.5" model line under the thread title looks
  clickable but clicking it does nothing.
- **What's right:** Clicking the model subline opens a **model selector** like Raycast
  (Appendix screenshot): a search field, models grouped by provider, and a detail card
  showing speed / intelligence / context / capabilities (Vision, Tool Use, Reasoning).
  Selecting a model sets it (this is the per-chat override from D4 / or global if no
  thread). Pull the list from the M1 catalog (`aiProvider.ts`) so it stays current.
- **Acceptance:**
  - [ ] Clicking the model subline opens a searchable, provider-grouped model picker.
  - [ ] Picking a model applies it (per-chat override, consistent with D4) and the
        subline updates.
  - [ ] The list reflects the real catalog from `aiProvider.ts`.
- **Pointers:** `AIWorkspace.tsx` (model subline), `ThreadSettingsPanel.tsx` (D4
  override), `lib/aiProvider.ts` (catalog + capabilities metadata).
- **Screens:** dead model subline; Raycast model selector reference.

## FB9 — Chat-settings icon is the wrong, low-quality icon
- **Severity:** P2 · **Area:** design
- **Symptom:** The icon that opens the per-chat "Chat settings" modal is the wrong one
  and looks low quality.
- **What's right:** Use a proper, crisp icon (consistent with the lucide/icon set used
  elsewhere, e.g. a sliders/settings glyph) at the right size and stroke weight.
- **Acceptance:** [ ] The chat-settings trigger uses a correct, crisp icon matching the
  app's icon language.
- **Pointers:** `AIWorkspace.tsx` header gear, `views/insights/icons.tsx`,
  `ThreadSettingsPanel.tsx`.
- **Screens:** chat-settings gear; Chat settings modal.

## FB10 — Follow-up suggestions are still bad
- **Severity:** P1 · **Area:** follow-ups
- **Symptom:** Still weak/templated: "How long on Top?", "Which files appeared in
  Coursera?", "Compare Neural Networks across sessions", "How long on Notion?",
  "Compare Intro across sessions", "Draft a short note on Notion". Some are nonsensical
  ("How long on Top?") — templating the wrong token again.
- **What's right:** Follow-ups must be genuinely useful next questions grounded in the
  answer's real content, never templated from a stray noun (kill "How long on Top?"
  class). Prefer generating them in the same call as the answer (also helps R1). If
  confidence is low, show none rather than dumb ones. This is a real redo of Q3/Q4 —
  the deterministic fallback is still producing junk.
- **Acceptance:**
  - [ ] No follow-up references a non-entity/stray token ("Top", a model name, etc.).
  - [ ] Follow-ups are contextually sensible or absent; verified against the Q6 eval
        program's follow-up grading.
- **Pointers:** `followUpSuggestions.ts`, `generateSuggestedFollowUps` in
  `aiService.ts`, `followUpResolver.ts`. Cross-ref Q3/Q4/Q6 in `AI-TAB-V2-SPEC.md`.

---

## Acknowledged as working (do not regress)
The grounded weekly/today answers (real numbers, clean formatting), the natural-language
search interpretation concept, per-chat settings, the transforms scaffolding, and the
overall minimal layout are good. The owner explicitly said this is solid for a v1. Keep
all of it; these are refinements.

---

## Appendix A — screenshots (saved on owner's Desktop, 2026-06-01)
1. AI header: thread title + "Claude · Claude Haiku 4.5" subline, wide "Search history
   — or ask in plain language" bar, ⌘K button, theme toggle, new-chat icon; "Turn
   into…" button under an answer; templated follow-ups ("How long on Top?"). → FB1,
   FB2, FB7, FB8, FB10.
2. The "shareable-report" artifact opened in a viewer — generic/hollow content ("A
   system day with mixed signal", "not one clean work stretch strong enough to name").
   → FB7.
3. Sidebar open by default with "Chats", a sidebar new-chat icon (duplicate), low-
   contrast TODAY/YESTERDAY/PREVIOUS 7 DAYS headers, confusing titles ("today", "Day
   report 2026-05-31"). → FB3, FB4, FB5, FB6.
4. ⌘K / search panel: "the link for canvas" → interpreted-as + ranked web results
   (rough styling). → FB2.
5. Search panel: "intro to ml course deadline" → interpreted + Notion URL results. →
   FB2.
6. Model subline highlighted — clicking does nothing. → FB8.
7. Raycast model selector reference: search + provider groups (GPT-5.5, GPT-5.4 mini…)
   + detail card (Speed, Intelligence, Context, Vision, Tool Use, Reasoning). → FB8.
8. Chat-settings modal (Model override + Additional instructions) opened by the
   wrong/low-quality gear icon. → FB9.
9. "today" thread answer with follow-ups ("How long on Notion?", "Compare Intro across
   sessions", "Draft a short note on Notion") + "Turn into…". → FB6, FB7, FB10.

## Appendix B — key files
- Header / layout: `src/renderer/views/insights/AIWorkspace.tsx`
- Sidebar: `src/renderer/views/insights/ConversationSidebar.tsx`
- Command palette (the one to keep): `src/renderer/components/CommandPalette.tsx` +
  `App.tsx` ⌘K handler
- Chat action palette (fold into the above): `src/renderer/views/insights/ChatActionPalette.tsx`
- Search: `src/renderer/views/insights/HistorySearch.tsx`, `naturalSearch.ts`,
  `searchTerms.ts`, `search:natural` IPC
- Transforms (D6): the transform module + `aiService.ts` generation/report path
- Per-chat settings (D4): `src/renderer/views/insights/ThreadSettingsPanel.tsx`
- Composer (D5): `src/renderer/views/insights/AICompose.tsx`
- Title gen: `deriveTitleFromMessage`, `useAIChat.ts`
- Follow-ups: `followUpSuggestions.ts`, `aiService.ts` `generateSuggestedFollowUps`,
  `followUpResolver.ts`
- Model catalog: `src/renderer/lib/aiProvider.ts`
- Icons: `src/renderer/views/insights/icons.tsx`
