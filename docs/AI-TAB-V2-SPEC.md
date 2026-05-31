# Daylens AI Experience — V2 Spec & Defect Report

**Status:** v1.0.41 shipped to all platforms (mac/win/linux) on 2026-05-31. The new
AI tab (`src/renderer/views/insights/`) is live and the auto-update reached
installed apps.

**Verdict (from real-device testing):** the foundation is good and several pieces
delight — but the AI experience is roughly **10% of what it should be** and is not
yet reliable. This document is the hand-off backlog. It is written so any agent or
developer can pick up a single item and know *what is wrong, why, what "right"
looks like, and how to verify it.*

---

## Implementation status — 2026-05-31 (branch `ai-tab-v2`, reliability pass)

**Shipped in this pass** (Phase 0 + tractable Phase 1/2 — typechecked, unit-tested):
- **R1** — per-provider throttle + 429 backoff/retry honoring `Retry-After`
  (`src/main/services/aiRateLimiter.ts`) wrapping every provider call; follow-ups
  are now deterministic (zero extra provider calls); tool-roundtrip cap lowered
  for low-RPM models; calls-per-turn instrumented.
- **R2** — single-sourced provider: `preferredProviderForJob` honors each job's
  `providerPreferenceKey`; chat resolves `aiChatProvider ?? aiProvider` for the
  answer, the executing provider, and the "what model are you" string alike.
- **R3** — no stuck "Thinking": the answer flips to complete *before* the
  thread-list refresh; a hard 90s client timeout turns a stuck turn into a
  retryable error.
- **R4** — branded, channel-name-free errors (`src/renderer/lib/ipcError.ts`)
  with a working Retry on error cards + one automatic rate-limit retry; applied
  to chat **and** timeline (T1/T2).
- **Q3/Q4** — follow-ups grounded in the answer's real entities, meta-entity
  stoplist (kills "How long on Google Gemini?"), identity-answer suppression,
  deterministic presence (≥2 or none).
- **Q5** — Raycast-style title word cap. **Q1/Q2** — prompt-level entity-intent
  and cross-turn consistency rules (deeper tool normalization noted below).
- **U1** — History selection reliably loads a thread's messages (loading state +
  error surfacing). **U2/D2** — header shows thread title + real model subline;
  centered floating label removed. **U3** — clearer new-chat icon + tooltip + ⌘N.
- **T1/T2** — timeline AI actions inherit the throttle/retry and show friendly
  errors. **M1** — model tier-fallback aligned to the offered catalog + dated
  review marker.

**Shipped after the reliability pass (stacked PRs on `ai-tab-v2`):**
- **#24** error classification (transient 429 vs hard wall) + one-tap switch-provider.
- **#25 Q6** per-provider eval program. **#26 D1** time-grouped sidebar.
  **#27 D3** ⌘K action palette. **#28 D6** response transforms. **#29 D4** per-chat
  settings. **#30 D5** `@`/`/` composer. **#31 S1** natural-language search
  (FTS-backed; embedding/vector index still deferred).
- **#32 M1** — model catalog refreshed to verified GA ids (Gemini 3.5 Flash,
  GPT-5.5, Opus 4.8); dead `gemini-3.1-flash-lite-preview` default replaced + migrated.
- **T3** Tracking Controls — opt-in (off by default), pure capture-gate
  (`src/shared/trackingControls.ts`) wired into the app + website capture paths;
  per-app/per-site exclusions, incognito-skip (window-title heuristic), pause
  toggle (Settings + tray), delete-from-history on exclude, onboarding opt-in.

**Still deferred (each needs its own PR / a device step):**
- **M1 live answer test** — per-provider answer quality needs API keys.
- **S1** embedding/vector index. **D4** reasoning-effort. **D5** attachments/dictation.
- **Q6** baseline scores (authorized live per-provider run). **C1** signing.
- **T3 follow-ups:** structured incognito signal (vs the title heuristic) and a
  query-time hide for surfaces beyond the timeline if delete-on-exclude proves
  insufficient.

> How to read this doc
> - Each item has a stable **ID** (`R1`, `Q3`, `D4`, …). Assign agents by ID.
> - **Severity:** P0 (blocks core use) → P3 (polish).
> - Every item has **Symptom → Evidence → Root cause → Target behavior →
>   Acceptance criteria → Pointers**. Don't start coding until the target
>   behavior and acceptance criteria are clear.
> - Screenshots are referenced as **[Img N]** in the order the product owner
>   shared them; Appendix A describes each one.
> - Related existing docs: `docs/AI-PRODUCT-DIRECTION.md`,
>   `docs/AI-FIX-STRATEGY.md`, `docs/TIMELINE-INTENT-MODEL.md`,
>   `docs/PERF-COHERENCE-MAP.md`.

---

## 1. North Star (the overall goal)

Daylens AI should feel like **a fast, reliable analyst that already knows your
work** — you ask in plain language, it answers from your local history instantly,
accurately, and never makes you think about providers, rate limits, or errors.
The bar is **Raycast AI v2**: minimal surface, powerful underneath, every
interaction crisp. The chat should be the front door to *all* of Daylens' data —
timeline, apps, sessions, artifacts, clients — through natural language.

