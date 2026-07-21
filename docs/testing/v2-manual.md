# Daylens V2 — Your End-to-End Testing Manual

This is your walkthrough for testing everything that landed in V2, in one sitting, on your Mac with Dia and your second monitor. Every scenario was written against the actual merged code on `main` — the button names, messages, and behaviors below are quoted from the app, not from memory.

**How each scenario works:**
- **Do** — the exact clicks and text to type.
- **Expect** — what you should see, concretely.
- **Report if** — what counts as a failure worth writing down.

Some scenarios need something only you can provide (a Google OAuth client, Apple signing certificates, a billing signing key). Those are marked **[needs owner setup]** with what to do — everything else works out of the box.

---

## 0. Five-minute setup

**What you need on the Mac:** Node.js 20 or newer (`node --version` to check), Xcode Command Line Tools, Dia, your second monitor plugged in, and Granola installed and signed in.

**Build and run from `main`:**

```bash
cd daylens
git checkout main && git pull
npm install
npm run build:capture-helper   # compiles the small native tracker (needed for real capture)
npm run models:semantic        # downloads the ~24 MB local search model (needed for "by meaning" search)
npm start
```

**First-run permissions:** the app asks for **Accessibility** — grant it (System Settings → Privacy & Security → Accessibility). That's the only required one. Screen Recording is only requested if you join the screen experiment (section 9). Full Disk Access is only for Safari history — you don't need it.

**One key to unlock the AI sections:** go to **Settings → AI → Provider & model**, pick Anthropic, paste your API key into "Paste your Anthropic key", click **Connect**. This unlocks sections 4 (the AI parts), 5, 6, and 7.

**What unlocks what:**

| Section | Prerequisite |
|---|---|
| 1 Capture, 2 Entities & memory, 3 Search, 8 Export, 9 Screen experiment | Nothing — works out of the box |
| 4 Google Calendar | **[needs owner setup]** Your own Google OAuth client — in Google Cloud Console create an OAuth client of type "Desktop app" and copy its client ID. You'll paste it into the connect card (or set `DAYLENS_GOOGLE_OAUTH_CLIENT_ID` before `npm start`). |
| 4 Outlook | **[needs owner setup]** An app registered in Microsoft Entra (Azure) with "Allow public client flows" on; paste its Application ID. Skip if you don't use Outlook. |
| 4 GitHub | **[needs owner setup]** A GitHub App with device flow enabled and read-only permissions; paste its client ID. |
| 4 Linear | A personal API key from linear.app/settings/api (2 minutes, read access only). |
| 4 Granola | Nothing — it reads Granola's local cache automatically. |
| 5, 6, 7 AI features | Any AI key pasted in Settings → AI → Provider & model. |
| 7 Managed-credit exhaustion | **[needs owner setup]** Only testable in a build with the billing service URL and an entitlement signing key baked in (`npm run billing:entitlement-key`, then set `DAYLENS_BILLING_API_URL` and `DAYLENS_ENTITLEMENT_PUBLIC_KEYS` when building). Current dev builds don't have this armed — skip until then. |
| 8 Auto-update | **[needs owner setup]** The signed path needs your Apple Developer ID certificate + notarization secrets in the release workflow. The unsigned fallback path works today. |

**Tip for one continuous sitting:** start scenario 1.1 (the long video) FIRST thing in the morning and let it run while you do sections 2–3 on monitor 1 — the video needs 30+ minutes of runtime to make a convincing stretch.

---

## 1. Capture truth — the honest day

### 1.1 Long video on monitor 2 while you work on monitor 1

**Do:** In Dia, open a long video (a course lecture works well), move it to your second monitor, make it **full screen** there. On monitor 1, do real work (editor, Notion, email) for at least 30 minutes. Don't touch the video.

**Expect:**
- Timeline (sidebar → **Timeline**) shows your monitor-1 work as normal, unbroken blocks covering the whole stretch — the video playing next door doesn't fragment them.
- The day's total time counts only your monitor-1 work. The video's time is recorded separately as "visible" presence — it is deliberately **never added** to your work total, so no minute is counted twice.
- Go to **Settings → System → Capture health** and find the row **"Full-screen and second displays"**. While the video is full screen on monitor 2, its status pill reads **"Visible"** (it reads "Watching" when nothing is full screen, "No signal" if the stream is broken).
- Honest heads-up: the Timeline does **not yet draw a lane** for the second-monitor stretch — the data is recorded and labeled `visible` under the hood, and the Capture health pill is currently the only place you can see it live. If you expected to see it on the Timeline itself, that's a known gap, not a bug (see the limitations box at the end).

