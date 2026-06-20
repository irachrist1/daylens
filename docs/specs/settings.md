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
- **Updates** — packaged builds auto-update; dev builds explain that updates come through the
  dev workflow.
- **Analytics** — anonymous, opt-in/out, and the "local-only" promise is real when set.

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
