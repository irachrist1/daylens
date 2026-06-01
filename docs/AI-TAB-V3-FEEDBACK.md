# Daylens AI Tab — V3 Device Feedback & Design Spec (2026-06-01)

**Context.** The AI tab V2 stack (D1 sidebar, D3 ⌘K palette, D4 per-chat settings,
D5 `@`/`/` composer, D6 transforms, S1 natural search, M1 model catalog, T3 tracking
controls — see `docs/AI-TAB-V2-SPEC.md`) is **merged to `main`** and was tested
on-device. It's genuinely good for a v1. This doc is the **fix + polish spec** from
that pass. Treat it as both a PM brief and a design brief: it tells you the exact
behavior and the exact look we want, with examples, not just "make it better."

---

## 0. READ THIS FIRST — how to do this work

### 0.1 Look at the screenshots. This is mandatory, not optional.
The owner saved every screenshot for this round on the **Desktop** (`~/Desktop`,
captured 2026-06-01, filenames like `Screenshot 2026-06-01 at 6.*.png`). **Open them
and study them before you change any UI.** Appendix A maps each screenshot to the
item it illustrates and says exactly what is wrong in it. Do not design from the prose
alone — match what the screenshots show (the bad state to fix) and what the reference
screenshots show (the target).

### 0.2 Design north star: Notion, then Raycast.
Anything visual must look like it belongs in **Notion** — calm, minimal, generous
whitespace, crisp type hierarchy, muted-but-legible secondary text, subtle hover
states, restrained color, real icons next to items. When in doubt about a visual
decision, ask "how would Notion do this?" and match that level of polish.
- **Notion** is the reference for: the conversation sidebar (section grouping,
  hover/active rows, density), section headers/eyebrows, typography, spacing,
  empty states, inline mentions with icons.
- **Raycast** is the reference for: the ⌘K command palette and the model selector
  (the owner provided Raycast screenshots — search field on top, grouped list,
  right-hand detail card, keyboard-first, monospace shortcut hints).
- Use the app's existing design tokens in `src/renderer/styles/globals.css`
  (`--color-text-primary/secondary/tertiary`, `--color-surface*`,
  `--color-border-ghost`, `--color-accent*`, etc.). **Support BOTH light and dark
  themes** — test both. Don't hardcode hex; use the tokens.
- Icons: use the project's `lucide-react` set and `views/insights/icons.tsx`. Crisp,
  consistent stroke weight and size. No mismatched or low-res glyphs.

### 0.3 How to work it
- **Work directly on `main`.** No long-lived branch. Commit and push to main; if you
  open a PR for CI, merge it the same session.
- Precondition is already satisfied: the V2 stack is on `main`.
- Follow `docs/AI-PRODUCT-DIRECTION.md` and `docs/CLAUDE.md`. Start from code.
- Don't regress `docs/AI-TAB-V2-SPEC.md` §2 "DO NOT REGRESS".
- Before merging: `npm run typecheck`, `npm run test:ai-chat`, `npm run build:all`
  green. Add unit tests for logic you touch (titles, follow-up filtering, transform
  prompts, mention resolution, search-in-palette).
- Do NOT cut a release; this is iterative. The owner ships when ready.
- **Run the app and look at your own result** before claiming an item done. Compare
  side-by-side with the reference screenshots. If it doesn't look like Notion/Raycast,
  it's not done.

---

## 1. Themes
1. **One command surface.** Collapse the global ⌘K palette + new header ⌘K button +
   wide header search bar into a single Raycast-style ⌘K. (FB1, FB2)
2. **Declutter + wire the header.** Remove the duplicate new-chat button and the
   inline search; make the model line actually open a model picker. (FB2, FB3, FB8)
3. **Make the AI genuinely generate.** "Turn into…" and reports must produce real,
   grounded, model-generated output — not static blobs. (FB7)
4. **Quality.** Follow-ups and auto-titles must be genuinely good, with the bar
   defined below by example. (FB6, FB10)
