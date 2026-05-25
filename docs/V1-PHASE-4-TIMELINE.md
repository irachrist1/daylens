# Daylens v1.0 — Phase 4: Timeline redesign

Author: codebase audit pass, 2026-05-15. Status: spec only, not implemented.

Scope: the Timeline tab. Day view block list, "shape of the day" right rail, block-detail right rail, week view. Treats the existing implementation as duct-tape and proposes a single coherent target. Code references are absolute paths with line numbers; every claim is marked `code-proven`, `inferred`, or `runtime-validated`.

Read order before touching this spec:
1. `docs/AGENTS.md` (what Daylens is)
2. `docs/AI-PRODUCT-DIRECTION.md` (P0 directives D1-D7 — non-negotiable)
3. `docs/PRODUCT-SPEC.md` (the five views and the bar)
4. `docs/V1-PHASE-0-READ.md` (Layer 1 audit; Layers 2-3 not yet done — this spec depends on them)

---

## 1. Code-grounded snapshot — what's actually true today

### 1.1 The block-label algorithm does not exist as one rule. Three competing fallbacks share the job.

`code-proven`. The block label that renders on each timeline card is produced by `userVisibleBlockLabel` at `src/shared/blockLabel.ts:41-61`. It is a five-step priority chain:

```
override.trim()
  → current.trim() if isUsefulLabel
  → aiLabel.trim()  if isUsefulLabel
  → ruleBasedLabel.trim() if isUsefulLabel
  → first website domain (capitalised stem)
  → 'Untitled block'
```

`isUsefulLabel` (`src/shared/blockLabel.ts:22-33`) rejects a fixed `GENERIC_LABELS` set and any string containing ` | ` (treated as raw tab-title soup). That filter is the only quality gate at the render boundary.

`block.label.current` is itself the output of a second priority chain in `finalizedLabelForBlock` at `src/main/services/workBlocks.ts:1541-1590`:

```
override
  → artifactLabel       (preferredArtifactLabel)
  → workflowLabel
  → aiLabel             (only if usefulBlockLabel passes)
  → ruleLabel
  → userVisibleLabelForBlock(block) -> 'Untitled block'
```

Then `userVisibleLabelForBlock` at `src/main/services/workBlocks.ts:2018-2038` is a **third** fallback chain that the renderer can also reach indirectly:

```
overrideLabel ?? aiLabel (if not GENERIC)
  → ruleBasedLabel (if not GENERIC)
  → 'site + site'
  → first site
  → 'Untitled block'
```

The renderer reaches it transitively because `finalizedLabelForBlock` writes its output into `block.label.current`, which is then re-filtered by `userVisibleBlockLabel`. Two different "useful" definitions exist: `isUsefulLabel` (renderer) and `usefulBlockLabel` (workBlocks) — the latter adds an extra `labelLooksToolOnly` check at `src/main/services/workBlocks.ts:1476-1495`. They disagree.

**Net effect.** A block label can be:
- a clean artifact title ("Diagramming and note-taking" — sourced from `documentRefs[0].displayTitle` via `preferredArtifactLabel`),
- a raw page-title fragment from a website-aware composer ("Microsoft Intune admin center", "Active users — Microsoft 365 admin c…" — sourced from `websiteAwareLabel` at `src/main/services/workBlocks.ts:686-702` writing back to `ruleBasedLabel`),
- a lazy domain stem ("Safari browsing session" — emitted when no rule label and no useful artifact, via the `'Site + Site'` branch in `userVisibleLabelForBlock`),
- `Untitled block` (when every prior step returned generic-or-empty).

This is the user's complaint, structurally explained: three fallback chains, two definitions of "useful," no single owner. `code-proven`.

### 1.2 Block summaries are templated, not narrative

`code-proven`. The visible block summary line is `blockNarrative(block) ?? blockShortSummary(block)` (`src/renderer/views/Timeline.tsx:103-140, 385`). `blockNarrative` reads `block.label.narrative` (an AI-generated string, when available). `blockShortSummary` is a deterministic template:

```ts
// src/renderer/views/Timeline.tsx:115-140
'{duration} on {artifact} in {appA} and {appB}.'
'{duration} across {appA} and {appB} with {siteA} and {siteB}.'
'{duration} mostly in {appA} and {appB}.'
'{duration} across {siteA} and {siteB}.'
'{duration} of {category}.'
```

This is exactly the "1h 0m on Perplexity in Safari and Dia" shape the user called out. The fallback fires when the AI narrative hasn't landed yet. The AI narrative path is `generateWorkBlockInsight` in `src/main/jobs/aiService.ts` (re-exported via `blockInsight.ts`), which is scheduled by `scheduleTimelineAIJobs` and runs eventually-consistent against the DB.

### 1.3 The "shape of the day" rail is two things stitched together

`code-proven`. `DaySummaryInspector` at `src/renderer/views/Timeline.tsx:466-636` renders:

