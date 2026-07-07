# Settings — build spec

## 1. What Settings is

The one place you tune Daylens — and **every control here visibly changes something you can
see.** A setting that toggles but does nothing is a bug. Settings is where you pick the AI
model, name your clients, correct how apps are labelled, decide what's tracked, and manage
what Daylens remembers about you.

It reads and writes the **same truth** as the rest of the app. A label you set here is the
label the Timeline, Apps, and AI all use. There is no separate "settings world."

## 2. What's broken now and how it should work

- **The model you pick isn't used.** Settings says Claude Haiku; re-analyze runs Gemini and
  throws a quota error. The selected model must be used by *every* AI surface (`ai.md` §5).
- **Per-app labels don't propagate.** You set Dia → Browsing and the Apps list still shows it
  wrong. An override has to win everywhere and survive a rebuild.
- **The label list only shows some apps.** You can't find Zen there to categorize it. Every
  app you've used must be listed, including the uncategorized ones.
- **Work memory is opaque and useless** — 19 patterns all tagged "browsing" at an identical
  65%. That whole surface is respecified in [`work-memory.md`](work-memory.md).
- **Clients don't exist.** There's no way to create a client, so the AI can't attribute work
  to one.
- **MCP ships on with dev paths.** A packaged build exposes the developer's filesystem paths
  and defaults the MCP server on.
- **Exclusions only apply going forward.** Excluding an app doesn't remove the data already
  captured from the AI.

## 3. AI provider & model

One provider, one selected model, honored everywhere.

- You connect a provider (Anthropic, OpenAI, Google) and pick a model. That model is used by
  **chat, re-analyze, recaps, briefs, and wraps** — every surface, every time (`ai.md` §5).
- If a call fails (quota, auth), the error **names the selected provider** and never silently
  swaps to a different model.
- With no provider connected or no credits, AI surfaces show one clear "connect a provider"
  message and nothing fake (the no-credits rule, `ai.md` §5).

## 4. Labels (per-app categories)

The label list is **every app you've actually used**, each with its category — including the
ones Daylens hasn't categorized yet, so nothing is unreachable.

- **Detection is the default, your override is the truth.** Daylens auto-categorizes each app
  when it first appears (browsers via the OS handler — `apps.md` §3.4; others by what they
  are). You can override any app's category.
- **An override wins everywhere and survives rebuilds.** Relabel Dia → Browsing and it shows
  that way in Apps, Timeline, and the AI after recompute — the same label in every view, never
  one surface disagreeing (`apps.md` §5).
- **A relabel reports its effect.** When you change a label, Settings says what it touched
  (e.g. "updated 3 days of blocks") rather than changing silently.
- The category filter pills filter the list and actually work.

## 5. Clients & projects

Name the things you work on so the AI can attribute time to them.

- You create a client/project and (optionally) attach aliases or apps/domains that belong to
  it. From then on the AI can answer "how much on Acme this week?" with a real number
  (`ai.md` §8.2).
- With no clients set up, the AI never dead-ends — it offers an inferred breakdown and an
  offer to set clients up here (`ai.md` §8.2). This screen is where that setup happens.

## 6. Tracking & privacy

You decide what Daylens sees, and exclusions are honored end to end.

- **Pause tracking** stops capture; the Timeline marks that span as paused, not idle.
- **Excluded apps/sites** are removed from capture **and** from anything the AI is shown —
  including data already captured before you excluded them. Exclusion is applied at the
  resolver boundary, so old history for an excluded app never reaches a provider.
- **Incognito / private windows** are never recorded.
- Each of these states is explained where it shows up (a paused gap says "paused"; an excluded
  app is absent, not silently zeroed).

## 7. MCP server

The MCP server (external clients querying your data — `mcpServer.ts`) is a power-user feature,
off by default and safe in production.