5. **The small things that sell it.** Real icons on `@`-mention chips, a crisp
   settings icon, visible section headers. (FB5, FB9, FB11)

---

## FB1 — ONE ⌘K command palette, Raycast-quality (keep the original)
- **Severity:** P0 · **Area:** renderer
- **What's wrong (see screenshot 1):** ⌘K is duplicated and confused. There is the
  original global palette (`components/CommandPalette.tsx`), a *separate* D3 in-chat
  action palette (`ChatActionPalette.tsx`), AND a ⌘K button in the header — three
  surfaces. Pressing ⌘K can do the wrong thing (opened another surface/tab). This is
  exactly the kind of duplication that makes the app feel unfinished.
- **Target behavior (precise):**
  - There is **one** palette: the original global `CommandPalette`. Delete/merge the
    separate D3 palette. ⌘K (and the header ⌘K button) always opens this one. It never
    creates a chat/tab.
  - It opens as a centered modal overlay, Raycast-style: a search field at the very
    top, then results grouped by section with small muted section labels, keyboard
    navigation (↑/↓, ⏎ to run, Esc to close), and monospace shortcut hints on the
    right of rows where applicable.
  - Sections, in order: **Search results** (history + natural-language, see FB2),
    **Actions for this message** (the D3 actions: Copy, Good/Bad, Regenerate, Regenerate
    with model… — shown only when a message is focused), **Chat** (New chat, model
    picker, chat settings), **Navigate** (Timeline, Apps, AI, Settings).
- **Target look:** match the Raycast palette screenshot the owner provided (rounded
  modal, soft shadow, generous row padding, muted group headers, selected row has a
  subtle accent background). Use app tokens; works in light + dark.
- **Acceptance:**
  - [ ] Exactly one palette component is mounted anywhere in the app.
  - [ ] ⌘K from any view opens it; Esc closes; ↑/↓/⏎ work; it never opens a tab/chat.
  - [ ] Message actions appear contextually when a message is focused.
  - [ ] Visually matches the Raycast reference at Notion-level polish in both themes.
- **Pointers:** `App.tsx` (⌘K handler), `components/CommandPalette.tsx` (the keeper),
  `views/insights/ChatActionPalette.tsx` (fold in + delete), `AIWorkspace.tsx`.

## FB2 — Move search INTO ⌘K; delete the header search bar; fine-tune it
- **Severity:** P0 · **Area:** renderer + search
- **What's wrong (screenshots 1, 4, 5):** A wide "Search history — or ask in plain
  language" input sits in the header. The owner: "the search looks horrible… no reason
  to have it there taking up space… still bad a little bit." The results panel styling
  is rough and the ranking/interpretation needs tuning (examples: "the link for
  canvas" and "intro to ml course deadline" did interpret + return results, but the
  panel looked unpolished and ranking was so-so).
- **Target behavior (precise):**
  - **Remove the header search input entirely.** Reclaim that space.
  - Search lives **inside ⌘K**. Typing in the ⌘K field: short/literal queries (1–3
    words, no question) run instant local FTS (no provider call); longer or
    question-shaped queries run the S1 natural-language interpreter (throttled, the
    existing `search:natural` path). Show the "Interpreted as …" line + extracted
    chips like the current panel, but styled cleanly.
  - Result rows match the existing card content (type badge, title, domain/subtitle,
    timestamp, highlighted excerpt) but restyled to Notion polish: aligned grid,
    muted secondary text, subtle hover, generous padding, real type/source icons
    (web/app/block/file), not a cramped box.
  - Fine-tune ranking: prefer exact title/domain matches, then recency; de-duplicate
    near-identical rows (the canvas example showed 3 near-dupes — collapse those).
- **Acceptance:**
  - [ ] No search input in the AI header.
  - [ ] ⌘K searches history + accepts plain-language queries, cleanly styled, light +
        dark, matching Notion polish.
  - [ ] Literal short queries are instant (no provider call); NL queries interpret.
  - [ ] Near-duplicate results are collapsed; ranking favors exact + recent.