1. **An AI paragraph** (`recap.summary`) loaded via `ipc.ai.generateDaySummary(date)` at `src/main/jobs/aiService.ts:3322-3397`. This is the line that produced "captured around ibm quantum chips for 59m" / "captured around Perplexity for 43m" — the AI prompt is told to "Prefer the structured workIntent signal" (line 3342). The structured workIntent's `subject` comes from `chooseSubject` in `src/shared/workIntent.ts:364-435`, which for browsing-dominant blocks falls through to `domainCandidate` (a raw domain label) or to `pageCandidate` (a raw search/feed page title). So the AI is dutifully reporting the most prominent search-query-or-domain as the subject. The hallucination is upstream, not in the prompt.
2. **A deterministic "What mattered" panel** (`callouts`) — `pickLongestFocusedBlock` + `pickBiggestDetour` at `src/renderer/views/Timeline.tsx:485-500`. Each callout is rendered with the block label produced by the broken chain in §1.1.

When the AI call fails, `fallbackDaySummary` (`src/main/jobs/aiService.ts:3183-3217`) emits sentences shaped exactly like the user's complaint:

> "A large share of today was captured around ibm quantum chips for 59m."

That string is `leadSentenceForIntent(primary)` (`src/main/jobs/aiService.ts:2877-2912`), called when `intent.role === 'research'`. It is a templated fallback that surfaces `intent.subject` raw — which for a browsing day is a search query.

### 1.4 Category badges are unconditional

`code-proven`. `src/renderer/views/Timeline.tsx:356-367` renders the dominant category as a coloured pill on every block, including `UNCATEGORIZED` / `BROWSING` / `DEVELOPMENT`. No suppression rule.

### 1.5 "Attribute to client" lives in the per-block inspector

`code-proven`. `src/renderer/views/Timeline.tsx:792-895` renders the attribute input unconditionally on every selected block, regardless of whether the user has any clients. The clients list is fetched (`ipc.attribution.listClientsDetailed()`) and used only to populate a datalist for autocomplete; the input itself is always shown.

### 1.6 Gaps render with the same visual weight as work blocks

`code-proven`. `TimelineRow` for gap segments (`src/renderer/views/Timeline.tsx:272-294`) renders a 104px clock column + a 1px-bordered text row with vertical padding `10px+10px` plus row gap `14px` (`src/renderer/views/Timeline.tsx:1716`). A real work block uses the same row gap and a 14px+14px-padded card. The reading eye sees one continuous list with the same y-rhythm. The current `compressTimelineSegments` (`src/renderer/views/Timeline.tsx:157-196`) groups runs of small gaps into a single `gap_group` row, but anything ≥75 minutes anchors as its own row — so a 76-minute machine-off gap displays as one big sibling of a 30-minute deep-work block.

### 1.7 The right rail mixes intent-inferred prose with raw evidence

`code-proven`. `BlockInspector` (`src/renderer/views/Timeline.tsx:638-1039`) renders, in order, on every selected block:

1. Block title (clamped 3 lines)
2. Clock range + duration
3. AI narrative (if any)
4. Block-label override input + Save/Reset
5. Attribute-to-client input
6. Apps used (up to 6, with category labels)
7. Key artifacts (up to 6, openable)
8. Websites (chips)
9. Workflow clues (up to 4)

That's nine sections per click, every block.

### 1.8 Real label examples from the live DB

`code-proven` (DB sampled). The current DB has rotated tables. The live install on this machine has `work_context_blocks` (legacy, last filled `2026-04-25`) plus a newer projection pipeline whose `timeline_blocks` table is absent from the current schema (the `getTimelineDayPayload` path rebuilds blocks at read time from `app_sessions` rather than serving them from a persisted projection — see `src/main/services/workBlocks.ts:2088-2119`). The screenshots themselves are the most current ground truth and were used in §1.1 above. **Runtime claim**: the persisted projection table the spec refers to needs verification against the actual install — see open question §11.5.

### 1.9 Performance signal in Timeline.tsx

`code-proven`:
- The component is one 1,748-line file with stateful subcomponents declared inline. Inline `style={{ ... }}` literals on every node defeat React's referential-equality fast path.
- `useProjectionResource` polls every 30s for the live day (`Timeline.tsx:1420`), each poll fetches the **whole** day's segments+blocks payload regardless of what changed.
- `compressTimelineSegments` runs on every payload change (`Timeline.tsx:1470-1473`) — fine for ~50 segments, but the algorithm is not memoised by segment identity.
- `WeekView` issues **7 parallel** `ipc.db.getTimelineDay` calls per week-start change (`Timeline.tsx:1067`). Each call re-derives the entire day projection from raw sessions. There is no shared cache between Day view and Week view.
- `DaySummaryInspector` fires an AI call (`ipc.ai.generateDaySummary`) on every day change (`Timeline.tsx:514-523`). The result is memo'd in a module-level `Map`, but the cache is not invalidated by live block changes during the day — meaning today's rail can show a stale summary that pre-dates the latest hour of work.
- Every selected-block change re-fetches the clients list (`Timeline.tsx:650-654`) because the effect depends on `block?.id` rather than running once.

### 1.7b Live block label uses the same broken chain

