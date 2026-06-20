# Prior art — what the other trackers taught us

**Status:** Researched · **Date:** 2026-06-20 · **Companion to** `docs/findings.md`

We looked at how the people who've already shipped this solved it: ActivityWatch (open
source), Rize, Toggl Track, Timing, StayFree, RescueTime, and the Rewind/Limitless "record
everything" camp — plus the Raycast v2 rewrite for architecture. The goal wasn't to copy a
UI. It was to answer the two questions our `findings.md` exposed: **how do you capture clean
signal (especially browser URLs), and how do you turn thin signal into a category or a
name?** Here's what's worth stealing, what to reject, and the one thing nobody does that is
our whole opening.

---

## 1. The big one: capturing browser URLs is the crux, and it's browser-family-specific

Every tracker hits the same wall, and they all solve it the same way. On macOS there is **no
single API that reads the active tab's URL from every browser.** What actually works splits
by browser family:

- **Chromium + WebKit family** (Chrome, Brave, Edge, Arc, Dia, Opera, Vivaldi, Safari): you
  can read the live active-tab URL via **AppleScript/Apple Events** (or the Accessibility
  `AXWebArea → AXURL`, which is buried and fragile). Per-browser, needs Automation permission.
- **Firefox family** (Firefox, Waterfox, LibreWolf, **and Zen**): exposes **nothing** via
  AppleScript or Accessibility. RescueTime says it plainly — *"Firefox requires the
  RescueTime browser extension to track individual websites on macOS"*; without it you only
  get "Firefox" with no sites. The only ways in are **reading `places.sqlite`** (the history
  DB) or **a browser extension.**