- **Pointers:** `views/insights/HistorySearch.tsx` (remove from header; reuse its
  result-row rendering inside the palette), `naturalSearch.ts`, `searchTerms.ts`,
  `search:natural` IPC, `components/CommandPalette.tsx`.

## FB3 — Remove the duplicate "New chat" button (keep one)
- **Severity:** P1 · **Area:** renderer
- **What's wrong (screenshot 3):** Two new-chat buttons — one in the sidebar "Chats"
  header, one in the top-right app header.
- **Target:** Keep the **top-right header** one (always reachable since the sidebar is
  hidden by default, FB4). Remove the sidebar-header duplicate. Tooltip + ⌘N.
- **Acceptance:** [ ] Exactly one new-chat affordance (header), working, tooltip + ⌘N.
- **Pointers:** `AIWorkspace.tsx`, `ConversationSidebar.tsx`.

## FB4 — Hide the chats sidebar by default
- **Severity:** P1 · **Area:** renderer
- **What's wrong (screenshot 3):** The sidebar is open by default and crowds the chat.
- **Target:** Collapsed by default; the existing toggle opens it; state persists
  (localStorage). When closed, the conversation/empty-hero uses full width and stays
  centered. The open/close should animate smoothly (Notion-like slide), not snap.
- **Acceptance:** [ ] Fresh launch = sidebar hidden; toggle opens with a smooth
  transition; choice persists across launches.
- **Pointers:** `ConversationSidebar.tsx`, `AIWorkspace.tsx`.

## FB5 — Recency group headers are invisible; make them Notion-style
- **Severity:** P1 · **Area:** design
- **What's wrong (screenshot 3):** "TODAY / YESTERDAY / PREVIOUS 7 DAYS" are the same
  color as the rest, so the grouping doesn't read at all.
- **Target look (Notion sidebar sections):** small uppercase eyebrow labels, ~11px,
  ~0.06em letter-spacing, `--color-text-tertiary` but with enough contrast to read,
  clear top margin separating groups, chat rows below them at normal text color. Think
  Notion's sidebar section headers (PRIVATE / WORKSPACE) — quiet but unmistakable.
  Active chat row gets a subtle `--color-surface-high` background and rounded corners;
  hover gets a lighter version. Tighten row density to Notion's (not too airy).
- **Acceptance:** [ ] Group headers are immediately distinguishable from rows in both
  themes; active/hover row states match Notion's subtlety.
- **Pointers:** `ConversationSidebar.tsx`, tokens in `globals.css`.

## FB6 — Chat titles must be meaningful (they're nonsense now)
- **Severity:** P1 · **Area:** title gen + sidebar
- **What's wrong (screenshot 3):** Titles are bad and confusing: several literally
  named **"today"**, plus raw first-message fragments like **"in detail tell me
  evrything i did o…"**, and auto **"Day report 2026-05-31"** threads mixed in with
  user chats so you can't tell them apart.
- **Target behavior (precise):**
  - A title is a **2–5 word topic summary**, not the first word(s) of the message and
    never a bare stopword. "What did I work on today?" → **"Today's work"** or
    **"Today's activity"**, NOT "today". "in detail tell me everything i did on this
    laptop" → **"Full laptop activity"** or **"Everything I did"**. "Summarize my last
    7 days by project" → **"Last 7 days by project"** (this one is already fine).
  - Derive locally from the first user message by default (cheap), but clean it:
    strip filler ("in detail", "tell me", "can you"), drop trailing ellipsis, title-case
    sensibly, cap length. If the cleaned result is empty or a stopword, fall back to a
    short topic phrase.
  - **Distinguish auto Day-report threads** from user chats: give them a small report
    icon (or group them under a "Reports" section), so "Day report 2026-05-31" reads
    as a generated report, not a conversation.
- **Acceptance:**
  - [ ] No chat titled with a bare stopword ("today", "the", etc.) or a raw truncated
        sentence.
  - [ ] Titles are concise topic phrases; verify on the exact examples above.
  - [ ] Day-report threads are visually distinct from user chats.