`code-proven`. `currentLiveLabel` (`Timeline.tsx:210-213`) is `userVisibleBlockLabel(liveBlock)`. So "Live now: Untitled block" in the header strip is the §1.1 chain returning `Untitled block` because nothing useful has surfaced yet for the live block — the screenshots show this exact failure.

### Pushback

You will disagree that all three label-source layers are doing equivalent work. You will say one is defensible (artifact-first deterministic) and the others are deserved hedges. I am claiming they are not coordinated — that one is a Phase-2 attempt, one is a legacy fallback, and one is renderer-side belt-and-braces, and that the union of three independent guesses *is* the duct-tape state.

---

## 2. The block-naming algorithm — one rule

### 2.1 The bar

Every visible block label must satisfy D1 (activity, not app). The screenshot named `Diagramming and note-taking` is the bar. The following are **never acceptable as the visible label**:

- Literal page-title fragments with truncation ("Active users — Microsoft 365 admin c…")
- Tab-title soup with pipes ("W2_Reading | Intro to ML | Perusall")
- App-only labels when the block had any artifact or page evidence ("Safari browsing session")
- The literal string `Untitled block` when any block had ≥30s of foreground time
- `Live now: Untitled block` — the header strip must hide the live indicator when the live block has no useful label yet, or substitute "Live now in {AppDisplayName}"

### 2.2 One rule

Replace the three competing chains (`userVisibleBlockLabel`, `finalizedLabelForBlock`, `userVisibleLabelForBlock`) with a single function `composeBlockLabel(block, ctx)` owned by Layer 3 (Structure), called once at projection write time, persisted, and read everywhere unchanged. Definition:

```
composeBlockLabel(block):
  1. override                                  -> source: 'user',     conf 1.0
  2. AI label (if specific, length 3-60,       -> source: 'ai',       conf >= 0.7
       not GENERIC, not tab-title soup,
       not ToolOnly, not bare domain)
  3. dominantArtifact.activityLabel            -> source: 'artifact', conf 0.85
     (artifact title + verbed prefix, see §2.3)
  4. workflow.label (if signature confidence   -> source: 'workflow', conf 0.8
       >= 0.7 and not ToolOnly)
  5. category-shaped activity phrase from      -> source: 'derived',  conf 0.5
       window-title timeline + page-kind
       distribution (see §2.4)
  6. "{Activity verb} in {AppDisplayName}"    -> source: 'app',       conf 0.3
     when at least one foreground app
     produced ≥2 minutes
  7. "Brief activity"                          -> source: 'thin',     conf 0.1
     when block is <2 min total or all
     evidence is system/uncategorized
```

No "Untitled block" output. Step 7 is the *only* unnamed-block shape, and it is reserved for blocks that should arguably not have been formed in the first place (a Layer 2 Clean signal).

### 2.3 Activity-verbed labels from artifacts

A raw artifact title is *not* an activity. `Microsoft Intune admin center` is a destination, not what the user did. The artifact path must prepend or fuse a verb derived from the artifact kind:

| Artifact kind | Default verb | Example output |
|---|---|---|
| `doc` / `sheet` / `slide` | Drafting / Editing | "Drafting Q2 plan" |
| `pr` / `repo` / `issue` | Reviewing / Coding | "Reviewing daylens#142" |
| `admin_console` (settings panes, M365, GCP, AWS, Stripe) | Administering | "Administering Microsoft 365 users" |
| `course` / `learning` | Studying | "Studying Intro to Machine Learning" |
| `search_results` | Researching | "Researching {top entity from queries}" |
| `meeting_app` (Granola, Meet, Zoom) | Meeting | "Meeting on {topic / participant}" |
| `chat` (Slack, Discord) | Coordinating | "Coordinating in #{channel}" |

The verb table lives in Layer 3 and is overridable per canonical-app. Determinism is the default; the AI step only fires when no artifact/workflow signal is strong enough.

### 2.4 Category-shaped fallback (no artifact, no workflow)

When the block has no useful artifact and no workflow signal, but does have a clean window-title timeline (Layer 2 dependency), derive a short noun-phrase from the dominant page-kind:

- `search`-dominant browsing block → "Researching {entity}" where entity is the most-repeated noun-phrase across search queries, with stopwords/operators stripped. **Never** the raw query string. If no stable entity emerges, fall through to step 6.
- `feed`-dominant block (Twitter/X, LinkedIn home, Reddit home) → "Reading {feed name}" not "X browsing session"
- `mailbox`-dominant → "Going through inbox in {App}"

### 2.5 Max length and truncation

- Soft max **48 characters**; hard max **64**.
- Truncation with ellipsis is acceptable *only* when the source is `artifact` and the suffix being clipped is a duplicate of context already shown elsewhere (e.g. `— Course | Perusall` is removable because the app+context appears in the chips row).
- A label that requires truncation to fit is a label that wasn't worth showing — prefer the verbed-shorter form ("Administering Microsoft 365 users" over "Active users — Microsoft 365 admin c…").

### 2.6 LLM vs deterministic split