- In a **packaged build**: MCP defaults **off**, the config shows the real userData database
  path (never a developer's repo path), and debug menus are absent.
- In a **dev build**: it may default on; the UI explains the dev-vs-packaged difference so the
  developer paths shown are understood as dev-only.

## 8. The rest

- **Profile name** feeds the AI's persona ("Good morning, Tonny") but never leaks into the
  facts — it's never treated as activity data.
- **Notifications** — morning brief and evening wrap toggles drive the briefs in
  [`briefs-wraps.md`](briefs-wraps.md); when on, the briefs actually fire with real content.
- **Theme** (System / Light / Dark) applies immediately and predictably.
- **Appearance** (in General, under Theme — deliberately minimal):
  - **Activity colors** — one color per kind of work (Development / Writing & docs /
    Meetings & communication / Entertainment & leisure / Browsing & research), picked from a
    curated ten-color palette, applied everywhere blocks are drawn (day grid, week grid,
    month dots, inspector). Each group's default is in the palette, so picking it equals
    reset; a "Reset colors" button clears all overrides. No free-form color wheel — the
    curated set keeps every choice legible on both themes. Source of truth:
    `shared/activityColors.ts`; overrides persist in `activityColorOverrides` and are
    validated (known category, `#rrggbb`) on write.
  - **Dim leisure blocks** — the calendar fades non-work blocks so the eye finds work
    first; this toggle turns that off. Default on.
  - Changes apply on save with no restart. Considered and deliberately left out to stay
    minimal: week-start day, density/hour-height, 12/24-hour time (locale-driven),
    per-category (rather than per-group) colors.
- **Updates** — packaged builds auto-update; dev builds explain that updates come through the
  dev workflow.
- **Analytics** — anonymous and always on (founder decision, 2026-07-07): event names and
  allowlisted coarse properties only; no titles, URLs, or file paths ever leave the device.
  The Privacy page states this plainly instead of offering a toggle.

## 9. Invariants (rules this view must always obey)

1. Every control has a visible effect; a toggle that changes nothing is a bug.
2. The selected AI model is used by every AI surface; errors name that provider and nothing
   silently swaps.
3. The label list shows every app the user has used, including uncategorized ones.
4. A category override wins in Apps, Timeline, and AI, and survives every rebuild.
5. An exclusion removes the app/site from capture **and** from everything the AI is shown,
   including already-captured data.
6. A packaged build ships with the MCP server off and never exposes developer filesystem paths.
7. Settings reads and writes the same truth as the rest of the app — no separate settings
   world, no view that disagrees after a change.

## 10. Visual direction — the sectioned layout (round-2 design notes)

The shell from DEV-105 is structurally right (app sidebar → settings rail → content pane,
each section its own page) but several pages are still rough. This section is the **agreed
look** after Tonny tested the first build. Reference screenshots live in
[`docs/research/settings-references/`](../research/settings-references/) — open them; they
are the bar. The overall mood across every page: **calm, spacious, plain-language, native —
Claude's settings, not a dense control panel.** Generous vertical rhythm, one clear job per
page, a muted one-line description under each control, the control right-aligned. Never dump
raw config, dev paths, or jargon at the user.

### 10.1 The rail
- **No "Settings" title at the top of the rail.** The app's own left nav already shows
  Settings is the active surface — a second "Settings" header is redundant. Start the rail at
  the search box, then the grouped sections.
- Keep the grouped, **icon-per-item** rail (it tested well): icons are the visual anchor.
- Keep search.

### 10.2 Navigation — there must always be an obvious way back
This is the one that bit us twice. The rail *is* the navigation, but on the AI / Provider &
model page (and any page reached by a cross-link such as Billing's "Manage key in AI"), it
**read as a dead-end** — the user felt there was no way back to where they came from.
- Every page must have an unmistakable way back to the previous context. Acceptable solutions:
  the rail selection always reflects where you are **and** cross-links don't silently teleport
  you; OR an explicit breadcrumb/back affordance when a button navigates you to another
  section. Pick one and make it obvious — do **not** explain the complaint away.
- Prefer **not** to make Billing/Usage jump the user into a different rail section. If a card
  needs the key, either surface the key control inline or use a clearly-labelled link that the
  user understands will move them (and can return from).

### 10.3 Known bug — stray rows bleed across pages (fix first)
On the **Privacy & tracking** and **MCP server** pages, two **Labels** rows
("Dia · 168h over 30 days · override: Browsing" with a category dropdown + Reset) render at
the top of the page where they do not belong (see `daylens-privacy-CURRENT-strayrows-bug.png`
and `daylens-mcp-CURRENT-too-technical.png`). Root cause: the content pane renders `{content}`
with no stable identity, so React reuses DOM across section switches and leaves the previous
section's first rows mounted. **Fix:** force a full remount per section — e.g. `key={activeSection}`
on the content wrapper (or render each section behind its own keyed boundary). Verify by
clicking Labels → Privacy → MCP and confirming no Labels rows survive.

### 10.4 Per-section look

- **General** — name + theme, plus the Appearance rows (§8: activity colors, dim leisure
  blocks) in the same calm row style. Still one page, one job: how Daylens looks.

- **Memory** → match `ref-claude-capabilities-memory.png`. **Mood:** trustworthy, uncluttered,
  "set and forget." Clean toggle rows, each a bold title + a muted one-line description (with
  inline "Learn more" where useful) + a right-aligned toggle. A prominent **full-width
  "View and manage memory · Updated <relative time>" row with a chevron** that opens the
  auditable memory view. The raw editable-paragraph list we shipped looks like a debug dump —
  replace it with this calm, sectioned treatment. (Behavior is DEV-107; this is the visual bar
  for both the Memory settings page and the Manage-memory view.)

- **Clients** → the current create-a-row form is the wrong interface. **Mood:** the clean,
  grouped, action-oriented Claude style in `ref-claude-privacy.png` (sectioned, each item a
  row with a clear right-aligned action). Behavior is already specified in §5 and `ai.md` §8.2
  — a client/project with optional aliases and apps/domains, used for time attribution. Build
  the interface to that spec, not a bare name+color+add row.

- **Privacy & tracking** → simplify to `ref-claude-privacy.png`. **Mood:** transparent and
  calm. Lead with a short "what Daylens sees / your data stays local" framing, then grouped
  rows: **Preferences** (pause, limit tracking, skip incognito, excluded apps/sites) and
  **Your data** (analytics, local-only, export if applicable) — clean rows, controls
  right-aligned, no wall of inputs. Remove the stray Labels rows (10.3).

- **MCP server** → simpler, far less technical (`ref-claude-connectors.png` mood). **Mood:**
  powerful but approachable, like Claude's Connectors. Lead with a **plain-English** "what this
  is and why you'd turn it on," a single clear on/off, and a friendly "what apps can do with
  it." **Hide the raw JSON config, file paths, and `DAYLENS_*` env behind an "Advanced /
  Show config" disclosure** — a normal user should never see a developer's filesystem path or a
  config blob on the default view.

- **Capture health** → today it's a diagnostic the user has no reason to care about. Either
  **reframe it as a plain-language "Is Daylens seeing your work?" status** that only demands
  attention when something is wrong (and then tells the user what to do — e.g. grant a
  permission), or fold it into Privacy/General. Raw "198/203 samples" style metrics belong
  behind an advanced/troubleshooting disclosure, not front and center.

- **Updates** → a **beautifully designed changelog**, not a status line. Reference
  `ref-dia-weekly-changelog.png` (Dia's "Dia Weekly" release notes). **Mood:** editorial,
  premium, human — a crafted newsletter, not a dry "bug fixes" bullet list. Think a masthead,
  an issue number + app version, a dated feature story with a headline and a hero image, and
  short readable copy describing what each update adds. The user should feel the care. Keep the
  actual "check / install / restart" controls, but wrap the *content* of an update in this
  designed changelog. (Split into its own issue — **DEV-111** — since it's more than a
  settings row; the Updates *controls* stay in this section, the changelog *content* is DEV-111.)

- **Billing / Usage** — keep the honest scaffolds, but render them in the same calm, grouped
  Claude style as the rest (no dark patterns; plain numbers).

### 10.5 Mistakes from round 1 — do not repeat
- Don't ship a page that doesn't match its reference screenshot and call it done. Open the
  reference, build to it, compare side by side.
- Don't dismiss a visible glitch as a "transition artifact" — the stray-rows bug was real and
  shipped. If something looks wrong in a screenshot, it is wrong; reproduce and fix it.
- Don't explain a UX complaint away ("the rail is the back button"). If the user felt stuck,
  the design failed — fix the design.
- Drive the real app and screenshot **every** section, then look at each screenshot critically
  before claiming the work is ready.