- **Pointers:** `deriveTitleFromMessage`, `useAIChat.ts`, `ConversationSidebar.tsx`.

## FB7 — "Turn into…" and reports must ACTUALLY generate (they're static)
- **Severity:** P0 · **Area:** main / aiService + renderer
- **What's wrong (screenshots 1, 2, 9):** Clicking "Turn into…" (shorter / checklist /
  bullets / report) does **not** generate anything real — it emits canned blobs. The
  generated "shareable-report" artifact is generic and hollow: "A system day with
  mixed signal", "There was not one clean work stretch strong enough to name
  confidently", "The evidence does not show a major non-work browser stretch" — none of
  that reflects the actual answer it was launched from (which had real projects, hours,
  focus %). It's a template, not a transform.
- **Target behavior (precise):**
  - Each transform runs a **real model call** that takes the **specific answer (and its
    grounded data) as input** and rewrites it into the requested form:
    - **Shorter** → a tight 2–4 sentence version of *that* answer, same facts.
    - **Checklist** → real `- [ ]` items derived from the answer's content.
    - **Bullets** → the answer's actual points as bullets.
    - **Report** → a titled report whose sections contain the *real numbers and
      threads* from the answer (e.g. the 79h 20m / 31% focus / per-project breakdown),
      not a generic day shell.
  - Output is generated, so it differs per answer and is faithful to the source. No
    static strings.
  - Transforms go through the rate-limiter/retry path (R1) and surface errors via the
    branded card (R4). Show a generating/loading state while it runs.
- **Acceptance:**
  - [ ] Each transform produces model-generated output that is recognizably a
        transform of the specific answer (contains its real facts/numbers), verified on
        the "last 7 days by project" answer.
  - [ ] "Turn into report" yields a report whose body is the real content, not "A
        system day with mixed signal".
  - [ ] Loading + branded-error states present.
- **Pointers:** the D6 transform module (canned re-prompts today — replace with real
  prompts), `aiService.ts` (`sendMessage` / report + artifact generation path).

## FB8 — Clicking the model line opens a Raycast-style model selector
- **Severity:** P1 · **Area:** renderer
- **What's wrong (screenshots 6 → 7):** The "Claude · Claude Haiku 4.5" line under the
  thread title looks clickable but **does nothing**. The owner wants Raycast's model
  picker (screenshot 7).
- **Target look + behavior (match the Raycast screenshot precisely):**
  - Click the model line → a popover/modal with a **search field** ("Search models…")
    at top, models **grouped by provider** (Anthropic / OpenAI / Google / OpenRouter),
    each row showing the model name + provider tag, the current one checked/highlighted.
  - A **right-hand detail card** for the focused model showing: **Speed** and
    **Intelligence** as small segmented bars, **Context** (e.g. "150k words | 200k"),
    and capability badges with icons — **Vision**, **Tool Use**, **Reasoning / No
    Reasoning**. (See Raycast screenshot 7 — replicate that card.)
  - Selecting a model applies it as the **per-chat override (D4)** and the subline
    updates immediately. Keyboard navigable.
  - Pull the model list + the per-model metadata (speed/intelligence/context/caps) from
    the M1 catalog in `lib/aiProvider.ts`. Add that metadata to the catalog if missing.
- **Acceptance:**
  - [ ] Clicking the model line opens a searchable, provider-grouped picker with the
        detail card, matching the Raycast reference in both themes.
  - [ ] Selecting applies the per-chat override (D4) and updates the subline.
  - [ ] List + capabilities come from `aiProvider.ts`.
- **Pointers:** `AIWorkspace.tsx` (model subline), `ThreadSettingsPanel.tsx` (D4),
  `lib/aiProvider.ts` (catalog + add capability metadata), `icons.tsx`.

## FB9 — Chat-settings icon is wrong and low quality
- **Severity:** P2 · **Area:** design
- **What's wrong (screenshots 8):** The trigger that opens the "Chat settings" modal
  uses a wrong, low-quality icon.