- Deterministic owns 80%+ of labels. The artifact, workflow, and verbed-category paths cover almost every block with real evidence.
- The AI step (2) is **enrichment**, not the primary source. It runs eventually-consistent and is allowed to overwrite a deterministic label only when the AI label scores higher on a deterministic quality check (`isVerbHeaded` + `mentionsNamedEntityFromEvidence` + `lengthFits`).
- The AI never invents an entity not present in evidence. The "houses album" / "ibm quantum chips" failure pattern is a prompt that's told to "Prefer the structured workIntent signal" but receives `subject = search query string` — fix is upstream, not in the prompt.

### Pushback

You will push back on the verb table — that it's English-only, that "Administering" sounds corporate, that "Drafting" claims authorship the user didn't actually do. You will also push back that step 6 ("{Activity} in {App}") still leaks the app name into the label and weakens D1. My lean: the activity verb is mandatory; the app-only step 6 is the floor, and step 7 must literally never render in v1 (if it does, that block should have been merged into an adjacent gap upstream).

---

## 3. Block sizing and visual weight

### 3.1 The current screen weights gaps like work

`code-proven`. Same row template (`104px | 1fr`), same vertical rhythm. A 16-minute "Untracked gap 16m" sits next to a 27-minute Perusall block at roughly equivalent visual size. Reading the timeline becomes a scan of horizontal bars that all feel equal.

### 3.2 Target

The reading hierarchy on the day view should be:

```
1. Live block (if any)            — slightly elevated, accent border, sticky?
2. Real work blocks               — full cards with label, summary, evidence
3. Compressed gap groups           — single line, dim, no card
4. Machine-off long stretches      — single dimmer line, no card, italic
```

Rules:

- **Gaps under 5 minutes are not rendered at all.** Currently they show as a single chip-line. Drop them; the next block's start time and the prior block's end time make the gap implicit.
- **Gaps 5-30 minutes** render as a 1-line dim row, height ~22px, **no border**, no card. The 104px clock column is preserved for navigation, but the right column is a single 12px secondary-colour line: "16 min untracked".
- **Gaps 30 minutes - 2 hours** render as a 1-line row at the same dim weight, label "Idle 47m" or "Away 1h 12m" depending on signal source.
- **Machine-off ≥ 2 hours** renders as a single 1-line italic row: "Machine off · 09:30 PM – 06:54 AM". No card. Compressed into one row even across day-boundary suspends.
- **Long sequences of small gaps (>2 in a row, total >75 min)** stay grouped as today — but with no border, no card, no chips — just one dim line: "Quiet stretch · 1h 32m mixed away and idle".
- **Real work blocks** keep the card treatment but get a more deliberate vertical rhythm: 14px top/bottom padding becomes 16px, gap between blocks rises from 14px to 18px. This makes 4-5 blocks feel like the structure of the day, not 25 rows of mixed importance.
- **Live block** gets a left accent strip 4px wide (not 3) and a faint top-row "Live · started 11:29" eyebrow above the title.

### 3.3 Density modes

A "Dense" toggle in the top-right is acceptable but not in v1 scope. Default v1 is the spaced layout above.

### Pushback

You will say collapsing sub-5-minute gaps loses information — that a 4-minute idle between two coding blocks is real fragmentation evidence. My lean: that information lives in the per-block "switches" / "context cost" metric (Layer 3 dependency), not in the visual timeline. The visual timeline is for reading the day; per-block stats are for diagnosing it. Decision point §11.

---

## 4. Summary generation

### 4.1 What a block summary must answer

A block summary is a **single 1-2 sentence paragraph** answering, in this order:

1. **What was the user actually doing?** (D1)
2. **Where in the work does it fit?** (continuation of yesterday, first block of the day, return from a break)
3. **What artifact or named thing moved forward?** (specific filename, page title, issue number, doc title, query subject if research)

It must **not**:

- Enumerate apps as the main claim ("1h 0m on Perplexity in Safari and Dia").
- Quote app-version or build numbers from window titles.
- Use the phrase "captured around" — that is a prompt artifact from the workIntent fallback; ban it.
- Include focus percentages, scores, or any number that requires a denominator the user didn't ask for.

### 4.2 The shape

Templates by activity kind:

| Activity kind | Shape |
|---|---|
| Coding | "{N}m on {repo or file}: {one-sentence what-changed if available, else what-touched}." |
| Reviewing | "Reviewed {pr/issue} in {N}m." |
| Drafting/writing | "Drafted {doc title} over {N}m." |
| Researching | "Read around {topic} for {N}m. Most time on {top 1-2 specific page titles, not search query strings}." |
| Meeting | "{N}m meeting{ on topic if title known}." |
| Coordinating (chat/email) | "{N}m in {channel/inbox}; most time on {top thread if identifiable}." |
| Admin | "{N}m in {console name} — {sub-section if identifiable}." |
| Thin / ambiguous | One sentence: "{App display name} for {N}m; details thin." |

### 4.3 Minute-level precision (D3)

