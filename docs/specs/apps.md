# Apps — build spec

## 1. What the Apps view is

Pick one app and see what you actually did in it. Same intelligence as the Timeline,
filtered to a single app. The left side is a list of every app you used in the chosen
period, named and ordered honestly. Click one and the right side shows that app's story:
how long you were in it, the sites it hosted, the pages you visited, and a short recap.

It reads from the **same blocks** as the Timeline and the AI. If the Timeline says you
spent 2 hours in Ghostty, the Apps view says the same.

## 2. What's broken now and how it should work

- **The bold title is not the app name.** On 7-day, Safari shows as **"Development"** —
  the category is being used as the title. The user can't tell which app they're looking
  at; "Development" could be anything. The bold title must always be the real app name:
  **Safari**.
- **30-day uses a content title.** Safari shows as **"Divided States of America Part 1
  (full documentary)"** — a video title pretending to be an app identity. Same bug as
  7-day, worse. Two different wrong naming schemes across two periods.
- **Today is basically empty.** No useful detail without clicking Generate, and the
  Generate button doesn't work. Every other period shows domains and pages.
- **Domains are attributed to the focused app, not the browser that hosted them.**
  Netflix and YouTube show up under **Dia** because Dia happened to be in focus. Those
  domains belong to the browser that actually loaded them.
- **Pages visited has duplicates.** Netflix appears twice in the same list. Each page
  should appear once.
- **"Often used with" shows system noise.** UniFi's panel lists Siri, Finder, and
  UserNotificationCenter as co-used apps. This section is removed entirely.
- **Generate summary produces duplicates and usually fails.** The Safari recap reads
  "Key artifacts include Netflix, Netflix, …". When it does run it repeats itself; most
  of the time it doesn't run at all.
- **Category filter pills are unverified.** The pills render. Nobody has confirmed they
  filter anything.
- **Leisure dominates a work view.** YouTube and Netflix take over Safari's 119h
  breakdown for a developer. Work should surface first.

## 3. How apps are displayed

### 3.1 The app list (naming)

Each row is one real app. The **bold title is always the app's real name** — Safari,
Dia, Ghostty, Cursor, Claude — in every period, with no exceptions.

- **Never** the category. Not "Development", not "Browsing".
- **Never** a page, video, or document title. Not "Divided States of America Part 1".
- The category is a **quiet badge**, not the headline. Safari's badge reads *Browsing*;
  it sits next to or under the name, never replaces it.
- The subtitle carries the supporting facts: time in that app and a session count —
  e.g. *Safari · 29h 26m*. Session counts must be sane; thousands of micro-sessions
  (5,977 for one week) are an artifact of bad capture, not real switches.

The list is ordered by time spent, most-used first, so the apps that actually filled
your period sit at the top.

### 3.2 Periods (Today / Day / 7d / 30d)

Four periods: **Today**, a specific **Day**, the **last 7 days**, the **last 30 days**.

- **Same app, same name, same category in every period.** Safari is "Safari · Browsing"
  on Today, on 7d, and on 30d. The naming scheme never changes between periods.
- **Every period shows real detail with no AI.** Time, domains, and deduped pages are
  computed straight from your activity — they appear the moment you open the app, on
  Today exactly like on 7d and 30d. Today is never empty.
- **Generate only adds the written recap.** The button produces the short summary
  paragraph (section 4.3) and nothing else. It is optional polish on top of detail that
  is already there — never the thing that makes the panel non-empty. It works every time
  and uses the model picked in Settings.

### 3.3 Domain attribution

Domains belong to the **browser that actually loaded them**, never to whichever app was
in focus at the moment.

- If you watched Netflix in Safari, `netflix.com` lives under **Safari** — even if Dia
  was briefly the focused window. Netflix and YouTube never appear under Dia just because
  Dia was on top.
- **Non-browser apps have no "Time by domain" section.** Ghostty, Cursor, and Slack don't
  host web pages, so they show no domain breakdown at all.

### 3.4 What counts as a browser — discovered, not hardcoded

Browsers are special: they host the URLs and page titles that carry a block's intent. Today
Daylens decides "is this a browser?" with a hardcoded name regex
(`looksLikeBrowserApp` in `tracking.ts`) — and **Zen isn't on the list**, so 44 minutes of
real browsing vanished (`docs/findings.md` §2.2). A name list is a guess that breaks on every
browser we didn't predict. We stop guessing.

A browser is **any app the operating system registers as an `http`/`https` handler** — read
from LaunchServices or the app's own Info.plist (`CFBundleURLSchemes`; Zen declares `http`
and `https`, verified). That is the truth macOS already holds, and it catches Zen and the next
unknown browser with no code change.

Reading a browser's sites is **family-specific**, and there is no single API for all of them
(`docs/research/prior-art.md` §1):

- **Chromium and WebKit family** (Chrome, Brave, Edge, Arc, Dia, Safari, …): live tab URL is
  readable, and their history lives in a Chromium `History` DB.