- **Target:** A crisp `lucide-react` glyph consistent with the app (a sliders or
  settings-2 icon), correct size (~16px) and stroke weight, with hover state. It should
  read instantly as "settings for this chat."
- **Acceptance:** [ ] Crisp, correct, on-brand icon; matches the other header icons'
  weight/size in both themes.
- **Pointers:** `AIWorkspace.tsx`, `views/insights/icons.tsx`, `ThreadSettingsPanel.tsx`.

## FB10 — Follow-up suggestions must be genuinely good (define + enforce the bar)
- **Severity:** P1 · **Area:** follow-ups
- **What's wrong (screenshots 1, 9):** Still templated and sometimes nonsensical:
  - **"How long on Top?"** — "Top" is not a real entity. It was templated from the
    words "**Top** work threads" in the answer. This is the core bug: the generator
    grabs a stray noun and stuffs it into a template.
  - **"Which files appeared in Coursera?"** — Coursera is a website, not a file source;
    category mismatch.
  - **"Compare Neural Networks across sessions"**, **"Compare Intro across sessions"** —
    "Neural Networks" / "Intro" are fragments of titles, templated into a vague compare
    prompt.
  - **"Draft a short note on Notion"**, **"How long on Notion?"** — Notion is the *app*,
    not the subject of the work; these treat the tool as the topic.
- **What a GOOD follow-up is (the bar):** a real next question a thoughtful user would
  actually ask, that (1) references a **real entity, number, or timeframe from THIS
  answer**, (2) leads somewhere useful — deeper detail, a comparison, an export, or an
  action, (3) is **never** templated from a stray noun or a section-header word, (4)
  **never** treats an app/provider/model name as the subject, (5) reads naturally.
- **Good examples (for the "last 7 days by project" answer):**
  - "Which days was Coursera my main focus?"
  - "Break down the 4h 8m Daylens repo session."
  - "How does this week's 31% focus compare to last week?"
  - "Export this 7-day summary as a CSV."
  - "What pulled me off task on May 31?"
- **Good examples (for the "what did I work on today" answer):**
  - "How long was I in Notion today?"
  - "What was the Study Planner page about?"
  - "Summarize today as a short note."
- **Target behavior:** Prefer generating follow-ups **in the same model call as the
  answer** (also helps R1), grounded in the answer's real entities. Kill the
  deterministic noun-templating fallback — if you can't produce ≥2 genuinely good ones,
  show **none**. Grade them with the Q6 eval program's follow-up grader.
- **Acceptance:**
  - [ ] No follow-up references a stray token ("Top"), a title fragment, or an
        app/model name as the subject.
  - [ ] Follow-ups are specific to the answer's real content (verify on both example
        answers above) or absent.
  - [ ] Q6 follow-up grading passes on the eval set.
- **Pointers:** `followUpSuggestions.ts`, `aiService.ts` `generateSuggestedFollowUps`,
  `followUpResolver.ts`. Cross-ref Q3/Q4/Q6 in `AI-TAB-V2-SPEC.md`.

## FB11 — `@`-mention chips have no icons (they should, like Notion/Raycast)
- **Severity:** P1 · **Area:** renderer
- **What's wrong:** When you type `@` and mention an app (e.g. Ghostty), a client, or a
  day, the chip is **plain text with no icon**. Notion and Raycast always show the
  entity's icon inline; ours looks bare and unfinished. The owner specifically called
  this out — "when you tag the tools, there are no icons on our version."
- **Target behavior + look:**
  - In the `@`-mention dropdown AND in the inserted chip (in the composer and in the
    sent message), show the entity's icon:
    - **App** mentions → the real app icon, resolved via the existing icon resolver
      (`ipc.icons.resolve` / `iconResolver.ts`) — the same icons the Timeline/Apps
      views already render. Ghostty, Cursor, Safari, etc. should show their actual app
      icon.
    - **Client** mentions → the client's color swatch/dot.
    - **Day** mentions → a small calendar glyph.
  - Chip styling like Notion inline mentions: small rounded pill, icon + label, subtle
    background (`--color-accent-dim` or `--color-surface-high`), readable in both
    themes.