The clock range and the duration on the card must be wall-clock minute-aligned and must agree:

- `start_time` and `end_time` are floored/ceiled to the minute boundary at projection write time.
- `duration = end_time - start_time` in whole minutes. **Never** sum `session.durationSeconds` for the "displayed span" — that produces the 13m-vs-14m drift the renderer comments at `Timeline.tsx:108-116` already acknowledge.
- `blockDisplayedSpanSeconds` is the correct source; `blockActiveSeconds` is the *active engagement* signal and is for analytics, not for the card.

### 4.4 Deterministic vs LLM split

Same shape as labels:

- 80%+ deterministic from artifact+page+session evidence.
- AI overwrites only when (a) `isUsefulNarrative` passes (mentions a named entity from evidence, contains a verb, ≤2 sentences), (b) AI summary disagrees with the deterministic one on a substantive content claim, not on phrasing.
- AI calls are batched per day, not per block, when possible. `generateWorkBlockInsight` per-block is wasteful for a 22-block day.

### Pushback

You will push back on the per-kind template list — that it is too rigid and will produce robotic prose at scale. My lean: at v1, robotic-but-correct beats voicy-but-wrong. The voice contract from `PRODUCT-SPEC.md` (banned vocab, no motivational filler, no "let's dive into") applies to the AI step, not to the deterministic templates. The templates are the floor.

---

## 5. Right rail contents

### 5.1 Current sections (code-proven)

`BlockInspector` (`src/renderer/views/Timeline.tsx:638-1039`):

1. Title + clock range
2. AI narrative
3. **Block-label override** (text input + Save/Reset)
4. **Attribute to client** (text input + autocomplete + Attribute/Clear)
5. **Apps used**
6. **Key artifacts**
7. **Websites**
8. **Workflow clues**

`DaySummaryInspector` (`src/renderer/views/Timeline.tsx:502-636`) shows when no block is selected:

A. "The shape of the day" AI paragraph
B. "What mattered" callouts (Longest stretch, Biggest detour)

### 5.2 Target

**Day rail (no block selected):**

| Section | Fate |
|---|---|
| "The shape of the day" paragraph | Keep, but pin to the deterministic+AI hybrid in §4. Ban "captured around". Cite at least one named block label by name. |
| "What mattered" callouts | Keep. Always show longest focused stretch. Show biggest detour only when focused total ≥ 30 min (this rule already exists at `Timeline.tsx:490-500`, fine). Add one more callout when applicable: "Started" (first work block of day) or "Wrapped" (last block) when the time is unusual for the user's pattern (multi-day signal, not in v1). |
| Compare-to-yesterday line | New. One sentence at the bottom: "Yesterday you had 4 blocks by this time." Hidden when prior data is thin. |

**Block rail (block selected):**

| Section | Fate |
|---|---|
| Title + clock range | Keep. Title comes from §2's one-rule chain. |
| AI narrative | Keep, but flow from §4. |
| Block-label override input | Move below the Apps/Artifacts evidence, not above. Rationale: 99% of the time the user is reading, not relabelling. The override input is a power-user affordance, not the lead. |
| Attribute to client | **Conditional on persona — see §7.** When shown, also move below evidence. |
| Apps used | Keep, but cap at 4 (not 6). Drop the category sub-label under each app — it's noise. |
| Key artifacts | Keep, cap at 5. This is the most useful section in the rail today. |
| Websites | Merge into Key artifacts as a sub-group; do not give it a top-level section. Domain chips show under the artifact list. |
| Workflow clues | **Hide in v1.** The current output ("Granola + Dia") reads like a developer trace, not user-facing context. When workflow signatures gain a usable label vocabulary (Layer 3 dependency), reintroduce. |

### 5.3 New conditional sections

- **Idle / context-switch line** when the block had >6 app switches: "8 switches between Cursor, Dia, Slack" — 1 dim line, no section header. Surfaces fragmentation without a focus score.
- **Continuation pointer** when the block's artifact set overlaps ≥50% with the previous or next block: "Continued from 10:29 AM" — clickable to that block. Multi-block context is the point of the Timeline tab; today it is invisible.

### Pushback

You will push back on dropping Workflow clues — you spent real code on `workflow_signatures` and removing it from the rail looks like throwing the work away. My lean: the data stays, the visible section dies until the label vocabulary is good enough to pass `isVerbHeaded`. "Granola + Dia" is two app names with a plus.

---

## 6. Category badges

### 6.1 Today

Category pill renders on every block, every state. The colour-coded uppercase pill ("BROWSING", "DEVELOPMENT", "UNCATEGORIZED") is the loudest non-title element on every card (`Timeline.tsx:356-367`).

### 6.2 Decision: remove the pill, keep the accent

- The 3px left accent strip (`Timeline.tsx:340-347`) is enough. Colour-coded by category. No words.
- The category remains queryable, filterable, and present in analytics.
- The pill text adds zero information that the accent + label + app icons don't already convey, and it shouts at the user. Especially "UNCATEGORIZED" — the user cannot act on it.

### 6.3 Live badge