**Report if:** your monitor-1 blocks break apart or show "Idle" while you were actively working; the day total visibly inflates (video time double-counted into work time); or the Capture health pill stays "No signal" the whole session.

### 1.2 A course playing on your MAIN screen doesn't flip to "away"

**Do:** Put a course video (Coursera/YouTube/etc.) full screen on your main display, press play, and don't touch the keyboard or mouse for 15–20 minutes.

**Expect:** the Timeline keeps that stretch as real activity — media playback holds the session open indefinitely, and recognized course sites hold passive reading for up to an hour. If a quiet gap line does appear on the Timeline, it's labeled **"Passive"** with its duration — never "Idle" — and gaps under 15 minutes don't appear at all.

**Report if:** the stretch shows as "Idle", disappears entirely, or the block ends a few minutes after your last click even though the video kept playing.

### 1.3 Incognito window → nothing recorded

**Do:** Open a private/incognito window in **Chrome** (Chrome first, because its private mode is directly detectable), visit a few distinctive pages for 5 minutes, close the window. Then repeat in **Dia**.

**Expect:**
- From the Chrome private window: **nothing** — no website visit and no app session for that stretch. Search (Cmd+K) for any of the page names: zero results. Ask the AI about that time: it doesn't know.
- From the Dia private window: Dia's fork removed the signal that lets Daylens directly verify private mode, so Daylens quarantines the window — it may keep "Dia + timing" only, but **never** the page title or URL of an unverified window. The pages you visited must not appear anywhere: Timeline, search, or AI answers.

**Report if:** any URL or page title from either private window shows up anywhere in the app — Timeline block detail, Cmd+K search, or an AI answer.

### 1.4 Settings shows the honest incognito promise

**Do:** Open **Settings → Activity & data → Privacy & tracking** and find the row **"Private / incognito windows"**.