- **Acceptance:**
  - [ ] `@`-mention dropdown rows show the entity icon.
  - [ ] Inserted mention chips (composer + sent message) show the icon, with app icons
        resolved via the icon resolver (real icons, not placeholders).
  - [ ] Styled like Notion mentions, light + dark.
- **Pointers:** `views/insights/AICompose.tsx` (D5 mentions), the mention dropdown,
  `iconResolver.ts` / `ipc.icons.resolve`, how Timeline/Apps render app icons (reuse
  that component), `icons.tsx`.

---

## Acknowledged as working (DO NOT REGRESS)
Grounded weekly/today answers with real numbers and clean formatting; the natural-
language search *concept*; per-chat settings; the transforms scaffolding; the overall
minimal layout. The owner: solid for a v1. These are refinements, not a rebuild.

---

## Appendix A — screenshots (on the owner's Desktop, 2026-06-01). LOOK AT THESE.
1. AI header — title + "Claude · Claude Haiku 4.5" subline, wide "Search history — or
   ask in plain language" bar, ⌘K button, theme toggle, new-chat icon; "Turn into…"
   under an answer; templated follow-ups incl. "How long on Top?". → FB1, FB2, FB7,
   FB8, FB10.
2. The "shareable-report" artifact opened — hollow/generic content not matching the
   source answer. → FB7.
3. Sidebar open by default ("Chats"), a duplicate sidebar new-chat icon, invisible
   TODAY/YESTERDAY/PREVIOUS 7 DAYS headers, nonsense titles ("today", "Day report
   2026-05-31", truncated sentence). → FB3, FB4, FB5, FB6.
4. Search "the link for canvas" → interpreted + ranked results, rough styling, near-
   duplicate rows. → FB2.
5. Search "intro to ml course deadline" → interpreted + Notion URL results. → FB2.
6. Model subline highlighted — clicking does nothing. → FB8.
7. **Raycast model selector reference** — search field, provider groups (GPT-5.5,
   GPT-5.4 mini…), right detail card (Speed, Intelligence, Context "150k words | 200k",
   Vision, Tool Use, No Reasoning). Replicate this. → FB8.
8. "Chat settings" modal (Model override + Additional instructions) opened by the
   wrong/low-quality gear icon. → FB9.
9. "today" thread answer with bad follow-ups ("How long on Notion?", "Compare Intro
   across sessions", "Draft a short note on Notion") + "Turn into…". → FB6, FB7, FB10.
(Also reference the earlier Raycast screenshots in `AI-TAB-V2-SPEC.md` Appendix for the
⌘K palette and composer.)

## Appendix B — key files
- Header / layout: `src/renderer/views/insights/AIWorkspace.tsx`
- Sidebar: `src/renderer/views/insights/ConversationSidebar.tsx`
- Command palette (keep this one): `src/renderer/components/CommandPalette.tsx` +
  `App.tsx` ⌘K handler
- Chat action palette (fold in + delete): `src/renderer/views/insights/ChatActionPalette.tsx`
- Search: `src/renderer/views/insights/HistorySearch.tsx`, `naturalSearch.ts`,
  `searchTerms.ts`, `search:natural` IPC
- Transforms (D6): transform module + `aiService.ts` generation/report path
- Per-chat settings (D4): `src/renderer/views/insights/ThreadSettingsPanel.tsx`
- Composer + mentions (D5): `src/renderer/views/insights/AICompose.tsx`
- Icon resolution for app icons: `iconResolver.ts` / `ipc.icons.resolve` (reuse the
  Timeline/Apps icon component)
- Title gen: `deriveTitleFromMessage`, `useAIChat.ts`
- Follow-ups: `followUpSuggestions.ts`, `aiService.ts` `generateSuggestedFollowUps`,
  `followUpResolver.ts`
- Model catalog + capability metadata: `src/renderer/lib/aiProvider.ts`
- Icons + tokens: `src/renderer/views/insights/icons.tsx`, `src/renderer/styles/globals.css`