- Replace the floating "LIVE" pill with a single small green dot inside the left accent strip + an eyebrow "Live · started 11:29".

### Pushback

You will say the pill helps scan-readability across a long day. My lean: the accent colour does that job better. If a colourblind user needs a text affordance, the title-bar summary strip can be filterable by category instead.

---

## 7. Persona-aware UI — Attribute-to-client gate

### 7.1 Today

Unconditionally rendered (`Timeline.tsx:792-895`). The clients list is fetched (`ipc.attribution.listClientsDetailed()`) and the input shows regardless. Default install: zero clients = empty datalist + visible "Type a client name…" input on every block. Cognitive load for users who will never attribute.

### 7.2 The gate

Three signals, OR-combined:

1. **Existing clients.** `clients.filter(active).length >= 1`. If yes, show. (Current implicit signal — but used only to fill autocomplete, not to gate visibility.)
2. **Onboarding declared "freelancer / consultant"** (Layer 1 dependency — `user_profiles` table exists but is not surfaced as a persona signal today). Code-proven existence; runtime-validation needed for what fields are actually populated. Add a `persona` enum field.
3. **User has manually attributed any session in the last 90 days.** Even if all clients later deleted, the affordance stays accessible.

If none of (1)-(3): hide the Attribute-to-client section entirely. Provide a small ghost-button affordance in Settings → "Track work for clients?" to opt in. Once opted in, the section becomes visible on all blocks.

### 7.3 Where attribution lives

When hidden in the rail, the affordance is *not gone*, just relocated:

- Per-block right-click / context menu: "Attribute this block to…". Always present.
- Settings → Clients → "Add client" — adds the first client, which immediately unhides the rail section retroactively for all future block selections.

### Pushback

You will push back on hiding it by default — that it is the v1.5 monetization narrative (consultants), and hiding it lowers discoverability. My lean: Daylens is for one person (PRODUCT-SPEC.md design principle 05). The reader of every screen is the person who made the data. A student should not see a "Type a client name…" input above their study block. If discoverability is the worry, the Settings entry covers it; the AI surface can also surface the affordance contextually ("you've spent 4h on Andersen — want to track it as a client?").

---

## 8. Performance bottlenecks

### 8.1 Cascade renders from inline styles

`code-proven`. `Timeline.tsx` declares `style={{ ... }}` literally everywhere — every nav button, every chip, every row. React re-creates these objects on every render; downstream `memo()` boundaries (none currently exist in this file) would all blow through. Fix: extract a stylesheet (CSS module or static `const` objects) once, reference by name. **Expected impact**: large. The day view re-renders on every 30s live-poll tick.

### 8.2 Full-day projection on every poll

`code-proven`. `useProjectionResource` at `Timeline.tsx:1416-1422` calls `ipc.db.getTimelineDay(date)` every 30s while today is active. The handler at `src/main/ipc/db.handlers.ts:199` calls `getTimelineDayPayload` which:

- Re-reads all `app_sessions` for the day (`getSessionsForRange`)
- Re-reads all `website_visits` for the day
- Re-runs `buildBlocksForSessions` and `finalizedLabelForBlock` for every block, **including blocks that have not changed**
- Re-derives segments from activity events

For a typical mid-day state with 18 blocks, this is ~50ms of synchronous DB+CPU work per tick on the main process, with the result serialised back across IPC. The renderer then re-renders the entire 1,748-line tree because the `payload` reference changes.

Fix targets:

1. Layer 3 must own a **persisted** block projection (`timeline_blocks` table referenced in legacy code paths — see §1.8 — needs to exist and be authoritative). The handler reads from it directly.
2. The handler accepts an `IfChangedSince` parameter; renderer caches the last `computedAt` and skips re-render when nothing moved.
3. Live-block ticking is a *separate* IPC channel (`live-block:update`) that pushes only the live block's id + label + endTime. The full payload is fetched on day-load only.

### 8.3 Week view fires 7 parallel day payloads

`code-proven`. `Timeline.tsx:1067` `Promise.all(dates.map((date) => ipc.db.getTimelineDay(date)))`. For weeks with 7 active days this triggers seven full projections; the main process is single-threaded. Fix: a `getTimelineWeek(weekStart)` IPC that batches the projection in one DB transaction, or a weekly rollup table that the Week view reads (the `weekly_rollups` table exists — `runtime-validated` it has 0 rows on this machine, so it is allocated but unused).

### 8.4 AI day-summary cache is non-invalidating

`code-proven`. `daySummaryRecapCache` at `Timeline.tsx:466` is a module-level `Map<string, AIDaySummaryResult>` that is never cleared during a session. For *today*, this means the right-rail prose can be hours stale by mid-afternoon. Fix: cache key includes `blockCount` and `totalSecondsBucket` (5-minute rounding) so genuinely-new state busts the cache; otherwise stays warm.

### 8.5 Clients refetch on every block select

`code-proven`. `Timeline.tsx:650-654` re-runs `ipc.attribution.listClientsDetailed()` whenever `block?.id` changes. Should be once per Timeline mount, refreshed on attribution-changed event only.

