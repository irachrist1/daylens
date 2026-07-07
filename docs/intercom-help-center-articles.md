# Daylens Help Center — starter articles (for Intercom / Fin)

Paste each article below into Intercom → **Help Center → Create article** (one article
per `##` heading: the heading is the article title, the text under it is the body).
Once they're **published**, connect them as a **Fin content source** (Intercom → AI /
Fin → Content) so Fin can answer from them. Grouped into three collections; the
suggested collection is noted under each title.

Everything here is checked against the app as of 2026-07-07. Keep it accurate when the
app changes — Fin will repeat whatever these say.

---

## What is Daylens, and how does it track my time?

*Collection: Getting started*

Daylens is a private, automatic time tracker for your computer. It quietly notices which
app or website is in front of you and builds a timeline of your day — no manual timers,
no start/stop buttons.

There are three main places to look:

- **Timeline** — your day as a vertical schedule, block by block, so you can see where
  the hours actually went.
- **Apps** — the same time rolled up by app and website, so you can see your top tools
  at a glance.
- **AI** — ask questions about your work ("what did I spend the most time on this week?")
  and get answers grounded in your own activity.

Daylens runs in the background and lives in your menu bar / system tray. You don't have
to do anything for it to work once tracking permission is granted.

---

## Grant Daylens permission to track your activity

*Collection: Getting started*

**macOS.** Daylens needs macOS **Accessibility** permission to read the title of the
window you're using (that's how it labels your timeline). During setup Daylens will ask
for it and then **relaunch itself** — this is expected, not a crash. If titles still
aren't showing up:

1. Open **System Settings → Privacy & Security → Accessibility**.
2. Turn **Daylens** on (toggle it off and on again if it's already listed).
3. **Quit and reopen Daylens** so it picks up the new permission.

You can check this any time in Daylens under **Settings → Capture health**, which shows
whether the background capture helper is running.

**Windows and Linux.** No separate permission step is required — tracking starts on its
own. On Linux, window-title capture depends on your desktop environment; Settings →
Capture health will tell you if your setup is fully supported, limited, or unsupported.

---

## Your privacy: where your data lives and what leaves your computer

*Collection: Privacy & data*

Daylens is local-first. Your activity history is stored in a database file on your own
computer — it is not uploaded to a Daylens server.

- **macOS:** `~/Library/Application Support/Daylens/daylens.sqlite`
- **Windows:** `%APPDATA%\Daylens\daylens.sqlite`
- **Linux:** `~/.config/Daylens/daylens.sqlite`

The only time anything leaves your machine is when **you** use an AI feature — then your
request goes directly to the AI provider whose key you connected (for example Anthropic,
OpenAI, or Google), and nowhere else. Window titles, URLs, and file paths are never sent
anywhere as part of tracking.

**Private / incognito browsing is never recorded.** When you're in a private or incognito
browser window, Daylens records nothing for it — no site, no time.

---

## Turn on AI features (bring your own key)

*Collection: AI*

Daylens works fully as a tracker without any AI. To use the AI features (asking about
your work, Analyze day, summaries), connect an AI provider you already have an account
with.

1. Go to **Settings → Provider & model**.
2. Choose a provider — **Anthropic**, **OpenAI**, **Google**, or **OpenRouter** — and
   paste your API key. (If you use the Claude CLI or Codex CLI, you can select those
   modes instead of pasting a key.)
3. Save. Your key is stored securely on your device and is used only to talk to that
   provider.

If AI features are greyed out, it's because no provider key is connected yet — add one
in Settings → Provider & model and they'll turn on.

---

## Pause tracking, or exclude an app or website

*Collection: Privacy & data*

You're always in control of what Daylens records.

- **Pause tracking** from the menu bar / tray icon, or in **Settings → Privacy &
  tracking**. While paused, nothing is recorded until you resume.
- **Exclude an app or website** so Daylens never tracks it, in **Settings → Privacy &
  tracking**. You can also delete already-recorded history for a specific app or site
  from there.
- **Private / incognito browser windows** are excluded automatically — you don't have to
  do anything.

---

## My day looks wrong — how do I fix the timeline?

*Collection: Using Daylens*

A couple of things help here:

- **Run "Analyze day"** on the Timeline. This processes the raw activity into clean,
  labelled blocks. Analyze unlocks once there's enough of the day tracked (a couple of
  hours), so early in the morning it may not be available yet.
- **Edit a block** directly on the Timeline once the day has been analyzed — adjust its
  time or how it's labelled. Your edits are kept and won't be overwritten when Daylens
  re-processes the day.

If a whole day looks badly off (for example after your computer was asleep across
midnight), re-running Analyze day usually straightens it out.

---

## Billing and AI costs

*Collection: AI*

Tracking, the Timeline, and the Apps view are always available and are not billed.

AI features run on **your own provider key** (see "Turn on AI features"), so any AI cost
is billed by that provider directly to you — Daylens doesn't add a charge on top. You can
see your estimated AI spend and export it in **Settings → Usage** (including an **Export
CSV** button).

---

## Connect Daylens to Claude Desktop, Cursor, or Claude Code (MCP)

*Collection: Using Daylens*

Daylens can act as a local **MCP server**, so other AI apps can read your activity and
you can ask them about your work. It's off by default and read-only — connected apps can
only read, nothing is written, and nothing leaves your machine except what you choose to
ask about.

Turn it on in **Settings → MCP server**, then copy the shown configuration into your MCP
client's config file (Daylens shows the exact path for your platform).

---

## Updating Daylens and getting more help

*Collection: Getting started*

Daylens keeps itself up to date automatically; you can also check the current version and
update status in **Settings → Updates**.

Still stuck? Open **Settings → Help & support → Chat with us** and send a message — it
comes straight to us and you'll get a reply right in the app (and by email).