Three product truths to hold onto:
1. **Reliability beats features.** An answer that sometimes fails is worse than a
   smaller answer that always works.
2. **Grounded and honest.** Every number must trace to real captured data and must
   not contradict itself across turns.
3. **Invisible plumbing.** The user picked a provider once; they should never see
   "rate limit", "remote method", "quota", or a model id again unless they go
   looking.

---

## 2. What's working — DO NOT REGRESS

These got explicit praise or verified as correct. Protect them.

- **Update download progress bar + macOS in-place install/relaunch** [Img 1–3]. The
  download %, "you can keep using the app", and the install→relaunch flow are
  excellent. Keep.
- **The "Thinking" animation** [Img 5] — loved. Keep the blinking caret
  (`.ai-caret`, `MessageList.tsx`).
- **Multi-turn thread memory** [Img 12, 14, 18, 20-ish] — the assistant remembers
  earlier turns in a thread. This works and was a pleasant surprise. Keep and lean
  into it.
- **Fast composer typing** — confirmed genuinely faster to type in.
- **A good answer when it succeeds** [Img 10] — "What did I work on today?" returns
  a clean, grounded, well-formatted breakdown with sensible follow-up chips. This
  is the quality bar for *every* answer.
- **Local-history search with highlighted excerpts** [Img 18] — the keyword search
  result cards (icon, title, domain, timestamp, highlight) are good. Keep them as
  the fast path under the new natural-language search (see S1).

---

## 3. Root-cause themes (the patterns behind the symptoms)

Most reported failures collapse into four underlying causes. Fixing these fixes
many surface bugs at once.

- **THEME A — Too many model calls per turn.** A single user question fans out into
  many provider API calls: the tool-use answer loop is capped at **7 calls**
  (`MAX_TOOL_CALLS = 7`, `src/main/jobs/aiService.ts:1114`), *plus* a separate
  follow-up-suggestion generation (`generateSuggestedFollowUps`,
  `aiService.ts:3171`, invoked at 5540/5583/5763), *plus* a thread-title
  generation on the first message (`maybeRenameWeakThread`, `aiService.ts:3332` /
  `5414`). On a free/low-tier Gemini key (a few requests/minute) one answer can
  exhaust the per-minute budget → `429` / `RESOURCE_EXHAUSTED`. This is why it
  "works sometimes and fails other times." → **R1**.
- **THEME B — Provider routing seam + no fallback.** Orchestration always runs on
  `settings.aiProvider` (`preferredProviderForJob`, `aiOrchestration.ts:273`,
  defaulting to `'anthropic'`) with **no cross-provider fallback**
  (`applyStrategyProviderFallback` returns `[preferred]`, `:277`). The chat UI,
  however, computes its provider as `aiChatProvider ?? aiProvider`
  (`AIWorkspace.tsx` / `useAIChat.ts`). If those two ever disagree, the answer runs
  on a different provider than the UI claims. (The owner suspected "routing to
  Anthropic"; the actual finding is *no fallback* + the `aiProvider`/
  `aiChatProvider` seam + rate limits — see R1/R2.) → **R2**.
- **THEME C — Renderer state/lifecycle gaps.** The answer completes but the UI
  doesn't reflect it until a re-render is forced by navigation [Img 5 → Img 9];
  switching threads via History updates the header but not the body [Img 4]. These
  are render-isolation / stale-state / missing-load bugs in the new modular tab. →
  **R3, U1**.