### 8.6 Inline subcomponents recreate

`code-proven`. `DaySummaryInspector`, `BlockInspector`, `TimelineRow`, `GapGroupRow`, `WeekView` are defined inside `Timeline.tsx` at module scope so they survive parent re-renders. But several of them hold their own `useEffect` chains that re-fire on parent re-render of props because the prop objects are new references each tick. Fix: split into separate files + `memo()` with explicit equality on the relevant fields.

### 8.7 IPC payload shape

The `DayTimelinePayload` includes the full `sessions` array, the full `websites` array, full `segments`, full `blocks`. For a 22-block day this is hundreds of KB of JSON serialised per call. The renderer uses `sessions` only indirectly (via `block.sessions` for duration math). Strip what isn't read.

### Pushback

You will say "this is a renderer that re-fetches every 30s for live state, of course it costs CPU — that's the design." My lean: the 30s live tick should never re-derive non-live blocks. Make the projection genuinely persisted and the live tick a delta-only push.

---

## 9. Upstream dependencies (Layer 2 Clean + Layer 3 Structure)

This spec is not implementable on the current data layer. The following are required outputs of Layer 2 and Layer 3:

### 9.1 From Layer 2 (Clean)

| Output | Why |
|---|---|
| **Per-session cleaned window-title timeline** | The single `windowTitle` per `app_sessions` row (Phase-0 finding §V1-PHASE-0 item 1) makes activity-verbed labels impossible for any multi-file editor or multi-tab browser session. We need the *sequence* of window titles per session, denoised. |
| **Page-kind classification** | `classifyPage` in `src/shared/workIntent.ts:234` does this at read time. Move it to Layer 2 and persist `page_kind` on the visit row. The Timeline renderer should never compute classification. |
| **Browser SPA route detection** | Where window-title changes without URL changes (Gmail, Linear, Notion, Slack), Layer 2 must emit "logical pages" per session so artifacts can be extracted. Today they collapse into one URL. |
| **Sub-poll-interval suppression** | A 7-second tab visit and a 12-second one are treated identically; both anchor candidate artifacts. Layer 2 should weight artifact extraction by dwell time so the artifact list isn't dominated by drive-by tabs. |
| **Idle vs short-break vs long-break classification** | The "compress sub-5-minute gaps" rule in §3.2 requires Layer 2 to label gaps with provenance so the renderer can drop the small ones safely. |

### 9.2 From Layer 3 (Structure)

| Output | Why |
|---|---|
| **A single `timeline_blocks` projection table** with one row per (date, start_time) and a persisted, signed `label_current` written by the one-rule `composeBlockLabel` (§2). | Today the projection is recomputed every read. The §8.2 perf fix and the §2 single-rule label both require this. |
| **`block_dominant_entity` field** | The verbed-activity templates (§2.3) need to pick one canonical entity (a repo, a doc, an admin console, a topic) per block. This is not the same as `topArtifacts[0]` — it's the entity that ties the block together. Compute once, persist. |
| **`block_activity_kind` field** | One of: `coding`, `reviewing`, `drafting`, `researching`, `meeting`, `coordinating`, `admin`, `learning`, `thin`. Drives §4.2 template selection. Computed from the cleaned window-title timeline + page-kind distribution. |
| **`block_continuation_of` field** (nullable block_id) | For §5.3 "Continued from 10:29 AM". Set when block's dominant entity overlaps ≥50% with prior block of same date or yesterday's last block. |
| **`block_evidence_quality` enum** | `thick / thin / ambiguous`. Drives whether the AI step (label or summary) is allowed to fire. Thin blocks don't get AI calls; they get template-floor labels. |
| **`block_label_source` enum**, already partly present in `block.label.source` | Must be exposed so the renderer can a) suppress relabel-override input when source is `user`, b) show a quiet pencil affordance when source is `derived` / `thin`. |
| **Live-block delta channel** | See §8.2 fix. Layer 3 owns the live-block invalidation event, not the renderer poll. |
| **Persona signal in `user_profiles`** | For §7.2 gate. Either a `persona` enum or a derived "has_attributed_in_last_90d" flag exposed to the renderer. |

### Pushback

You will push back that Layer 2 and Layer 3 are not yet audited (V1-PHASE-0-READ.md ends at Layer 1) and that this section is asking for too much before the data layer is even shaped. My lean: the Timeline spec is gated on those outputs; either the data layer adds them or the Timeline ships in v1 with the same duct tape. The Phase-0 doc is explicit that polish on dirty inputs is wasted work — this section is the inventory of dirt to clean before polish.

---

## 10. P0 cross-check (AI-PRODUCT-DIRECTION.md D1-D7)