**Expect:** exactly this copy, with no toggle next to it (it can't be turned off):

> "Never recorded. Daylens keeps nothing from a browser's private or incognito window — no URL, page title, or session. This protection is always on and cannot be turned off."

**Report if:** the copy is different, hedged, or there's a switch implying you could turn the protection off.

### 1.5 What a block actually captured

**Do:** Click any block on the Timeline.

**Expect:** the right panel swaps to the block's detail: its label, date, start–end and duration; a type pill (e.g. "Focused work"); a **"What you were in"** section listing apps with the pages/files inside each and per-row durations; and a **"Detours"** section. Right-click the block for the editing menu (Edit / Merge / Split block… / Regenerate summary / Remove from day).

**Report if:** the panel shows pages you never visited, times that don't match reality, or content from an excluded/private source.

---

## 2. Entities & memory

### 2.1 Twins — the "Needs attention" view

**Do:** Open **Settings → AI → Entities**. The first tab is **"Needs attention"** (a count shows if there are candidates).

**Expect:** an explanation — "Same name twice usually means Daylens minted two records for one real thing. Merge them here — you can undo the last merge." — followed by pairs like «"Canva" and "Canva"» with the type and reason. Each pair has **Merge** and **"Not the same"** buttons; with 2+ pairs there's a **"Merge all N"** button. Important background: Daylens only auto-merges twins when it has hard corroborating evidence — everything listed here is deliberately left for YOU to decide, never merged automatically.

After merging, a toast appears with an **Undo** button — click it and confirm the two records come back. If the list is empty you'll see "Nothing needs a merge right now. Use Browse if you want to rename something."

**Report if:** two obviously different things are presented as twins with no way to say "Not the same"; a merge can't be undone; or duplicates you know exist never appear here.

### 2.2 Rename and merge in Browse

**Do:** Switch to the **Browse** tab. Pick any entity → **Rename** → type a new name → save. Then tick the checkboxes on two entities of the same type and click **"Merge selected"**.

**Expect:** the rename sticks everywhere (Timeline labels, search, AI answers use the new name). The merge first shows a preview — "Keeps "X" with N linked items" — with **"Confirm merge"** / **Cancel**. After confirming, the undo toast appears. An entity's detail page lists what was "Merged into this:".

**Report if:** rename silently reverts; merge applies without the preview step; undo doesn't restore both records.

### 2.3 Tell the AI a fact → it asks before remembering

**Do:** Go to the **AI** view (sidebar) and type: `Remember that my client Meridian prefers morning calls.`

**Expect:** the AI does NOT silently save it. A card appears: **Want me to remember: "Your client Meridian prefers morning calls"?** with what it'd be used for, and two buttons: **"Save to memory"** and **"Don't save"**. (You can also type a corrected version — typing one saves the corrected text.) Click **Save to memory**.

Then open **Settings → AI → Memory** → panel **"Things you've told me"**: the fact is there with a provenance line like "Jul 21, 2026 · confirmed in chat", and **Edit** / **Delete** buttons. Edit it, save, confirm the new text shows. If you click "Don't save" instead, the fact lands under **"Declined suggestions"** and the AI won't propose it again.

**Report if:** the fact saves without the card; a saved fact doesn't appear in "Things you've told me"; editing or deleting doesn't stick; or a fact you declined gets re-proposed.

### 2.4 Delete / forget — both doors

**Do:** In "Things you've told me", **Delete** a fact — then ask the AI a question where it would have mattered. Separately, save another fact and in chat type: `Forget that my client Meridian prefers morning calls.`

**Expect:** deleting removes it from search and future AI answers immediately (the panel's own subtitle promises exactly that). The chat route shows a confirmation card — **Forget "…"? It stops shaping answers immediately…** — with **"Forget it"** / **"Keep it"**; only "Forget it" deletes. If no saved fact matches, the AI names what IS saved instead of guessing.

**Report if:** a deleted/forgotten fact still shapes an answer or shows up in search; or "forget" deletes without the confirmation card.

---

## 3. Search

Search lives in the command palette: **Cmd+K** inside the app (or **Cmd+Option+D** from anywhere on the Mac). Placeholder: "Search your history, or jump anywhere…".

### 3.1 Exact search by name

**Do:** Press Cmd+K and type a client nickname or a distinctive window title you know you used this week (2–3 words max).

**Expect:** instant results under the group **"Search results"** — the exact-match group always lists first. Results know entity aliases, so a renamed or merged entity is found under its current name. Press ↵ on a result to jump to it.

**Report if:** something you definitely did this week (and didn't delete) doesn't come up by its literal name.

### 3.2 Search by meaning

**Do:** Press Cmd+K and type something descriptive with no exact word overlap, e.g. `that pricing page with the discount` (4+ words routes through the interpreter — you'll see an "Interpreted as …" line).

**Expect:** a second group, **"Similar meaning"**, below the exact results — pages/moments related by meaning, not by matching words. (This needs the local model from `npm run models:semantic` in setup; without it the group is honestly absent, never wrong.) An exact match never shows up twice — it wins over its similar-meaning twin.

**Report if:** meaning-based results are wildly unrelated; the group shows results duplicating exact matches; or the palette errors out on a long query.

### 3.3 Deleted things never resurface

**Do:** Pick a Timeline block with a distinctive page in it. Verify Cmd+K finds that page. Right-click the block → **"Remove from day"**. Search again. Then quit and reopen the app and search once more. Also ask the AI about that time.

**Expect:** gone from search immediately, still gone after restart, and the AI's answer doesn't reference it. (Under the hood there's a deletion journal that's replayed even after backup restores, and the search index is rebuilt from corrected facts only — deleted evidence can't sneak back through re-indexing.)

**Report if:** the deleted item reappears in search, in an AI answer, in a wrap, or after a restart. This is the single most important privacy promise — report even a partial resurfacing (e.g. the title gone but the domain still findable).

---

## 4. Meetings & connectors

All connectors live in **Settings → Activity & data → Connections**. Every card states its exact read-only scopes before you connect. Background sync runs every 15 minutes against each source's own cadence (calendars/GitHub hourly, Linear/Granola every 2 h); every connected card also has a **"Sync now"** button.

### 4.1 Google Calendar **[needs owner setup: Google OAuth Desktop client]**

**Do:** On the Google Calendar card, paste your client ID into **"OAuth client ID (Desktop app)"** (secret is optional), click **Connect**.

**Expect:** the note reads "Waiting for authorization in your browser…", your browser opens Google's consent screen asking for exactly the read-only scopes listed on the card, and after approving you see a page saying "Google Calendar is connected to Daylens. You can close this tab and return to the app." Back in the app: "Authorized. Importing the last 90 days…". If you paste nothing, the error tells you precisely what to create: `Google Calendar needs an OAuth client ID. Create a "Desktop app" OAuth client in Google Cloud Console and paste its client ID here.`

**Report if:** the browser asks for write scopes; connect hangs past ~3 minutes without a useful error; or events older than 90 days flood in.

### 4.2 Outlook **[needs owner setup: Microsoft Entra app — skip if you don't use Outlook]**

**Do:** Paste the Application ID into **"Microsoft application (client) ID (device code flow)"**, click Connect.

**Expect:** a note like "Enter code XXXX-XXXX at microsoft.com/devicelogin to authorize Daylens (opening in your browser)." Type the code, approve, sync starts. Read-only calendar scopes only.

**Report if:** no code appears, or the flow demands a client secret (it shouldn't — this is the device-code flow).

### 4.3 GitHub **[needs owner setup: GitHub App client ID with device flow]**

**Do:** Paste the client ID into **"GitHub App client ID (device flow)"**, list your repos in **"Repositories to sync (owner/repo, comma-separated)"** (1–25 repos — only these are ever read), click Connect.

**Expect:** "Enter code XXXX-XXXX at github.com/login/device to authorize Daylens (opening in your browser)." Type the code on GitHub, approve. Each listed repo is checked as readable at connect time — a typo'd repo fails with a clear message.

**Report if:** data appears from a repo you didn't list, or the code flow never completes after approval.

### 4.4 Linear

**Do:** Create a key at linear.app/settings/api (read access), paste it into **"Personal API key from linear.app/settings/api"**, Connect.

**Expect:** the card validates the key and shows your account as "YourName · workspace". The helper text promises the key "goes straight into your operating system's secure store — never the database, logs, or sync."

**Report if:** an invalid key is accepted, or the key is visible anywhere after saving.

### 4.5 Granola — automatic, local

**Do:** With Granola installed and signed in, just click **Connect** on the Granola card (the cache-path field says it's "found automatically when Granola is installed").

**Expect:** it connects instantly showing your Granola account email (or "Granola on this Mac"); the card says "local — nothing leaves this machine". If Granola isn't installed you get the honest miss: "Granola's local cache was not found or could not be read. Is Granola installed and signed in on this Mac?"

**Report if:** connect succeeds without Granola present, or any sign of Granola data leaving the machine (it's a local file read — no network).

### 4.6 The three kinds of meeting on the Timeline

Set up a day with all three (or find one): a calendar meeting you actually attended on a call, a calendar meeting you skipped, and an ad-hoc call that was never on the calendar.

**Do:** Open that day in Timeline and click around.

**Expect:**
- **Attended (matched):** the captured call block itself carries it. Click the block → detail shows **"Attended meeting · {title}"**, plus "Scheduled {start} – {end} · the time above is what was actually observed" and "With {people}". Two honest correction buttons: **"I didn't attend"** and **"Not this meeting"**.
- **On calendar, no evidence (scheduled-only):** a quiet **dashed outline** at its clock position — no fill, no minutes counted. Its line reads **"Scheduled · no observed activity"**; hover: "on your calendar; no observed activity supports that you attended". Click it to mark attended/skipped/moved/unrelated — marking "attended" turns it into a solid outline reading "Attended · you confirmed".
- **Call not on calendar (captured-only):** just a normal block for the meeting app (e.g. "Zoom") — real observed time, honestly unlabeled as any scheduled event.
- The golden rule: scheduled-only events add **zero** minutes to your day total. Two overlapping calendar events never double your time.

**Report if:** a calendar event you skipped shows as attended or adds minutes; an attended call fails to match its calendar event (that's useful signal — note the meeting title); or the double-booked case counts time twice.

### 4.7 Granola note attached to a meeting

**Do:** Have (or find) a calendar meeting where you took Granola notes. Then: (a) open that day's wrap (Cmd+K → "Open today's/yesterday's Wrapped"), and (b) ask the AI: `What was discussed in the {meeting name} meeting?`

**Expect:** the note corroborates the meeting — a notes-backed meeting counts as "matched" even if capture was thin (notes prove it happened; they never invent minutes). The wrap deck's sources include a **"Meeting notes"** chip, and its meeting scene can use participants and action items. The AI answer draws on the note lines and cites them; transcript excerpts only appear when your question explicitly asks what was said. Note there's currently no note link/excerpt on the Timeline block itself — the notes surface in the wrap and AI answers.

**Report if:** notes from meeting A get attached to meeting B; a notes-only meeting adds observed minutes to the day; or a transcript excerpt appears when you didn't ask about what was said.

### 4.8 "What did I ship last week?" — the cited answer

**Do:** With GitHub (and Linear) connected and synced, ask the AI: `What did I ship last week?`

**Expect:** an answer naming real merged PRs / completed issues, with small superscript citation marks. Click **"Used N sources"** (or a citation chip) → the "What the AI saw" inspector shows the exact lines the model was given, e.g. `GitHub: merged pull request "…" in owner/repo` and `Linear: completed ABC-12 "…" in project …`. Every claim in the answer should trace to one of those lines.

**Report if:** the answer names a PR/issue that isn't in the inspector, invents work, or attributes someone else's PR to you.

### 4.9 Disconnect: keep vs delete

**Do:** On a connected card, click **"Disconnect…"**.

**Expect:** an inline choice appears — label "Imported data:" with three buttons: **"Disconnect, keep data"**, **"Disconnect and delete"** (red), and **Cancel**. Afterwards the card confirms which happened: "Disconnected. Imported data was kept." or "Disconnected. Imported data was deleted." Delete removes everything only that source supported (meetings, people, signals) but never touches things that have independent evidence. Test both directions with a connector you can easily re-add (Linear is quickest). After "delete", check search and an AI question — the source's items are gone, and previously cited answers lose those citations rather than pointing at nothing.

**Report if:** disconnect happens with no keep/delete choice; "delete" leaves the source's data findable; or "keep" wipes it anyway.

---

## 5. AI answers & trust

### 5.1 Ask about the day → live trail → "Used N sources" → the inspector

**Do:** In the AI view (empty state says "Ask Daylens about your work"), type: `What did I actually do this morning?`

**Expect:**
- While it works, a live activity trail: "Thinking", then honest steps like **"Reading the day"**, "Going through your page visits", "Checking time in {app}", finishing with **"Putting the answer together"**. Long trails collapse to the newest few with "N earlier steps".
- Under the finished answer: a pill reading **"Used N sources"** (plus "· M files" if it read files), a step-count pill, and **"What the AI saw"**.
- Click "What the AI saw": a read-only record titled exactly that, subtitled "The exact context recorded for this exchange, before the request left this device." Sections in order: **The question · What left this device** (with an item count, destination, and a content fingerprint) **· Tools consulted · Considered and not sent · Where the record disagreed with itself · Gaps in the record · Permissions consulted**. Footer: it never includes provider system prompts, hidden reasoning, or credentials.

**Report if:** the trail names data it shouldn't touch; "Used N sources" opens nothing; the inspector's item list doesn't plausibly match the answer; or an answer cites something absent from "What left this device".

### 5.2 Conflicts are named, not smoothed over

**Do:** Make a correction that contradicts an automated label (e.g. use scenario 5.4 to relabel a "browsing" block as client work), then ask the AI about that block's time.

**Expect:** the answer tells you the sources disagreed — your correction wins, but the answer says the automated record differed. In the inspector, **"Where the record disagreed with itself"** lists the disagreement, suffixed **"— your correction won"**.

**Report if:** the answer silently asserts one version with no mention of the conflict while the inspector shows one existed.

### 5.3 The empty day, handled honestly

**Do:** Ask: `What did I work on on {a date before you installed Daylens}?`

**Expect:** a plain, one-line honest miss — what it looked for, what does exist (e.g. "tracking started {date}"), no apology theater, and **zero invented activity**. The inspector says "The N items below…" honestly or notes nothing was sent; "Gaps in the record" names the hole.

**Report if:** the AI invents a plausible-sounding day, or pads the miss with fake partial detail.

### 5.4 Fix your day from chat — preview → confirm → undo

**Do:** Pick a mislabeled block and type: `That 2pm block was actually client work for Meridian.`

**Expect:**
- A **preview card** — never a silent change — showing exactly what would happen: the delta per block (`"Old label" (14:00–15:00) → "Client work" (14:00–15:00)`), "Day total: X → Y", "Blocks: N → M", which surfaces change, and always ending **"Reversible — it can be undone afterwards."** Buttons: **"Apply correction"** / **Cancel** (plus a free-text "Or type your own…" — typing there adjusts the proposal, it never counts as consent; ignoring the card applies nothing).
- Click **Apply correction** → check the Timeline: the block is relabeled; Apps and search agree.
- Then type `undo that` → card: **Undo "…"? The day goes back to how it was before this correction.** → **"Undo it"** → everything reverts on every surface.
- The chat can rename, recategorize, adjust times, merge, split, exclude blocks/evidence, and assign clients — it can never permanently delete data (that's deliberate; deletion stays in the UI where you can see it).

**Report if:** any change applies without the preview card; the preview's numbers don't match what actually happens; undo doesn't fully restore; or a correction from chat only changes some surfaces (e.g. Timeline but not search).

### 5.5 Pause mid-answer → quit → reopen → resume

**Do:** Ask something big (`Write a full report of my week`). While it's streaming, click the **Pause** button in the composer (two vertical bars — tooltip "Pause — resume later, even after a restart"). Then fully quit Daylens (Cmd+Q). Reopen it and go back to the thread.

**Expect:** after pausing, the turn shows **"Paused"** with "Resume picks the question back up with your latest activity — no half answer is kept." and **Resume** / **Discard** buttons. After quit+reopen, the thread still shows the paused turn — if the app was killed mid-run it says **"Paused — the app closed while this was running"**, optionally with "It was working on: {last step}". Click **Resume**: it re-runs the question against your current data and completes. (The neighboring square Stop button is different: it discards — "Stopped — no answer was generated." with a Retry.)

**Report if:** the paused turn vanishes after restart; Resume replays a stale half-answer instead of a fresh run; or pause corrupts the thread.

---

## 6. Wraps, recaps & briefs

The Day Wrapped deck opens from the command palette — **Cmd+K → "Open today's Wrapped"** / "Open yesterday's Wrapped" / "Open this week's Wrapped" — and from the notifications below. (Dev shortcuts exist too: Cmd+Shift+Option+W today, +Y yesterday, +E week, and **+N fires a real test notification**.)

### 6.1 Day wrap numbers = Timeline numbers

**Do:** At the end of a tracked day, note the Timeline's day total, then Cmd+K → "Open today's Wrapped" and step through the deck.

**Expect:** the wrap's headline total, work/leisure split, app bars, longest stretch, and meeting facts all reconcile exactly with what Timeline and Apps show — they're computed from the same single source, and every AI-written line is checked against a fact table so it literally cannot contain a number the day doesn't support. If the day has under 2 hours it asks first ("Give the day a little more and come back." with "Generate anyway"); a day with nothing says "A quiet one."

**Report if:** any number in the wrap differs from the Timeline for the same day — even by a few minutes. That's the core promise.

### 6.2 Evening recap

**Do:** Have the day tracked (needs ≥45 min) and leave the app running past your evening hour (default rhythm: 18:00). Check **Settings → Account → Notifications** → toggle **"Evening wrap"** ("End-of-day recap of what you worked on.") is on.

**Expect:** one notification, **"Your evening wrap"**, whose body is the wrap's actual lead line (or, with "Activity-free notification text" on, just "Your evening wrap is ready."). Clicking it opens today's Day Wrapped. The line in the notification must agree with the wrap it opens.

**Report if:** it fires more than once a day, fires on an untracked day, or the notification's sentence contradicts the deck it opens.

### 6.3 Morning brief recaps yesterday

**Do:** Next morning (window: roughly 05:00–12:00 on the standard rhythm; toggle **"Morning brief"**), wait for the notification.

**Expect:** **"Yesterday, in one line"** — a one-liner about yesterday, generated from yesterday's facts as they are NOW (overnight corrections included). Clicking opens yesterday's wrap, deck titled "Yesterday, wrapped", with a "Continue your day" button at the end. It skips mornings where you already viewed yesterday's recap.

**Report if:** it recaps the wrong day, fires when yesterday had <45 min tracked, or the line disagrees with the deck.

### 6.4 Weekly brief opens the week wrap

**Do:** On a Monday morning (toggle **"Weekly brief"** — "Monday morning, the completed week's wrap."), wait for it, or use Cmd+K → "Open this week's Wrapped" any time.

**Expect:** notification **"Your week, wrapped"**; clicking opens the **week** wrap (the period deck, not a day). The week's totals equal the sum of its days' frozen snapshots. A missed Monday is skipped, never delivered late on Tuesday.

**Report if:** it opens a day wrap instead of the week, fires on a non-Monday, or week totals don't sum from the days.

### 6.5 A correction changes the wrap

**Do:** Open today's wrap and note a line it says. Close it, correct that fact (scenario 5.4 or right-click → Edit on the Timeline), and reopen the wrap.

**Expect:** the stored wrap was invalidated by your correction, so reopening generates a fresh one that reflects the fix (the week/month/year wraps containing that day are invalidated too). On the deck's last card, "analysis vN" expands into the version history — you should see a line like **"rewritten after your correction"**. There's also a manual **Regenerate** control (top-bar icon, "Regenerate this wrap with a new AI call").

**Report if:** the reopened wrap still states the pre-correction fact, or the version history hides that a rewrite happened.

---

## 7. Model picker & billing

### 7.1 Costs in dollars AND in questions

**Do:** In the AI view, click the model name under the title bar (or Cmd+K → "Change model…").

**Expect:** a searchable picker ("Search models…") grouped by where each model comes from. Every row prices itself in plain terms:
- Your-own-key models: **"≈ $0.09 per question · about 11 questions per $1"** (your numbers will differ per model) — never token math.
- Managed Daylens AI (when armed): **"$X.XX left · about N questions"**, and when it can't afford one more question: "not enough for a typical question until the allowance resets".
- Subscription CLIs (Claude CLI etc., if detected): "Included in your subscription — Daylens meters nothing".
- Anything unusable is listed under **"Not available right now"** with its reason spelled out (e.g. "No Anthropic API key saved. Add one in Settings → AI.") — never silently hidden.

**Report if:** a cost is shown in raw tokens; a model is silently missing rather than listed with a reason; or the per-question estimate is absurd versus what Usage later records.

### 7.2 Bring-your-own-key works end to end

**Do:** With your Anthropic key connected (setup step), pick an Anthropic model in the picker, ask a question, then open **Settings → Account → Usage**.

**Expect:** the answer works; Usage shows the range picker, "Total spend" and (for managed) "Remaining allowance" as **$ and ≈questions**, a per-feature breakdown (AI chat, Evening wrap-up, Timeline labeling…), a recent-calls table (Date/Feature/Type/Model/Tokens/Cost), and an "Export CSV" button. The key itself lives in the macOS keychain — it should never be readable in any settings file.

**Report if:** questions fail with a valid key; spend rows don't appear; or you can find your API key in plain text anywhere on disk.

### 7.3 Included-credit exhaustion pauses calmly **[needs owner setup: entitlement signing key + billing URL baked into the build — skip in current dev builds]**

**Do:** In an armed build, run the managed allowance to zero (or use the billing sandbox: `node services/billing/sandbox/run.mjs`).

**Expect:** managed AI pauses with this calm message — no scary modal, nothing else breaks:

> "Your included AI credit is used up, so managed AI is paused. Local capture, Timeline, Apps, search, corrections, export, and your own key keep working. Managed AI resumes on {date} — or right away with a subscription change."

Your own key and local features keep working completely independently (the app doesn't even consult billing for the own-key path). At 80% usage a heads-up notification fires first ("Daylens AI: nearing this period's included credit").

**Report if:** exhaustion breaks BYOK or any local feature; the picker invents an allowance number when the billing service is unreachable (it must show none rather than a made-up figure); or no 80% warning preceded the cutoff.

---

## 8. Export & updater

### 8.1 Full-history export you can read without Daylens

**Do:** **Settings → Activity & data → Export your data**. Read the **"What will be included"** preview (sections, totals, date range; note the "Include high-sensitivity items" checkbox, off by default, and "Show what is withheld and why"). Click **"Choose folder & export…"**, pick a folder.

Then close your eyes to Daylens entirely: open the new `daylens-export-…` folder in Finder and, using only Finder/TextEdit/Numbers:
1. Open `index.md` — the human entry point.
2. Find a specific day you remember: `days/2026/2026-07-XX.md` — a readable page of that day.
3. Find a known entity in `summary/entity-totals.csv` (or `data/entities.jsonl`).
4. Find a correction you made (the "Corrections & reviews" data files record them).
5. Open `summary/daily-time.csv` in Numbers and sanity-check a day's total.

**Expect:** success panel says "Export complete" and "This folder is now yours, outside Daylens: deleting something in Daylens later will not reach into it." Everything above is findable and human-readable. Content you deleted in-app is absent; withheld tables (like screen-experiment frames) are named in the manifest rather than silently missing.

**Report if:** a day/entity/correction you know about isn't in the export; deleted or private-window content IS in it; or the folder needs Daylens to make sense of.

### 8.2 Verify the export

**Do:** Back in the Export section, click **"Verify a previous export…"** and select the folder you just made. (Every export also self-verifies before reporting success.)

**Expect:** **"Verified — {N} records across {M} tables match the manifest"**. To see it fail honestly, edit one character in any `data/*.jsonl` file and verify again: "Verification failed: …" naming the mismatched file.

**Report if:** verification passes on a tampered folder, or fails on an untouched one.

### 8.3 Auto-update **[signed flow needs owner setup: Apple Developer ID cert + notarization secrets in the release workflow]**

**Do:** Check **Settings → System → Updates**: a "Check for updates" button and a status line ("You're on the latest version (X)." or "Daylens X is available — install when you want…"). When an update exists, a banner appears: **"Daylens {version} is available"** with **"Install update"**, then "Daylens {version} is ready — Restart once to finish installing" with **"Restart to update"**.

**Expect (today, before Apple creds):** ad-hoc builds update through Daylens' own feed with a checksum check, and the Updates panel honestly explains: "This Daylens build is ad-hoc signed (no Apple Developer ID)… Fresh downloads can still trigger Gatekeeper until Daylens ships with Developer ID signing and notarization." **Once the Apple secrets are in the release workflow**, re-test the full flow on a signed build: install old version → release new → banner → install → relaunch on the new version with all data intact.

**Report if:** an update loses data or settings; "Restart to update" leaves you on the old version; or the app claims an update is ready that then fails silently.

---

## 9. Screen experiment (optional — loud consent by design)

This is off by default and cannot be switched on by anything except your own explicit consent here.

### 9.1 Enabling means informed consent

**Do:** Open **Settings → Activity & data → Screen context**.

**Expect:** five plain-language consent points before any button works, verbatim headlines: "Daylens will take pictures of your screen." (at most one frame every 30 seconds, never video, never audio) / "Each picture is read once, then destroyed." / "Some things are never captured." (private windows, password/payment/security screens, excluded apps, and anything on screen while you're sharing it) / "Nothing leaves this machine." / "You stay in control." Then a checkbox — **"I understand Daylens will capture images of my screen while this experiment is on."** — that must be ticked before **"Join the experiment"** activates. macOS will ask for Screen Recording permission at this point. One honest caveat: this build records and encrypts frames but doesn't yet ship the reader that extracts text from them, so frames wait encrypted in a backlog — the section says so on-screen.

**Report if:** you can join without ticking the box, or sampling starts before you joined.

### 9.2 The indicator is visible and live

**Do:** After joining, look at the menu-bar (tray) icon and hover it. Then click "Pause sampling" and hover again.

**Expect:** while sampling is actually on, the tooltip reads **"Daylens — screen sampling ON (experiment)"** and the Settings section shows **"Joined · sampling ON"** with a red dot. Paused → tooltip back to "Daylens — tracking quietly", status "Joined · paused". The indicator tracks the live sampler state, never a cached setting.

**Report if:** the indicator claims OFF while frames are being taken, or ON while paused.

### 9.3 An excluded app is never captured

**Do:** In **Settings → Privacy & tracking**, turn on "Limit what's tracked" and add an app to **Excluded apps** (e.g. Messages). With the experiment sampling ON, put that app in the foreground for several minutes.

**Expect:** no screen record of it, ever — the exclusion check runs **before any pixel is read**, not as an after-the-fact delete. The Screen context section even surfaces "Excluded apps with screen records" with a "Delete these records" button if an app had records from before you excluded it. Password managers and private windows are refused the same way, unconditionally.

**Report if:** the section ever shows a screen record for the excluded app dated after the exclusion, or a 1Password/private-window frame exists at all.

### 9.4 Full wipe

**Do:** Click **"Delete all screen data…"**.

**Expect:** confirmation — "Delete every screen frame and every extracted screen record on this machine? This cannot be undone." — with a **"Delete everything"** button. After it, zero frames and zero extracted records remain (frames live as individually encrypted files in Daylens' own data folder; the wipe deletes every one plus everything derived). "Leave the experiment…" is a separate flow that also offers "Also delete everything already extracted (recommended)". Bonus check: run an export (8.1) — screen data is *withheld* from exports and named in the manifest as such.

**Report if:** anything screen-related survives the wipe, or screen frames show up in an export.

---

## Known limitations — don't report these as bugs

> - **Second monitor on the Timeline:** second-monitor "visible" time is captured and honestly labeled in the data (and in Settings → Capture health), but no Timeline lane draws it yet. And it's macOS-only — the Windows sampler doesn't exist yet ([#29](https://github.com/spcsorg/daylens/issues/29)).
> - **macOS/Windows CI:** the full packaged-app checks for Mac and Windows run only on merges to `main` and nightly — not on every PR — so a PR can be green while a platform-specific packaging issue waits for the nightly to surface it.
> - **"Sign in with Claude/ChatGPT subscription"** ([#5](https://github.com/spcsorg/daylens/issues/5)) is still open. The model picker already lists detected CLIs as subscription sources, but treat those rows as early — the full sign-in experience isn't built.
> - **Managed billing isn't armed in current builds** (no entitlement public key pinned), so scenario 7.3 stays prerequisite-gated until you mint the key and bake in the billing URL.
> - **Screen experiment has no text extractor yet** — frames are captured, encrypted, and held; nothing is read out of them in this build.

## Reporting a bug

One line is enough, in this shape:

```
[area] I did X → expected Y → saw Z (date/time of the day tested; screenshot if visual)
```

Example: `[meetings] clicked 14:00 Acme sync block → expected "Attended meeting · Acme sync" → block shows no meeting card (Jul 22, ~14:05; screenshot attached)`