- **THEME D — Error & quality leakage.** Raw IPC errors reach the user ("Error
  invoking remote method 'ai:send-message': …" [Img 6, 11]); deterministic
  fallbacks produce nonsense follow-ups [Img 14] and weak titles [Img 4,5,7]; and
  answers can contradict each other [Img 16/17]. → **R4, Q1–Q5**.

---

## 4. Defects & Requirements

### P0 — Reliability (the app must answer every time)

#### R1 — One question must not burn the provider's rate limit
- **Severity:** P0 · **Area:** main / aiService
- **Symptom (plain):** You ask one thing and get "rate limit was hit — your plan
  only allows a few requests per minute, and a single answer makes several." It
  works, then fails, then works again, unpredictably.
- **Evidence:** [Img 6] ("Summarize my last 7 days by project" → PROVIDER ERROR),
  [Img 11] (follow-up failed), [Img 19] ("what's trending… analyse my entire
  week?" → rate limit again), and the worst case [Img 31] — the **very first
  message of a brand-new chat** ("in detail tell me everything i did on this
  laptop") fails immediately with the rate-limit error, before the user has seen
  a single working answer. Broad "tell me everything" prompts fan out hardest
  (more tool calls to gather full-day/-week data), so the heaviest queries are the
  most likely to fail, including on a cold first impression. The error literally
  states the cause: *a single answer makes several requests.*
- **Root cause:** Per-turn call fan-out (Theme A). `MAX_TOOL_CALLS = 7`
  (`aiService.ts:1114`) + `generateSuggestedFollowUps` (`:3171`) + title gen
  (`maybeRenameWeakThread`, `:3332/:5414`). Free-tier Gemini RPM is small.
- **Target behavior:**
  1. A typical question completes in **1–2 provider calls**. Fold follow-up
     suggestions into the *same* answer response (ask the model to return answer +
     suggestions in one structured call, or generate suggestions locally). Make
     thread-title generation **deterministic/local** or **batched/deferred** so it
     never competes with the answer for the per-minute budget.
  2. Add a **per-provider request queue with token-bucket throttling** and
     **exponential backoff + jittered retry** on `429`/`RESOURCE_EXHAUSTED` (retry
     the *same* provider 2–3× before surfacing an error). Respect `Retry-After`.
  3. Cap tool roundtrips lower for cheap models (e.g. 3) and short-circuit when the
     deterministic router already answered.
- **Acceptance criteria:**
  - [ ] Asking the 4 starter prompts back-to-back on a free Gemini key succeeds
        without a rate-limit error (or auto-recovers silently within the retry
        window).
  - [ ] Instrument and log calls-per-turn; median ≤ 2 for question-type prompts.
  - [ ] A transient `429` is retried automatically and the user never sees it
        unless all retries fail.
  - [ ] The first message of a brand-new chat — including a broad "tell me
        everything I did" prompt — returns a real answer, never a rate-limit error
        as the user's first experience.
- **Pointers:** `aiService.ts` (`MAX_TOOL_CALLS`, `generateSuggestedFollowUps`,
  `maybeRenameWeakThread`, `sendMessage` ~5400+), `aiOrchestration.ts`
  (`isQuotaOrAuthError` `:281`, add a throttle/queue here). Cross-ref
  `docs/AI-COST-MODEL` notes in memory.

#### R2 — Provider selection must be single-sourced and honest
- **Severity:** P0 · **Area:** main + settings + chat UI
- **Symptom (plain):** Owner suspects answers sometimes run on Anthropic (out of
  credits) instead of the selected Gemini, because failures are intermittent.
- **Evidence:** [Img 8] Gemini selected & "connected"; [Img 14] answer says "routed
  through Google Gemini (gemini-3.1-flash-lite-preview)"; yet failures persist.
- **Root cause:** Two sources of truth. Orchestration uses `settings.aiProvider`
  (`aiOrchestration.ts:273`, `?? 'anthropic'`); the chat surface uses
  `settings.aiChatProvider ?? settings.aiProvider`. There is **no fallback**
  (`:277`), so a per-surface chat-provider override would silently not take effect
  in orchestration. (So the real story is rate limits, not Anthropic — but the seam
  is a latent correctness bug.)
- **Target behavior:** One resolved provider per turn, used by both the answer and
  the "what model are you" string, derived from the *same* setting the chat UI
  shows. If a chat-specific provider is a product goal, thread it through
  `preferredProviderForJob`. Never silently default to a provider the user didn't
  choose. If the selected provider truly fails (auth/credit, not transient rate
  limit), show a clear "switch provider" affordance — do **not** auto-route to an
  exhausted provider.
- **Acceptance criteria:**
  - [ ] The provider/model named in answers == the provider/model that executed ==
        what Settings shows, in 100% of turns.
  - [ ] Removing/blanking the selected provider's key produces a clear,
        actionable error (not a generic failure).
- **Pointers:** `aiOrchestration.ts:270-279`, `settings.handlers.ts`,
  `useAIChat.ts` provider derivation, `Settings.tsx` Connection panel.

#### R3 — "Thinking" must never get stuck
- **Severity:** P0 · **Area:** renderer
- **Symptom (plain):** You send a message, it sits on "Thinking…" forever; the real
  answer only appears after you switch tabs and come back.
- **Evidence:** [Img 5] stuck on "Thinking" for "Summarize my last 7 days"; [Img 9]
  the owner notes the clicked answer "appeared" only after navigating away and
  back.
- **Root cause (hypotheses to verify):** render-isolation / stale closure in the
  new modular tab — the pending→complete/error `setMessages` transition isn't
  forcing a visible re-render, or a rejected provider call leaves the pending
  assistant row un-finalized; possibly the streaming snapshot store and the
  `messages` array desync. Also there is **no client-side timeout**.
- **Target behavior:** The streamed answer renders live; on completion the row
  flips to the final markdown **without navigation**; on error it flips to the
  error card. Add a **hard timeout** (e.g. 60–90s) that converts a stuck pending
  message into a retryable error. Never leave a permanent "Thinking".
- **Acceptance criteria:**
  - [ ] Send 10 messages in a row (including ones that error); every pending row
        resolves to answer or error within the timeout, with no navigation.
  - [ ] Reproduce the original "appears after navigating" case and confirm it's
        gone.
- **Pointers:** `useAIChat.ts` (`handleSend`, the pending/complete/error
  `setMessages` paths, the streaming store wiring), `StreamingMessage.tsx`,
  `streamingStore.ts`, `MessageList.tsx` (`state === 'pending'` branch).

#### R4 — Errors must be human, branded, and recoverable
- **Severity:** P0 · **Area:** main IPC + renderer
- **Symptom (plain):** Errors show raw internals: *"Error invoking remote method
  'ai:send-message': Error: …"*. Scary and unprofessional.
- **Evidence:** [Img 6, 11, 19] chat; [Img 29] timeline "db:rebuild-timeline-day";
  [Img 30] "ai:regenerate-block-label".
- **Root cause:** Main handlers `throw`; Electron's `ipcRenderer.invoke` rejects
  with the `Error invoking remote method '<channel>':` prefix; the renderer puts
  `error.message` straight into the UI (`useAIChat.ts` catch; same for timeline
  handlers).
- **Target behavior:** Return **structured errors** from main
  (`{ code, userMessage, retryAfter? }`) or strip the IPC prefix in the renderer.
  Show one branded error card (the existing copy at `aiService.ts:5358-5362` is
  good — keep that voice) with an inline **Retry** button and, when `retryAfter`
  is known, an auto-retry countdown. Never display channel names or "remote
  method".
- **Acceptance criteria:**
  - [ ] No user-visible string ever contains "remote method", "ai:send-message",
        "db:rebuild-timeline-day", or "ai:regenerate-block-label".
  - [ ] Every error card has a working Retry; rate-limit cards auto-retry.
- **Pointers:** `src/main/ipc/ai.handlers.ts:53`, `db.handlers.ts`
  (rebuild-timeline-day), `aiOrchestration.ts:297` (`friendlyProviderError`),
  `aiService.ts:5358`, renderer `useAIChat.ts` catch + `MessageList.tsx` error
  branch + `Timeline.tsx` re-analyze/regenerate handlers.

---

### P1 — Answer quality & correctness

#### Q1 — Answers must not contradict themselves or the data
- **Severity:** P1 · **Area:** tools + prompts + attribution
- **Symptom:** Within one thread the assistant said you spent **3h 45m** on eight
  YouTube pages in Safari, then a turn later said **"You spent 25 seconds on
  youtube.com."** Both can't be true.
- **Evidence:** [Img 16] (YouTube pages in Safari, 3h45m) → [Img 17] ("How long on
  YouTube?" → "25 seconds on youtube.com").
- **Root cause (hypothesis):** YouTube watched *inside Safari* is counted as Safari
  browser-page time, but a domain/app query for `youtube.com` returns a different
  (near-zero) figure — the tools answer two different questions and the model
  doesn't reconcile them. Attribution of in-browser video time is inconsistent.
- **Target behavior:** A consistent notion of "time on YouTube" regardless of
  whether the query says "YouTube" or "youtube.com", grounded in the same
  underlying sessions. The model should reconcile or the tool should normalize
  domain/app/page time into one answer.
- **Acceptance criteria:** [ ] Asking "how long on YouTube" and "how long on
  youtube.com" and "youtube time in Safari" return mutually consistent numbers in a
  single thread.
- **Pointers:** `src/main/services/aiTools.ts`, `browserContext.ts`,
  `attribution.ts`, the tool definitions in `aiService.ts`.

#### Q2 — Match the question's actual intent (files ≠ pages ≠ sessions)
- **Severity:** P1 · **Area:** tools + prompts
- **Symptom:** "Which **files** appeared in Safari?" was answered with a list of
  **YouTube pages** — pages, not files/artifacts.
- **Evidence:** [Img 16].
- **Target behavior:** Distinguish artifacts/files vs browser pages vs app sessions;
  if the user says "files" and there are none, say so rather than substituting
  pages. Disambiguate when unsure.
- **Acceptance criteria:** [ ] "Which files…" returns artifacts/files (or an honest
  "no files, but here are the pages…"), not silently the wrong entity.
- **Pointers:** tool schemas + system prompt in `aiService.ts` (~3558 voice rules),
  `aiTools.ts`.

#### Q3 — Follow-up suggestions must be smart, not templated noise
- **Severity:** P1 · **Area:** follow-ups
- **Symptom:** After "what model are you?" the chips were **"How long on Google
  Gemini?", "Which files appeared in Google Gemini?", "Compare Google Gemini across
  sessions", "Draft a short note on Google Gemini"** — it templated the last noun
  ("Google Gemini") into canned questions. Nonsense.
- **Evidence:** [Img 14].
- **Root cause:** Deterministic fallback templates the last entity
  (`generateSuggestedFollowUps` → `filterFollowUpCandidatesWithReport`,
  `aiService.ts:3171-3184`). It fires when model follow-ups are missing (often
  because of the rate limit, R1).
- **Target behavior:** Generate follow-ups **in the same call as the answer**
  (no extra API call — also helps R1), grounded in the actual answer content. If
  confidence/quality is low, **show none** rather than dumb ones. Never template a
  meta-entity like a provider/model name into "how long on X".
- **Acceptance criteria:** [ ] No follow-up ever references the model/provider name
  as a data entity. [ ] Follow-ups are either contextually useful or absent.
- **Pointers:** `aiService.ts:3171`, `src/main/lib/followUpSuggestions.ts`,
  `followUpResolver.ts`.

#### Q4 — Follow-ups must appear consistently
- **Severity:** P1 · **Area:** follow-ups + renderer
- **Symptom:** Chips sometimes appear, sometimes don't, for similar answers.
- **Evidence:** [Img 10] (present) vs [Img 12/13] (absent), owner note.
- **Target behavior:** Deterministic rule for when chips show (e.g. always ≥2 for
  question-type answers that succeeded), surviving rate-limit fallbacks because
  they're produced with the answer (Q3).
- **Acceptance criteria:** [ ] Same answer kind → same chip presence every time.
- **Pointers:** as Q3 + `MessageList.tsx` (`suggestedFollowUps?.length >= 2` gate).

#### Q5 — Auto-title naming must be good and cheap
- **Severity:** P1 · **Area:** title gen
- **Symptom:** Thread titles are weird/inconsistent: **"Line one"**, **"Friendly
  Greeting"**, **"Time on Video consumption and quick research"**.
- **Evidence:** [Img 4, 5, 7] ("Line one"), Raycast comparison [Img 28] ("Friendly
  Greeting" is actually Raycast's own — match that crispness).
- **Root cause:** Title is generated from the first message via an extra model call
  (`maybeRenameWeakThread`, `aiService.ts:3332/5414`) — extra rate-limit pressure
  (R1) and uneven quality. ("Line one" came from a test message; still, the namer
  should produce a sensible 2–4 word title.)
- **Target behavior:** Concise 2–5 word titles (like Raycast). Prefer a **cheap or
  local** method (truncate/clean the first user message, or batch title generation
  off the answer call). Rename a weak placeholder once a real exchange exists. Never
  let titling consume the answer's rate budget.
- **Acceptance criteria:** [ ] Titles are 2–5 words, describe the topic, and titling
  costs **0 extra synchronous provider calls** on the answer path.
- **Pointers:** `aiService.ts:2213` (title parse/fallback), `:3332` `maybeRenameWeakThread`,
  `:3344` `queueWeakThreadTitleUpgrade`.

#### Q6 — Stand up an answer-quality evaluation program
- **Severity:** P1 (ongoing) · **Area:** eval
- **Symptom:** Owner: "we need to analyse all of its questions — a lot of work to
  refine the answers." Quality is uneven across question types.
- **Target behavior:** A curated eval set of representative questions (today /
  this-week / by-project / by-app / by-client / files / focus / "who are my
  clients" / meta) with a grading rubric (grounded? consistent? answers the actual
  question? right granularity? hallucination-free?). Run it against each provider
  before shipping AI changes. Build on the existing `tests/ai-behaviour/` and
  `tests/ai-bench/` harnesses.
- **Acceptance criteria:** [ ] A documented eval set + rubric + a `npm run`
  command; baseline scores recorded per provider.
- **Pointers:** `tests/ai-behaviour/`, `tests/ai-bench/runner.ts`,
  `tests/routerHardPromptBenchmark.ts`.

---

### P1 — Chat UX correctness

#### U1 — Selecting a thread from History must load its messages
- **Severity:** P1 · **Area:** renderer
- **Symptom:** Clicking History "does nothing — it just updates the weird thing on
  top". The header title changes to the thread name but the conversation body
  doesn't load.
- **Evidence:** [Img 4] header says "Line one" but the body shows the empty hero.
- **Root cause:** `selectThread`/`loadThread` updates `activeThreadId` (and thus the
  header label) but the messages either don't fetch/render, or render only after a
  forced re-render (ties to R3).
- **Target behavior:** Click a thread → its messages render immediately (with a
  brief loading state if needed); header, body, and composer all reflect the same
  thread.
- **Acceptance criteria:** [ ] Clicking any History entry shows that thread's
  messages within ~300ms; empty header/body mismatch never occurs.
- **Pointers:** `useAIChat.ts` `selectThread`/`loadThread`, `AIWorkspace.tsx`
  History dropdown.

#### U2 — Replace the floating centered "one-line" title
- **Severity:** P1 · **Area:** design
- **Symptom:** "Why do we have that thing on the top that says one line?" The
  centered header title is confusing (it also showed the stray "Line one").
- **Evidence:** [Img 4, 5, 7] centered "Line one" / "Ask Daylens".
- **Target behavior:** Adopt the **Raycast header**: thread title top-left (or as a
  proper thread header) with the **model name as a subline** [Img 19/20 "GPT-5.4
  mini"], always reflecting the loaded thread. Remove the centered floating label.
- **Acceptance criteria:** [ ] No centered floating title; title+model shown
  Raycast-style; always correct for the active thread.
- **Pointers:** `AIWorkspace.tsx` header.

#### U3 — Change the "new chat" icon
- **Severity:** P2 · **Area:** design
- **Symptom:** Owner: "the new chat icon needs to change."
- **Target behavior:** A clearer "new chat" affordance (Raycast uses a compose/
  pencil-in-square [Img 19]); pick an icon that reads unambiguously as "start a new
  chat" and pair with a tooltip + `⌘N`.
- **Pointers:** `icons.tsx` (`IconCompose`), `AIWorkspace.tsx`.

---

### P2 — Design: adopt the best of Raycast AI v2

Owner: "copy the best things from Raycast — their AI in Raycast v2 is peak."
[Img 19–28]. Concrete patterns to adopt (each can be its own item):

#### D1 — Time-grouped conversation list / sidebar
- Raycast [Img 20]: a left list with **Search chats**, **Recent**, **This Week**,
  **Month** groupings, current chat highlighted, and an **Archive**. Daylens today
  only has a "History" dropdown. Build a proper conversation list grouped by
  recency, searchable, with archive. Keep it collapsible to preserve the minimal
  feel.

#### D2 — Show the model name under the chat title
- [Img 19/20] "New Chat / GPT-5.4 mini". Show the resolved provider+model under the
  title (ties to U2 and R2 — it must be the *real* model).

#### D3 — Command palette for chat actions (⌘K)
- [Img 23] Raycast action palette: **Copy Response (⇧⌘C), Copy Chat, Add
  Attachment, Start Dictating, Regenerate (⌘R), Regenerate with Model (⇧⌘R), Good
  Response (⇧⌘=), Bad Response (⇧⌘-)**. Add an in-chat action palette with these,
  reusing the existing global palette infrastructure (`CommandPalette.tsx`) but
  scoped to the focused message. "Regenerate with Model" is especially useful given
  the provider/rate-limit story.

#### D4 — Per-chat settings panel
- [Img 24/25] Raycast "Chat Settings": **Title, Model, Additional Instructions,
  Reasoning Effort, Extensions/Skills (auto-discover)**. Add a per-thread settings
  panel: at minimum **Model override** and **Additional instructions**; "reasoning
  effort" where the provider supports it. This lets a user drop a flaky thread onto
  a higher-limit model without changing global settings.

#### D5 — Composer affordances: `@` tools, `/` commands, attachments, dictation
- [Img 19/27] Raycast composer: "Ask anything, **@ tools**, or **/ for
  commands**…" with **+** (attachment) and **mic** (dictation). Evolve the Daylens
  composer toward `/` commands (e.g. `/export`, `/report`, `/focus`) and `@`
  entity mentions (an app, a client, a day) that pin context. Attachments/dictation
  are lower priority.

#### D6 — Response action row + "turn this into…" actions
- [Img 21/22] Raycast offers post-answer actions ("turn this into a shorter
  message / a checklist / …") and a clean copy affordance on hover. Daylens has
  copy/rate/retry; add useful transforms (export this answer, save as artifact,
  turn into a report) surfaced contextually.

**Design acceptance for the whole D-series:** the tab still feels minimal at rest
(empty hero + composer), but power is one keystroke away (⌘K), and nothing about
providers/models/limits intrudes unless invoked.

---

### P2 — Natural-language / agentic search (new capability)

#### S1 — Make search understand natural language, powered by the selected provider
- **Severity:** P2 · **Area:** search + main + renderer
- **Symptom/Goal (owner):** "Rethink how the search works so you can search in
  natural language, and we'd use whatever provider is selected to find any
  information — make our search even more powerful."
- **Today:** keyword full-text search across sessions/blocks/browser/artifacts
  [Img 18] (`HistorySearch.tsx`, `ipc.search.all`, `search.test.ts`).
- **Target behavior:** Typing a natural-language query ("when did I last touch the
  autoencoders project?", "show me everything about the hackathon") routes through
  the selected provider to interpret intent, then queries local data (FTS +
  semantic/embedding ranking + the existing AI tools) and returns ranked,
  explained results — while **keeping instant keyword search as the fast path** for
  short literal queries. Search becomes a thin front-end over the same grounded
  tools the chat uses.
- **Acceptance criteria:** [ ] A natural-language query returns relevant results
  even when no exact keyword matches; [ ] literal/short queries stay instant
  (no provider call); [ ] results show *why* they matched.
- **Open questions:** embeddings provider & local index? cost per search (respect
  R1 throttling)? offline behavior when no provider configured (fall back to FTS).
- **Pointers:** `HistorySearch.tsx`, `src/main/` search handlers (`search:all`
  etc.), `aiTools.ts`, `insightsQueryRouter.ts`.

---

### P2 — Timeline AI actions (same provider plumbing)

#### T1 — "Re-analyze with AI" fails on provider quota
- **Severity:** P2 · **Area:** timeline + main
- **Evidence:** [Img 29] "Error invoking remote method 'db:rebuild-timeline-day':
  Error: AI re-analysis failed: Google Gemini quota exceeded…".
- **Target/criteria:** same throttle+retry (R1) and friendly-error+Retry (R4); the
  button should show a working/retrying state, not a raw error.
- **Pointers:** `db.handlers.ts` (rebuild-timeline-day), `Timeline.tsx`,
  `aiOrchestration.ts:308`.

#### T2 — "Regenerate label" fails the same way
- **Evidence:** [Img 30] "Error invoking remote method 'ai:regenerate-block-label':
  Error: Google Gemini request failed. Please try again."
- **Target/criteria:** as T1; inline retry on the block label editor.
- **Pointers:** `ai.handlers.ts` (regenerate-block-label), `Timeline.tsx`.

#### T3 — Tracking Controls: let users choose what gets tracked
- **Severity:** P1 · **Area:** capture + settings + onboarding
- **DECISION (owner, 2026-05-31): BUILD IT, OPT-IN, OFF BY DEFAULT.** Tracking
  Controls is a feature the user turns on, in onboarding or in Settings. It is not
  enabled by default, so default behavior is unchanged and existing users see no
  difference. This is consistent with `AI-PRODUCT-DIRECTION.md` D6 ("privacy is not
  the priority") — tracking remains the default, privacy is something the user opts
  into. Once the user enables Tracking Controls, the **"skip incognito/private
  windows" toggle defaults to ON** inside the feature (the one "like iPhone" default
  the owner asked for). Everything else starts empty until the user adds it.
- **What it is:** When enabled, the user controls what Daylens records. Some apps and
  sites are personal or private, and the timeline can otherwise surface page/app
  titles a user would rather keep out of their history and out of AI answers.
- **Target behavior:**
  1. **Master opt-in.** A single "Tracking Controls" switch, off by default, surfaced
     in onboarding and in Settings. When off, capture behaves exactly as today.
  2. **Per-app and per-site exclusions** (available once enabled). A user-managed
     list of apps and websites Daylens does not record, and retroactively
     hides/redacts from existing history. Excluded items never appear in the
     timeline, Apps view, AI answers, or search. Starts empty.
  3. **Skip private/incognito windows.** A toggle that, when on, detects
     incognito/private browsing (browsers expose this, e.g. the browser watcher's
     `incognito` flag) and skips capture entirely — no URL, no page title, no
     session. **Defaults to on once Tracking Controls is enabled.**
  4. **A quick "pause tracking" toggle** in the menu bar / header for ad-hoc privacy
     (works regardless of the master switch).
  5. **Delete from history.** Let users delete or redact already-recorded
     apps/sites/blocks so the data is gone, not just hidden.
  6. **Onboarding step.** Offer to enable Tracking Controls during onboarding (off
     unless the user opts in), and if enabled let them pick apps/sites to exclude.
  7. The existing domain classifier (`src/shared/domainPolicy.ts`) keeps doing its
     label-hygiene job; it is independent of this user-facing opt-in feature.
- **Acceptance criteria:**
  - [ ] With Tracking Controls OFF (default), capture is byte-for-byte unchanged from
        today. No new exclusions, incognito still captured as before.
  - [ ] Enabling it surfaces the exclusion list + incognito toggle; incognito toggle
        starts ON.
  - [ ] A user can add an app or site to the exclusion list; it disappears from the
        timeline/Apps/AI/search and stops being recorded going forward.
  - [ ] With the incognito toggle on, private/incognito browser windows produce no
        captured rows.
  - [ ] A "pause tracking" control exists and works.
  - [ ] Onboarding offers the opt-in; declining changes nothing.
- **Pointers:** `focusCapture.ts`, `browserContext.ts` (`incognito`), `tracking.ts`,
  `domainPolicy.ts`, `Settings.tsx`, `Onboarding.tsx`, settings store, history-delete IPC.

#### T4 — (Cross-ref) focus score correctness
- The focus score (e.g. "Score 43 / Focused 56m / Drift 8h 2m" [Img 29]) was
  previously flagged as wrong. Out of scope here; see existing memory/`docs`. Listed
  so it isn't lost.

---

### P2 — Model registry freshness

#### M1 — Audit and refresh the model catalog
- **Severity:** P2 · **Area:** `aiProvider.ts`
- **Symptom (owner):** Some models are "kinda out of date (including OpenAI and
  Anthropic ones)"; for Gemini the owner notes the **3.5 Flash** series exists while
  the app lists 3.1.
- **Today** (`src/renderer/lib/aiProvider.ts`): Anthropic `claude-opus-4-6 /
  sonnet-4-6 / haiku-4-5`; OpenAI `gpt-5.4 / -mini / -nano`; Google
  `gemini-3.1-pro-preview / gemini-3-flash-preview / gemini-3.1-flash-lite-preview`
  (default flash-lite); OpenRouter mirrors.
- **Target behavior:** Audit each provider's catalog **as of the implementation
  date**, update ids/labels/defaults to current GA (prefer GA over "preview" for
  defaults), and add a `// models reviewed: YYYY-MM-DD` marker so freshness is
  visible. Keep the default a fast, high-limit, low-cost model (helps R1).
- **Acceptance criteria:** [ ] Every listed model id resolves at its provider on
  the review date; [ ] a dated review marker exists; [ ] default model is a
  cheap/fast/high-RPM option.
- **Pointers:** `aiProvider.ts:20-160` (`AI_PROVIDER_META`), `getSelectedModel`.

---

### P3 — Distribution / signing (known, tracked)

#### C1 — Developer ID (mac) + code-signing cert (Windows)
- The in-app note is honest and good [Img 1–3]: ad-hoc mac signing means Daylens
  swaps the bundle with its own helper; Windows is unsigned (SmartScreen). This is
  the path to silent auto-update on mac and no SmartScreen on Windows. Tracked in
  `docs/WINDOWS_SIGNING.md` + memory; not a regression. Listed for completeness.

---

## 5. Suggested roadmap (phasing)

1. **Phase 0 — Make it reliable (P0):** R1 (call fan-out + throttle/retry), R2
   (single provider source), R3 (no stuck Thinking + timeout), R4 (friendly errors
   + retry). After this, the app *always answers or clearly recovers.*
2. **Phase 1 — Make it correct + private (P1):** T3 (Tracking Controls: exclusions,
   no incognito capture, onboarding), Q1/Q2 (grounding & intent), Q3/Q4 (follow-ups
   in-answer), Q5 (cheap good titles), U1 (history loads), U2 (header), then Q6
   (eval program to lock it in).
3. **Phase 2 — Make it powerful & beautiful (P2):** D1–D6 (Raycast patterns), S1
   (natural-language search), T1/T2 (timeline actions), M1 (models).
4. **Phase 3 — Polish:** U3 (icon), D6 transforms, C1
   (signing).

Phase 0 is the difference between "should not have shipped" and "solid." Do it
first and ship a 1.0.42 that is *reliable* before adding surface area.

---

## Appendix A — Screenshot index (as shared)

1. Settings, update banner "Daylens 1.0.41 is available", Install update. ✅ liked.
2. Update downloading "16% complete… keep using the app", progress bar. ✅ liked.
3. "Installing Daylens 1.0.41… close, finish, relaunch." ✅ install succeeded.
4. AI tab empty hero, header centered title "Line one" (mismatch with empty body),
   History + new-chat (pencil) top-right. → U1, U2, Q5.
5. "Summarize my last 7 days by project." stuck on **Thinking** + caret. → R3.
   (Thinking animation loved.)
6. Same prompt → **PROVIDER ERROR** rate-limit card with raw "remote method"
   prefix. → R1, R4.
7. Empty hero again, header "Ask Daylens", composer note "genuinely faster to
   type". ✅ composer.
8. Settings → Connection: Gemini connected; model dropdown **Gemini 3.1 Pro /
   3 Flash / 3.1 Flash-Lite (selected)**. → M1, R2.
9. (owner note) the clicked answer appeared only after navigating away & back. →
   R3.
10. "What did I work on today?" → clean grounded breakdown + 2 follow-up chips. ✅
    quality bar.
11. Follow-up "so am basically studying yeah?" → rate-limit error. → R1.
12. "what???" → apology/clarify; later the same prompt works. → R1 intermittency;
    thread memory ✅.
13. (owner note) follow-ups inconsistent. → Q4.
14. "what model are you?" → "routed through Google Gemini (gemini-3.1-flash-lite-
    preview)" + **dumb templated follow-ups about "Google Gemini"**. → Q3, D2.
15/16. "Which files appeared in Safari?" → returns YouTube **pages** (not files);
    "How long on YouTube?" → "**25 seconds on youtube.com**" (contradicts 3h45m). →
    Q1, Q2.
17. Continuation of the contradiction. → Q1.
18. Local history search "christian" → web result cards w/ highlight. ✅ keep; → S1.
19–28. **Raycast AI v2** inspiration: new chat + model subline (19), time-grouped
    sidebar (20), response + copy affordance + "turn into…" (21/22), **⌘K action
    palette** (23), **per-chat settings** model/instructions/reasoning/extensions
    (24/25), tool-use "Read page" + summary formatting (26), send/stop (27),
    auto-title "Friendly Greeting" + minimal answer (28). → D1–D6, U2/U3.
29. Timeline "Re-analyze with AI" → "db:rebuild-timeline-day … Gemini quota
    exceeded"; a private page surfaced in a label; focus score 43. → T1, T3, T4, R4.
30. Timeline "Regenerate label" → "ai:regenerate-block-label … Gemini request
    failed". → T2, R4.
31. **First message of a brand-new chat** ("in detail tell me everything i did on
    this laptop") → immediate PROVIDER ERROR rate-limit, before any working answer.
    Worst-case cold first impression; broad "tell me everything" prompts fan out
    hardest. → R1 (and R4 for the raw error text).

## Appendix B — Key files

- **Chat UI:** `src/renderer/views/insights/` — `AIWorkspace.tsx`, `useAIChat.ts`,
  `MessageList.tsx`, `AICompose.tsx`, `HistorySearch.tsx`, `StreamingMessage.tsx`,
  `streamingStore.ts`, `markdown.tsx`, `icons.tsx`, `types.ts`. Entry:
  `src/renderer/views/Insights.tsx` (re-export).
- **AI engine:** `src/main/jobs/aiService.ts` (`sendMessage`, tool loop
  `MAX_TOOL_CALLS=7`, `generateSuggestedFollowUps`, `maybeRenameWeakThread`,
  rate-limit copy ~5358), `src/main/services/aiOrchestration.ts`
  (`preferredProviderForJob`, `friendlyProviderError`, `isQuotaOrAuthError`),
  `src/main/services/aiTools.ts`, `src/main/lib/insightsQueryRouter.ts`,
  `followUpSuggestions.ts`, `followUpResolver.ts`.
- **IPC:** `src/main/ipc/ai.handlers.ts` (`SEND_MESSAGE`, `REGENERATE_BLOCK_LABEL`),
  `src/main/ipc/db.handlers.ts` (`REBUILD_TIMELINE_DAY`).
- **Models/settings:** `src/renderer/lib/aiProvider.ts`,
  `src/main/services/settings.ts`, `src/renderer/views/Settings.tsx`,
  `src/renderer/components/ConnectAI.tsx`.
- **Search:** `HistorySearch.tsx`, `search:*` handlers, `tests/search.test.ts`.
- **Eval harnesses:** `tests/ai-behaviour/`, `tests/ai-bench/`,
  `tests/routerHardPromptBenchmark.ts`.