| Directive | This spec |
|---|---|
| **D1 — Activity, not app** | Respected. §2 enforces verbed activity in the deterministic path; §4 bans app-totals as the summary lead. The "in {App}" floor at step 6 weakens this; called out in §2 pushback. |
| **D2 — Time awareness** | Mostly N/A — the Timeline view is reading a day the user picked, not answering a question. Two surfaces touch D2: (a) the empty-state copy for a future date / before-tracking date — current copy ("No tracked activity for this day", `Timeline.tsx:1689-1694`) is acceptable but doesn't differentiate "before tracking started" from "tracked but empty". Spec adds a branch: if `date < trackingWindowStart`, copy reads "Daylens started tracking on {date}. Earliest day with data is {date}." (b) The "compare to yesterday" line in §5.2 must respect tracking-start. |
| **D3 — Minute-level precision** | Respected. §4.3 makes wall-clock minute alignment the contract and bans summing `session.durationSeconds` for the card's displayed span. Open question: every projection consumer needs to switch (Wrapped, weekly brief, AI router). |
| **D4 — Never refuse with "I don't know"** | Respected. The empty-state "No tracked activity for this day" is not a refusal but a state. The block summary for a thin block (§4.2) names what *is* known ("Safari for 5m; details thin") instead of "I can't see what you did." |
| **D5 — App view is a context view, not a totals view** | N/A to Timeline. Spec touches Apps view only by removing the duplicated category-totals reasoning from the Timeline rail (which the Apps view will own properly per its own redesign). |
| **D6 — Capture surface is a tradeoff** | Doesn't apply directly to the visual spec, but §9.1 names the capture-surface gaps (single window title per session, browser SPA detection) without which the rest of this is unimplementable. That's the capture roadmap, restated against this surface. |
| **D7 — Common understanding** | Respected. This doc cites AGENTS, AI-PRODUCT-DIRECTION, PRODUCT-SPEC, and V1-PHASE-0-READ explicitly and obeys the read order. |

### Pushback

You will push back on D5 being "N/A" — that the Timeline rail's "Apps used" section is precisely the place where app totals leak back in. My lean: that section stays in the rail because the user's question, when they open a block, includes "what tools did I use for this?" — that's a context view, not a totals dashboard. It is capped at 4 (not 6) and the per-app category sub-label is removed.

---

## 11. Decisions I need from the user before locking

Numbered list. Each entry includes the stated lean.

1. **Block-naming step 7 floor.** Do we ever ship a block titled `Brief activity`, or do we force step 6 (`{App display name}`) for any block that has ≥30s of foreground time? **Lean: never `Brief activity`. Step 6 is the floor; step 7 means "should have been a gap, not a block" and is a Layer 2 bug.**

2. **Verb table scope.** Is the activity-verb table English-only for v1, or do we pin it to one language now and design around localisation later? **Lean: English-only, pinned at v1, localisation is a v1.5 conversation.**

3. **Drop sub-5-minute gaps from the visual timeline.** Yes / no. **Lean: yes. Fragmentation evidence belongs in per-block analytics, not in the chronological reading view.**

4. **Remove category pill, keep accent.** Yes / no. **Lean: yes. The accent strip + label + app icons carry the load; the pill shouts.**

5. **Persona gate for Attribute-to-client.** Hide by default for users with zero clients, surface via Settings opt-in + per-block right-click. Yes / no. **Lean: yes. Daylens is for one person; consultants are a subset.**

6. **Workflow clues section dies in v1.** Yes / no. **Lean: yes, until workflow_signatures emits verbed labels. The data path stays.**

7. **AI step is enrichment, not source.** Labels and summaries default to deterministic; AI is allowed to overwrite only when it passes a quality check. Yes / no. **Lean: yes. Robotic-but-correct beats voicy-but-wrong at v1.**

8. **Live-block IPC delta channel.** Build it now, or keep 30s polling at v1 and revisit. **Lean: build it now; the perf cost of polling the full day projection every 30s is half this view's UX problem.**

9. **`timeline_blocks` persisted projection.** Is Layer 3 in scope for v1.0, or do we ship the Timeline redesign on the recomputed-on-read pipeline? **Lean: Layer 3 in scope. Without it, §2 (one-rule labels) is unstable across reads and §8 perf fixes don't land.**

10. **Compare-to-yesterday line in the day rail.** Ship in v1 or v1.1? **Lean: v1.1. Requires a multi-day continuity signal that Layer 3 doesn't expose yet.**

11. **Block-label override input placement.** Below the evidence (my lean) or remain at the top of the rail (current). **Lean: below. Reading is 99% of the use case; relabelling is a power-user affordance.**

12. **Empty-state copy when date < tracking-window-start.** "Daylens started tracking on {date}. Earliest day with data is {date}." Phrasing OK? **Lean: yes.**

13. **Browser SPA detection in Layer 2.** Block on it (no v1 Timeline ship without it) or ship Timeline first and live with one-URL-per-session? **Lean: block on it. The "Researching {entity}" templates require it; without it, every Gmail/Linear/Notion block degrades to the domain stem.**

### Pushback

You will likely flip my lean on at least #3 (don't drop sub-5-minute gaps — they're visible evidence of fragmentation), #6 (workflow clues stay because you wrote them), and #10 (compare-to-yesterday is what makes the rail worth opening daily, not a v1.1 line). Mark the disagreements before any spec lock.
