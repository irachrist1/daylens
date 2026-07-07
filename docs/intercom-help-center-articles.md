# Daylens Help Center — full knowledge base (for Intercom / Fin)

**Two ways to get these into Intercom:**

- **Automatic (recommended):** put your Intercom access token in `services/billing/.env`
  as `INTERCOM_ACCESS_TOKEN=…`, then run `node scripts/intercom-import-articles.mjs`
  (add `--dry-run` first to preview). It creates the collections and every article as a
  draft via the Intercom API. Review and publish them in Intercom.
- **Manual:** paste each article below into Intercom → **Help Center → Create article**
  (one article per `##` heading: the heading is the title, the text beneath it is the
  body). The *Collection:* line is the suggested Help Center collection.

Either way, once the articles are **published**, connect the Help Center as a **Fin
content source** (Intercom → AI / Fin → Content) so Fin answers from it instead of
routing to the team.

Everything here is written against the app as it actually ships (checked 2026-07-07).
Two deliberate rules, because Fin will repeat whatever these say verbatim:

- **No invented facts.** Where a personal detail belongs only to Christian, there's a
  `[founder: …]` placeholder — fill or delete it, don't let Fin guess.
- **Customer-appropriate roadmap only.** The public roadmap below is curated. Internal
  security, infrastructure, and build details from the private audit are intentionally
  left out — do not paste those into a customer-facing source.

---

# Collection: Getting started

## What is Daylens?

Daylens is a private, automatic time tracker for your computer. It quietly notices which
app or website is in front of you and builds an honest timeline of your day — no manual
timers, no start/stop buttons, no willpower required.

Three places to look:

- **Timeline** — your day as a vertical schedule, block by block, so you can see where the
  hours actually went.
- **Apps** — the same time rolled up by app and website, with categories, so you can see
  your top tools at a glance.
- **AI** — ask questions about your work in plain language and get answers grounded in
  your own activity.

It runs quietly in your menu bar / system tray. Once tracking permission is granted, you
don't have to do anything for it to keep working.

---

## Why we built Daylens

Most time trackers are built for someone *else* to look at you — a manager, a client, a
billing system. They make you start timers, they nag, and they turn your day into a
timesheet. Daylens is the opposite: it's a tracker built for **you**, to see your own days
clearly and decide what to do with that.

Two beliefs shaped it:

- **Your day should be honest, not performed.** Daylens records what actually happened —
  including the messy parts — so you can reflect on a real day instead of a tidy fiction.
- **Your life is yours.** Your history stays on your computer. Daylens is local-first by
  design: nothing about your activity is uploaded to us. (See "Your privacy" below.)

The goal isn't to make you feel guilty about screen time. It's to give you a calm, true
picture of where your attention goes — and, with AI, to help you make sense of it.

— The Daylens team

---

## What happens in your first few minutes

When you first open Daylens it walks you through a short setup:

1. **Your name**, so the app can talk to you like a person.
2. **A quick "why"** — what Daylens is for.
3. **Permission to see your activity** (macOS only — see "Grant Daylens permission").
4. **Proof it works** — within seconds you'll see your real, live activity appear. This is
   the moment Daylens earns your trust: it's already watching, accurately.
5. **A few personal questions** — your goals, your work rhythm, the categories you care
   about — so the timeline and AI feel like yours.

You can start chatting with us during onboarding if anything is unclear — look for
**"Questions? Chat with us."** There's no account to create and no sign-in.

---

## Grant Daylens permission to track your activity

*Collection: Getting started*

**macOS.** Daylens needs macOS **Accessibility** permission to read the title of the
window you're using — that's how it labels your timeline. During setup Daylens asks for it
and then **relaunches itself**. That relaunch is expected, not a crash. If titles still
don't appear:

1. Open **System Settings → Privacy & Security → Accessibility**.
2. Turn **Daylens** on (toggle it off and on again if it's already listed).
3. **Quit and reopen Daylens** so it picks up the change.

Check this any time under **Settings → Capture health**, which shows whether the
background capture helper is running.

**Windows and Linux.** No separate permission step — tracking starts on its own. On Linux,
window-title capture depends on your desktop environment; **Settings → Capture health**
tells you whether your setup is fully supported, limited, or unsupported.

---

## System requirements and platform support

*Collection: Getting started*

Daylens is a desktop app for **macOS, Windows, and Linux**.

- **macOS** — full tracking via the native capture helper; requires Accessibility
  permission.
- **Windows** — full tracking via the native capture helper; no permission prompt.
- **Linux** — supported, with some limits: window-title accuracy depends on your desktop
  environment, and some Wayland setups capture less detail. Settings → Capture health
  reports your exact status.

Daylens is a computer app — it tracks the machine it's installed on.

---

# Collection: Features

## The Timeline

*Collection: Features*

The Timeline is your day as a schedule you can actually read — each stretch of activity is
a labelled, colour-coded block placed on a vertical clock. Use the date arrows (or
"Today") to move between days.

- **Colours** map to categories (focused work, browsing, communication, and so on).
- **Blocks** group related activity so the day is legible instead of a wall of app
  switches.
- **Run "Analyze day"** to turn the raw activity into clean blocks (see "Analyze day").
- **Edit a block** after analysis to fix its time or label — your edits stick.

---

## The Apps view

*Collection: Features*

Apps rolls your day (or range) up by application and website, sorted by time, grouped into
categories. It's the fastest way to answer "what did I actually spend time in?" — and to
see sites nested under the browser they were used in.

---

## Ask AI about your work

*Collection: Features*

The **AI** view lets you ask questions about your own activity in plain language —
"what did I spend the most time on this week?", "how much time went to email yesterday?",
"when was I most focused?" Answers are **grounded in your local history**, and you can ask
for a written report, a table, or an export. You'll need an AI provider connected first
(see "Turn on AI features").

---

## Analyze day

*Collection: Features*

"Analyze day" (on the Timeline) processes the raw activity of a day into clean, labelled
blocks and unlocks AI features for that day. It becomes available once there's enough of
the day recorded (a couple of hours), so early morning it may not be ready yet. Re-running
it is safe and usually fixes a day that looks off — and it won't overwrite edits you've
made by hand.

---

## Day and period Wrapped

*Collection: Features*

Daylens can turn a day — or a week, month, or year — into a short, shareable **Wrapped**:
a paced, visual recap of where your time and attention went. Day Wrapped is a gentle
end-of-day reflection; period Wrapped (week/month/year) gives you the wider lens. Reach
them from the command palette or the daily summary.

---

## Focus sessions and distraction alerts

*Collection: Features*

Start a **focus session** when you want to concentrate on one thing. Daylens tracks it,
can warn you when the session **drifts** into something distracting (you set the
threshold in minutes), and afterwards lets you jot a quick **reflection** and suggests
when a break might help. Turn distraction alerts and the threshold on in **Settings →
Notifications**.

---

## Morning brief and evening wrap

*Collection: Features*

Daylens can nudge you at the edges of the day:

- **Morning brief** — a short recap of yesterday and a look at the day ahead.
- **Evening wrap** — an end-of-day summary of what happened.

Both are off by default; turn them on in **Settings → Notifications**. (Note: the AI
summaries inside them need an AI provider connected.)

---

## Clients and projects

*Collection: Features*

If your time maps to clients or projects, Daylens can attribute it. Create clients in
**Settings → Clients**, then assign sessions to a client or project so you can see time by
who or what it was for — useful for freelancers and anyone billing their hours.

---

## Labels and categories

*Collection: Features*

Every app and site falls into a category that drives the timeline's colours and the Apps
grouping. In **Settings → Labels** you can override how a specific app or site is
categorised, and choose whether that override propagates. This is how you teach Daylens
that, say, a particular site is "work" and not "browsing."

---

## Memory — what Daylens knows about you

*Collection: Features*

Daylens builds a small **work memory** — facts about how you work — so the AI's answers
feel personal instead of generic. You can see and manage what it has remembered in
**Settings → Memory**. It's yours to review, add to, or clear.

---

## Search and the command palette

*Collection: Features*

Press **⌘K (macOS) / Ctrl+K (Windows & Linux)** to open the command palette — jump to any
view, search your activity in natural language, and reach features like Wrapped quickly.

---

## Connect Daylens to Claude Desktop, Cursor, or Claude Code (MCP)

*Collection: Features*

Daylens can act as a local **MCP server** so other AI apps can read your activity and you
can ask *them* about your work. It's off by default and **read-only** — connected apps can
only read, nothing is written, and nothing leaves your machine except what you ask about.
Turn it on in **Settings → MCP server** and copy the shown config into your MCP client
(Daylens displays the exact file path for your platform).

---

# Collection: Privacy & data

## Your privacy: where your data lives and what leaves your computer

*Collection: Privacy & data*

Daylens is local-first. Your activity history is stored in a database file on your own
computer — it is **not** uploaded to a Daylens server.

- **macOS:** `~/Library/Application Support/Daylens/daylens.sqlite`
- **Windows:** `%APPDATA%\Daylens\daylens.sqlite`
- **Linux:** `~/.config/Daylens/daylens.sqlite`

The only time anything leaves your machine is when **you** use an AI feature — then your
request goes directly to the AI provider whose key you connected, and nowhere else. Window
titles, URLs, and file paths are never sent anywhere as part of tracking.

---

## Private / incognito browsing is never recorded

*Collection: Privacy & data*

When you're in a private or incognito browser window, Daylens records nothing for it — no
site, no time. You don't need to configure anything; it's automatic.

---

## Pause tracking, or exclude an app or website

*Collection: Privacy & data*

You're always in control of what's recorded.

- **Pause tracking** from the menu bar / tray icon or in **Settings → Privacy &
  tracking**. Nothing is recorded until you resume.
- **Exclude an app or website** so Daylens never tracks it — in **Settings → Privacy &
  tracking**. You can also **delete already-recorded history** for a specific app or site
  there.

---

# Collection: AI & billing

## Turn on AI features (bring your own key)

*Collection: AI & billing*

Daylens works fully as a tracker without any AI. To use the AI features (asking about your
work, Analyze day, summaries, Wrapped narration), connect a provider you already have:

1. Go to **Settings → Provider & model**.
2. Choose **Anthropic**, **OpenAI**, **Google**, or **OpenRouter** and paste your API key.
   (If you use the Claude CLI or Codex CLI, you can select those modes instead of a key.)
3. Save. Your key is stored securely on your device and used only to talk to that provider.

If AI features are greyed out, it's because no provider key is connected yet.

---

## AI costs and usage

*Collection: AI & billing*

Tracking, the Timeline, and the Apps view are always available and are never billed.

AI features run on **your own provider key**, so any AI cost is billed by that provider
directly to you — Daylens doesn't add a charge on top. See your estimated AI spend and
export it in **Settings → Usage** (there's an **Export CSV** button).

---

# Collection: Troubleshooting & account

## My day looks wrong — how do I fix it?

*Collection: Troubleshooting & account*

- **Run "Analyze day"** on the Timeline — it reprocesses the day into clean blocks. It
  unlocks once a couple of hours are recorded.
- **Edit a block** after analysis to adjust its time or label; your edits are kept.
- If a whole day looks badly off (for example after your computer slept across midnight),
  re-running Analyze day usually straightens it out.

If it's still wrong, open **Settings → Help & support → Chat with us** and tell us what you
saw versus what you expected — that kind of report usually turns into a fix.

---

## Titles or activity aren't being captured

*Collection: Troubleshooting & account*

Open **Settings → Capture health**. It shows whether the background capture helper is
running and, on macOS, whether Accessibility permission is granted.

- **macOS:** if titles are missing, re-check Accessibility permission and **quit and
  reopen** Daylens (see "Grant Daylens permission").
- **Linux:** capture depends on your desktop environment; Capture health will say if
  you're supported, limited, or unsupported.

---

## Updating Daylens

*Collection: Troubleshooting & account*

Daylens keeps itself up to date automatically. You can see the current version and update
status in **Settings → Updates**.

---

## Getting more help

*Collection: Troubleshooting & account*

Open **Settings → Help & support → Chat with us**, or reach the same chat during
onboarding via **"Questions? Chat with us."** Your message comes straight to us and you'll
get a reply right in the app and by email.

---

# Collection: What's coming

## The Daylens roadmap

*Collection: What's coming*

Here's where Daylens is headed. This is a direction, not a set of dated promises — things
move around as we learn.

- **Even more accurate timelines.** We're unifying how activity is captured so daily
  totals are trustworthy in every situation, including tricky ones like sleep and
  cross-midnight days.
- **A managed AI option.** Today AI runs on your own provider key; we're working on a way
  to use Daylens AI without bringing your own key.
- **Deeper Windows & Linux support.** Bringing the Windows and Linux experience fully in
  line with macOS, including richer capture on Linux.
- **History that stays fast and safe for years.** Ongoing work so your data stays quick to
  query and resilient as it grows over months and years of use.
- **Sync across your devices.** Securely bringing your Daylens history to more than one
  machine (planned; today Daylens tracks the computer it's installed on).

Want to shape this? Tell us what you wish Daylens did — **Settings → Help & support → Chat
with us**. Requests genuinely change the order of this list.