- **The universal answer** (ActivityWatch's whole design): a **browser extension** is the one
  mechanism that works across every browser, reports the active tab's url/title/audible/
  incognito directly, and doesn't break when a new browser ships.

**Why this matters for us, confirmed on Tonny's machine:**

- Zen is a **Firefox fork**. Its history sits at
  `~/Library/Application Support/Zen/Profiles/<profile>/places.sqlite` — it exists on disk
  right now. Daylens never reads it, so 44 minutes of real intent vanished (see `findings.md`
  §2.2).
- AppleScript/Accessibility would **never** have worked for Zen — it's Firefox-based. So the
  fix is *not* "read the live URL." It's "read Zen's `places.sqlite`," which is the same path
  we already use for Firefox.
- `src/main/services/browser.ts` **already reads Firefox `places.sqlite`** via `profiles.ini`.
  The machinery exists; it's just hardcoded to `Mozilla/Firefox/` and walks past `Zen/`.
- We have **two** hardcoded browser lists that disagree and both miss Zen:
  `browser.ts` (which histories to read) and `looksLikeBrowserApp()` in `tracking.ts:1072`
  (whether a foreground app is tagged a browser for domain attribution). They should be one
  source of truth.

**The senior fix this points to:** stop hardcoding browser *names*. Discover browsers from
the OS — ask LaunchServices who handles `http`/`https`, or read each app's Info.plist
`CFBundleURLSchemes` (Zen's lists `http` and `https`, verified). Classify each discovered
browser as Chromium-family or Firefox-family, then point it at the right reader
(`Default/History` vs `places.sqlite`). One source of truth, consulted by both the history
reader and the foreground tagger. Zen — and the next unknown browser — then works on day one
with no code change. A browser extension is the gold-standard upgrade for live, exact,
incognito-aware tab data later.

---

## 2. How they turn signal into a category: tiered, deterministic-first, AI as the exception

This is the part we kept getting wrong by doing it backwards. **Rize** is the closest analog
to our naming problem, and its pipeline is a hybrid with AI *last*, not first:

1. **Most-specific rule wins** (deterministic). If rules exist for both `google.com` and
   `docs.google.com`, the granular one wins. Fast, free, predictable.
2. **AI only for the unmatched remainder**, and only **after ~2 minutes** of accumulated
   activity — never instantly. (Tonny independently reached the same conclusion: don't name a
   live block early; wait until there's enough context.)
3. **Human override is final** and becomes a rule, so that case is deterministic forever.

Rize also bootstraps with a **prior**: your **job title** generates initial rules, and it
recognizes ~300k known apps. It isn't inferring from a blank slate — it starts with strong
priors and only reasons hard about the genuinely ambiguous.

**Timing** shows how rich the deterministic layer can be: rules over Title, Path, Domain,
full URL, **File Path**, extracted Keywords, Application, Start Time, Day — with
contains/is/begins/regex/wildcards and `&&`/`||`. Conflicts resolve by **explicit order,
first match wins.** Crucially, rule changes are **non-retroactive by default** with an
explicit "re-apply" — history stays stable; you opt into rewriting it. That's a disciplined
answer to our "corrections win and survive rebuilds" problem without chaos.

**What we steal:** resolve with cheap deterministic rules first (this *is* "resolver-first"
from `ai.md` §4, applied to labeling); spend the model only on the ambiguous remainder, and
only once a block has enough evidence; turn every correction into a durable rule; treat file
paths and URLs as first-class intent signal, not just app names.

---

## 3. Battle-tested thresholds we can borrow

Concrete numbers other products have already tuned, useful for our block boundaries,
absorption, and live-naming:

| Number | Who | What it governs | Our use |
| --- | --- | --- | --- |
| **>10 s** dwell | Toggl | Ignore app/site views under 10 seconds | Kills the 5,977 micro-session inflation; a real switch has a floor |
| **2 min** before AI | Rize | Wait for accumulated signal before an AI label | Don't name live blocks early; only name once there's context |
| **75% of a 15-min window** | Rize | A window counts as focus if 75% is focus-category | A clean windowed rule for absorbing brief detours into a block |
| **5 min** idle | Rize | Idle detection | We use ~15 min as a block boundary; note the spectrum |

These aren't laws, but they're sane defaults that took other teams real tuning to find. We
start here instead of from zero.

---

## 4. Scale and retrieval: discard raw, keep derived; search don't stuff

**Rewind/Limitless** are the "record everything" camp — 5–10 fps screen capture, OCR every
pixel, audio ASR, multimodal embeddings into a **local vector store (LanceDB)**, dense
retrieval at cosine 0.8, rerank, then a **small local model** (Llama-3.1 8B) writes the
summary. They discard raw frames and keep embeddings (claimed 3750× compression); OCR/ASR run
on the Neural Engine; only the query text goes to an LLM.

We are deliberately **not** in that camp — Daylens is metadata-only (see §6). But the
*retrieval architecture* is exactly our scale answer: keep lightweight derived data, search
it, feed only the top-k to the model. We already have FTS (`website_visits_fts`,
`app_sessions_fts`, `artifacts_fts`) — that's our RAG today; embeddings are the upgrade. And
"discard raw, keep derived" is precisely the **frozen-snapshot rollup** in `briefs-wraps.md`
§6.1. A yearly Wrapped reads ~12 monthly summaries, never a year of events.

---

## 5. Architecture: a tight core, modular capture

- **Raycast v2** rewrote onto a layered stack with a **Rust core** for the performance- and
  correctness-critical data layer (file indexing, sync, data model), with features built in
  lighter layers above it. The lesson for us isn't "rewrite in Rust" — it's that the
  correctness-critical engine deserves to be a **tight, well-tested core**, not smeared across
  a 6,100-line `aiService.ts` and a 5,556-line `workBlocks.ts`.
- **ActivityWatch** keeps capture as **small, decoupled watchers** feeding a local hub, with
  **heartbeat merging** (consecutive identical pulses collapse into one duration). Capture is
  modular and individually testable — the opposite of burying it in a giant service.

---

## 6. What everyone does that we deliberately reject

- **Productivity scores and grades.** RescueTime and Rize lean hard on focus scores,
  productivity pulses, "X% of your day." Our `PRODUCT.md` says no grades, and the prior art is
  exactly *why* it's a differentiator — everyone else makes you feel judged. We show the day;
  we don't score it.
- **Screenshotting / screen recording.** Rewind and Limitless record your screen. We don't.
  Metadata only (app, window title, URL, file path) — same privacy stance as Rize, Toggl,
  StayFree, ActivityWatch. **The tradeoff to internalize:** metadata-only means we have *less*
  signal than the screen-recorders, so our capture quality and our intent reasoning have to be
  *better*, not sloppier. Thin signal is precisely why the capture failures in `findings.md`
  are fatal rather than cosmetic.

---

## 7. The gap nobody fills — and it's our whole opening

Every one of these tools stops at the same place: **app/site → category.** "Safari →
Browsing." "Chrome → Development." Even Rize's GPT-5 layer assigns a *category*, not a story.
None of them tell you **what you were trying to do** as a sentence across multiple apps:
*"you spent the morning chasing a flickering menu bar — Cursor, Warp, terminal, and
Accessibility settings."*

That synthesis — intent as a narrative, not an inventory of apps — is the thing Daylens is
actually for, and it's unclaimed. But it is **only possible if the evidence object is rich**
(window titles + URLs + files), which loops straight back to `findings.md`: fix the eyes, and
this differentiator becomes reachable. Leave them broken, and we're a worse RescueTime.

---

## 8. What this changes for the specs and the fixes

- **Browser capture** (`timeline.md`/`apps.md`): reframe from "add Zen to a list" to "discover
  browsers from the OS and read by family (Chromium `History` vs Firefox `places.sqlite`),
  one source of truth." Note the browser-extension path as the eventual gold standard.
- **Labeling** (`timeline.md` §3, `ai.md` §4): make the deterministic-first / AI-for-the-
  -remainder / correction-becomes-rule tiering explicit. Add the "≥ a couple minutes of
  evidence before naming" rule, which also answers live-block naming.
- **Thresholds**: adopt the §3 numbers as defaults (10s dwell floor, focus window, idle).
- **Scale** (`briefs-wraps.md`, `ai.md`): we're already aligned (frozen snapshots + FTS);
  note embeddings as the future retrieval upgrade.
- **Engine shape** (ADR): capture as modular, testable units; the block engine as a tight core
  — explicitly against the giant-service status quo.

---

## Sources

- ActivityWatch — [Watchers](https://docs.activitywatch.net/en/latest/watchers.html),
  [aw-watcher-web](https://github.com/ActivityWatch/aw-watcher-web),
  [Data model](https://docs.activitywatch.net/en/latest/buckets-and-events.html)
- Rize — [How categorization works](https://docs.rize.io/categories-and-tracking-rules/how-categorization-works),
  [AI features](https://docs.rize.io/automatic-tracking/ai-features),
  [Tracking overview](https://docs.rize.io/automatic-tracking/tracking-overview)
- Timing — [Rules in-depth](https://timingapp.com/help/rules)
- Toggl Track — [The Timeline feature](https://support.toggl.com/en/articles/2206941-the-timeline-feature)
- StayFree — [stayfreeapps.com](https://stayfreeapps.com/)
- RescueTime — [Browser tracking: supported browsers](https://help.rescuetime.com/article/453-rescuetime-browser-tracking-supported-browsers-and-setup)
- macOS browser-URL capture — [Accessibility API AXWebArea/AXURL](http://dixjty.blogspot.com/2018/11/how-to-retrieve-active-window-url-using.html),
  [Swift: get browser tab URL two ways](https://medium.com/@itsuki.enjoy/swift-macos-get-browser-opened-tab-url-2-ways-e6722fb5998d)
- Rewind/Limitless — [architecture overview](https://skywork.ai/skypage/en/Rewind-AI-&-Limitless:-The-Ultimate-Guide-to-Your-Digital-Memory/1976181260991655936),
  [Screenpipe (open alternative)](https://screenpipe.com/blog/best-rewind-ai-alternative-2026)
- Zen Browser — [Wikipedia](https://en.wikipedia.org/wiki/Zen_Browser)
- Raycast — [Technical deep dive into the new Raycast](https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast)