- **Firefox family** (Firefox, Waterfox, LibreWolf, **Zen**): exposes nothing live — its sites
  must be read from `places.sqlite`. Daylens already reads Firefox's `places.sqlite`; Zen uses
  the same format at `~/Library/Application Support/Zen/Profiles/<profile>/`. The reader just
  has to be pointed there.
- A **Daylens browser extension** is the eventual gold standard — exact, live, per-tab,
  incognito-aware, and identical across every browser.

This is **one source of truth**, consulted by both the history reader and the foreground
tagger (today those are two lists that disagree). Detection runs **when an app first appears**,
so a newly installed browser is categorized correctly on day one — not left in "Other" (the
"categorize apps correctly on install" gap). A user override still wins over detection (§5).

## 4. The detail panel

When you click an app, the right side shows its story. The header is the **app name** in
bold with a quiet category badge and the period (e.g. *Safari · Browsing · last 7 days*),
plus the Generate button. Below that, in order:

### 4.1 Time by domain (browsers only)

The sites that app hosted, each with time spent and a visit count. **Work surfaces
first.** Productive domains — code, docs, work tools — are the main breakdown at the top.
Streaming and social — YouTube, Netflix, X — are collected in a quieter section below it
(e.g. *Off to the side*), still honest and still counted, but not crowding out the work.
A developer scanning Safari sees `github.com` and `colab.google.com` before they see
28 hours of YouTube.

Only browsers show this section. Each row has a delete control — see section 4.4.

### 4.2 Pages visited

The specific pages, **deduped — each page appears exactly once.** If you opened a page
five times, it's one row: its total time and its real visit count, not five duplicate
rows. Netflix shows up once, not twice. Like domains, work pages surface first and
leisure sits in the quieter section. Each row has a delete control (section 4.4).

### 4.3 The generated recap

A short paragraph the AI writes when you press Generate. It names what you did in that
app, grounded in the real domains and pages.

- **No duplicates.** Never "Netflix, Netflix". Each artifact is named once.
- Grounded, calm, specific — the Daylens voice. It narrates the real numbers; it never
  invents an artifact that isn't in the evidence.
- Uses the Settings model. Runs reliably, not "most of the time".

When an app genuinely has too little signal to describe (a system surface like
Loginwindow), the panel still shows its time honestly and says so plainly — it does not
beg for "more context".

### 4.4 Deleting a page or domain

Each domain and page row can be deleted. Deletion is **permanent and asks for
confirmation first** — it removes the captured records for that page or domain everywhere
they appear, and any generated recap built on them is regenerated so nothing stale
survives. It's for clearing genuine garbage out of your history, so the confirmation
states plainly that it can't be undone.

### 4.5 Removed: "Often used with"

The "Often used with" section is **gone**. It listed system noise — Siri, Finder,
UserNotificationCenter — as if they were apps you chose to use, and it added no value.
Remove it entirely.

## 5. Corrections (label overrides)

The category badge on an app is yours to correct. In Settings you can relabel an app —
say Dia from *AI tools* to *Browsing* — and that override is the truth from then on.

- **Your override wins.** Once you set an app's label, Daylens uses it in the Apps list,
  the badge, and every category grouping, and it survives rebuilds and re-analysis.
- **The override propagates.** A relabel takes effect across the Apps view, the Timeline,
  and the AI after recompute — the same label everywhere, never one view disagreeing with
  another.
- Until you override it, the badge is Daylens's honest read of what the app is. Browsers
  read *Browsing*, terminals and editors read by what you did in them. It's a quiet badge
  either way.

The **category filter pills** at the top filter the list by that corrected category — and
they must actually filter. Tapping *Development* shows only your development apps; tapping
*All* shows everything. A pill that renders but does nothing is a bug.

## 6. Invariants (rules this view must always obey)

1. The bold title of every app row is the app's real name — never a category, never a
   page, video, or document title.
2. An app has the same name and the same category badge in every period.
3. Every period shows real detail (time, domains, deduped pages) with no AI; Generate
   only adds the written recap, and Today is never empty.
4. A domain belongs to the browser that loaded it, never to whichever app was in focus.
5. A browser is detected from the OS (`http`/`https` handler), never a hardcoded name list;
   a newly installed browser is recognized and categorized on first appearance.
6. Non-browser apps show no domain breakdown.
7. Every page in "Pages visited" appears exactly once, with its real total time and
   visit count.
8. Work surfaces before leisure in both domains and pages; streaming and social are
   counted honestly but kept to the side.
9. System noise — Loginwindow, Siri, Finder, UserNotificationCenter — is never shown as
   an app you used or a co-used app.
10. A generated recap never repeats an artifact and never names one that isn't in the
    evidence.
11. Deleting a page or domain is permanent, confirmed first, and regenerates any recap
    built on it.
12. Your category override always wins, propagates to every view, and survives a rebuild.
13. The Apps view reads from the same blocks as the Timeline and AI — its totals never
    disagree with theirs.
