# Wrapped: yes or no?

**Model: GPT-5.5 (Codex)**  
**Verdict: No, not in the literal “understands your whole day, for everyone on Mac and Windows” sense.**

**Yes**, Daylens can build a genuinely useful and unusually honest recap of the
part of a day it observes on one computer. It can tell a coherent story, surface
things the user forgot, reconcile observed time, and earn trust by naming what it
saw and what it did not.

**No**, it cannot reliably know what a person did, accomplished, read, said, or
thought across every app, device, account, and private surface. No desktop app
can get that from local access alone. An AI model does not close this gap; it can
only make unsupported guesses sound convincing.

That distinction should be the product promise.

> Daylens can tell the best evidence-backed story of the time it saw on this
> computer. It cannot tell the whole truth of a human day unless the user adds
> more sources, and even then it must show the seams.

## What is actually buildable now

The current codebase already has the right foundation for a real product:

| Evidence | What Daylens can know honestly | Important boundary |
| --- | --- | --- |
| Foreground app/window | Which visible application/window was active, when, and for how long; idle/sleep gaps; a window title when the app exposes one | Foreground is not attention, comprehension, or output. A title can be blank, generic, stale, or contain sensitive text. |
| Browser context | For supported browsers, the focused URL/domain/page title and dwell time; browser history can supplement it | A tab title or URL is not proof that the page was read or that its content drove the work. Same-title tabs and background media are known ambiguity. |
| Timeline blocks | A reconciled, editable timeline of observed stretches, with detours absorbed and corrections preserved | Block intent is an inference from evidence. It must be labelled uncertain or left broad when evidence is thin. |
| Local Git and `gh` | Local commits attributable to the configured author, plus PR activity when the user's authenticated `gh` CLI works | Commits are evidence of repository activity, not proof of all work or of code quality. Repos outside the bounded scan, uncommitted work, other authors, and unauthenticated GitHub are missed. |
| Local calendar | Scheduled meeting titles, start times, duration, and attendee count from a reachable local calendar client | Calendar means scheduled, not attended. Notes, decisions, and outcomes are not implied. |
| Opt-in local focus tools | A small amount of timer/session evidence where a readable local store exists | This is app- and version-specific, not a platform capability. |
| User corrections | The user can rename/merge/attribute evidence and those corrections survive rebuilds | This is the only durable authority for intent that the machine cannot observe. |

The existing implementation also does several necessary honesty-preserving things:

- It excludes system noise and treats long inactivity/sleep as gaps rather than work.
- It never records private/incognito windows when it can identify them.
- It reconciles website time against foreground-browser time rather than adding both.
- It has a Wrap preflight that warns about low activity, missing titles, stale capture, an unanalyzed day, and demonstrable partial capture.
- It uses one facts layer for Timeline, Apps, and Wrapped, so a recap total can reconcile with the visible timeline.

This is enough to make a recap that can often say: “From 9:10 to 11:40 you
worked on the billing change in Cursor and Terminal; Git shows three commits;
your calendar had the design review at noon.” That is real value.

## The hard walls

### 1. Desktop focus is not a record of a person’s day

The operating systems can expose the foreground window and, sometimes, its
accessibility metadata. They do not expose a universal semantic event stream.
They cannot tell whether the person was reading, writing, in a conversation,
thinking away from the keyboard, or merely left an app open. A one-hour Cursor
window is evidence of an hour with Cursor foregrounded, not proof that a feature
shipped.

The inverse problem also exists: a person can work materially while the desktop
shows little or nothing useful: paper notes, a phone call, a whiteboard, a second
computer, a VM/RDP session, a physical meeting, or a mobile device. A local
desktop app cannot discover this by itself.

**Product rule:** narrate observed time, not total time or total effort. Never
turn a missing signal into leisure, idleness, or a negative judgment.

### 2. “Every app” is impossible without per-app cooperation

Window title support is optional and inconsistent. Some apps expose rich titles;
others expose nothing, a generic document name, or a title that changes late.
Accessibility APIs can return “not implemented.” Browser tab access varies by
browser, version, profile, permissions, and UI implementation. The current
Windows helper intentionally emits unknown tab context for Firefox-family
browsers; on macOS, Firefox has no AppleScript tab path in the current capture
route.

Capturing screen pixels/OCR would not solve this cleanly. It would be expensive,
privacy-hostile, still fail on protected/remote/elevated surfaces, and would turn
passwords, messages, medical information, source code, and financial data into
material the app must secure. It is a different product with a much higher trust,
security, and legal burden, not a harmless completeness upgrade.

### 3. Encryption and protected local stores are real stop signs

Some useful-looking data is deliberately unavailable. The project has already
verified that Raycast Focus history is SQLCipher-encrypted, and Granola’s live
meeting cache/database is encrypted. Those are not parsing bugs. Without a
supported export or an authenticated API, Daylens should not attempt to obtain
keys, bypass encryption, scrape memory, or pretend it has the data.

The same class includes keychains/credential vaults, encrypted app databases,
DRM content, end-to-end encrypted chat, private browser profiles, and files the
current user or device-management policy does not permit it to read.

**Hard line:** encrypted or access-controlled data is unavailable unless its
owner explicitly supplies it through a supported permissioned integration.

### 4. Logins turn “local reach” into an integration product

Calendar, Slack/Teams, Notion, Linear/Jira, Gmail/Outlook, GitHub, meeting notes,
and cloud documents are not universally available merely because their desktop
app or browser tab was open. A reliable connector needs a supported API, an
explicit OAuth/API-token grant, account/tenant policy approval, scope management,
revocation, data retention policy, error handling, and a clear consent surface.

The current local Git path is useful but not universal. Its GitHub enhancement
only works when `gh` is installed and authenticated. The current macOS calendar
path depends on the optional `icalBuddy` command; the Windows path depends on
configured classic Outlook COM. Microsoft documents that Outlook object-model
access requires Outlook installed and configured on that computer; it is not a
portable source for every Windows user. [Microsoft Learn: Outlook API selection](https://learn.microsoft.com/en-us/office/client-developer/outlook/selecting-an-api-or-technology-for-developing-solutions-for-outlook)

Use first-party APIs where possible. They are explicit about their limits, which
is exactly what this product needs.

### 5. Mac and Windows are not one capture platform

**macOS**

- Rich window capture requires Accessibility permission. Apple treats
  Accessibility and Automation as controlled privacy capabilities, and browser
  tab reads via Apple Events require per-target approval. [Apple: Privacy &
  Security settings](https://support.apple.com/guide/mac-help/change-privacy-security-settings-on-mac-mchl211c911f/mac)
  [Apple: Automation consent](https://support.apple.com/en-euro/guide/mac-help/mchl108e1718/mac)
- A robust native calendar connector should use EventKit and ask for calendar
  access, rather than depend solely on a third-party CLI. EventKit explicitly
  permits denial and requires the app to handle it. [Apple: EventKit event
  access](https://developer.apple.com/documentation/eventkit/ekeventstore/requestfullaccesstoevents%28completion%3A%29)
- A Mac App Store build cannot retain the present broad capture design unchanged:
  App Sandbox restricts file access and lists Accessibility APIs and arbitrary
  Apple Events among incompatible activities. A direct-download/notarized build
  and an App Store build have materially different ceilings. [Apple: Sandbox
  restrictions](https://developer.apple.com/documentation/security/protecting-user-data-with-app-sandbox)

**Windows**

- Foreground/window metadata is feasible through Win32/UI Automation. It is not
  universal semantic capture. UI Automation only sees what the target app exposes.
- Windows security prevents ordinary UI automation from interacting reliably
  with elevated apps, other-user processes, locked desktops, UAC prompts, and
  several RDP/secure-desktop cases. [Microsoft: UI Automation
  overview](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-overview)
  [Microsoft: UIPI limitations](https://learn.microsoft.com/en-us/troubleshoot/power-platform/power-automate/desktop-flows/ui-automation/uipi-issues)
- Browser tab extraction is particularly fragile: Chromium accessibility trees
  can work; Firefox-family context is unknown in the current helper; enterprise
  policy, browser changes, multiple profiles, and elevated browsers can break it.
- Outlook COM is a **classic Outlook, logged-in-machine** dependency, not a
  Windows calendar API. New Outlook and non-Outlook calendars need a separate,
  consented connector strategy.

So: a supported Mac/Windows product is feasible. A promise of equal evidence
quality on every Mac and every Windows machine is not.

### 6. Privacy exclusions deliberately create blind spots

Private/incognito windows must remain untracked. Excluded apps/sites, guest and
work profiles, locked devices, and user-disabled permissions must also remain
blind spots. Browser extensions can broaden tab coverage, but even Chrome makes
URL/title access a sensitive permission and requires the user to separately
enable incognito/file access. [Chrome: tabs permissions](https://developer.chrome.com/docs/extensions/reference/api/tabs)

That is correct behavior. “We can see less” is not a defect when the user chose
privacy. The recap must say “not observed” rather than imply a full day.

## Where the data is honest, and where it lies if we phrase it badly

| Claim | Honest phrasing | Dishonest phrasing |
| --- | --- | --- |
| App time | “Cursor was foreground for 2h 14m.” | “You coded for 2h 14m.” |
| Page visit | “You had this page open for 12m while the browser was active.” | “You read this article for 12m.” |
| Calendar | “Your calendar held a 30-minute design review.” | “You attended a 30-minute design review.” |
| Git | “Three commits were recorded in this repo under your configured author.” | “You finished three pieces of work.” |
| No capture | “Daylens did not observe this part of the day.” | “You were idle / off task / resting.” |
| Model inference | “The evidence is too thin to name this stretch.” | A polished guessed project name. |
| Cross-device activity | “Not in this computer’s record.” | “It did not happen.” |

The Daylens invariants already point the right way: one truth across views,
corrections win, no grades, and no filling gaps with guesses. Keep those. The
feature fails the moment a poetic recap quietly upgrades weak evidence into fact.

## Can quality be held reliably rather than achieved once by luck?

**Not with a prompt and an LLM judge alone. It can be held to a meaningful,
bounded standard with a layered quality system.**

The current Wrapped benchmark is a strong start, not final proof. It runs the
production generation route against real local fixtures, rejects fallback lines,
requires every slide to clear 7/10 and a prose-deck average of at least 9/10, and
logs reasoning. That has found real defects: timeouts, invented clock times,
bad category attribution, raw-label leaks, and data reconciliation mistakes.

But its own recorded evidence says why it cannot certify universal quality:

- It is stochastic. Earlier runs varied roughly plus/minus 0.4 on deck average;
  a one-off passing score was not repeatable. Recent live-day runs are much
  stronger, but a handful of successful runs is not a distribution.
- The writer and judge are models. A model judge is useful for triage and style,
  but cannot independently establish truth from an incomplete fact set, and can
  share blind spots with the writer.
- The listed fixtures are a small slice of one person’s data. They cannot cover
  Windows machines, browser families, managed devices, other languages,
  disabled permissions, missing titles, partial days, or every app update.
- The benchmark currently evaluates the story against Daylens facts. That catches
  narration errors, but cannot prove that the facts match what the person really
  did. Capture and attribution need their own ground-truth evaluation.

### The benchmark that would be honest enough to gate releases

1. **Separate the three questions.**
   - Capture accuracy: did the system preserve foreground, idle/sleep, browser,
     and permission events correctly?
   - Interpretation accuracy: did blocks and labels match a human-verified
     activity diary without overclaiming?
   - Narrative accuracy: did the generated recap use only approved facts and
     say something useful?

2. **Build a consented, versioned gold corpus.** Capture raw event traces plus a
   contemporaneous user diary, calendar/Git artifacts, app/version/browser/OS,
   permissions, and known gaps. Include Mac and Windows, Chromium/Safari/Firefox,
   multiple profiles, private-mode transitions, locked/sleep/RDP/elevated cases,
   titleless apps, background audio/video, meetings, no-work days, and late app
   launch. Do not use hidden private content as ground truth.

3. **Use deterministic validators before AI scoring.** Reconciliation, clock
   tokens, source provenance, raw-label/path/URL filters, no claims across an
   unobserved gap, category arithmetic, and correction persistence should be
   ordinary tests. They should never depend on an LLM’s taste.

4. **Use blinded human review and an independent judge model for sampled
   releases.** Human raters should see the approved evidence and recap, not the
   generator’s chain of reasoning. Measure factual precision, unsupported-claim
   rate, useful specificity, calibration (“I don’t know” when appropriate), and
   privacy leakage. LLM judging can scale this, but not replace it.

5. **Measure distributions, not best runs.** Gate on repeated generations and
   publish worst-case/percentile failure rates, not a max score. Pin model
   versions where possible; re-run the corpus on a provider/model/prompt change.
   If a provider cannot meet the bar, show a clearly labelled factual fallback or
   do not offer a literary wrap. Never pass off canned copy as AI.

6. **Make coverage visible in-product.** Every recap needs a small evidence card:
   coverage window, gaps, title/browser coverage, sources used, sources absent,
   and confidence in the *evidence*, not a personality score for the user.
   “Observed 9:12am–6:04pm; browser titles unavailable; calendar not connected”
   is far more trustworthy than a generic disclaimer.

7. **Treat platform/app integrations as contract tests.** Maintain a compatibility
   matrix and automated smoke tests for supported OS/browser releases. When an
   app update breaks a connector, disable that evidence source and surface its
   absence rather than silently substituting inferred data.

## The honest product ceiling

### Strong, shippable version

An opt-in desktop timeline plus recap that:

- observes active local activity and clearly brackets the observed window;
- turns strong, multi-source evidence into a story of work on that computer;
- accepts Git/calendar/user-connected services as separately consented evidence;
- allows the user to correct intent and preserves those corrections;
- never grades the person or infers missing time;
- cites/links each claim internally to its evidence and explains gaps; and
- degrades from “specific story” to “thin but truthful record” when coverage is
  poor.

This can be excellent. It will feel magical on a well-instrumented day, while
remaining honest on a messy one.

### Not shippable as a promise

- “We understand your whole day.”
- “We know what you got done” from app/window time alone.
- “Works the same for everyone on Mac and Windows.”
- “No setup, no permissions, no logins, but all your context is here.”
- “The benchmark guarantees recap quality” when it only grades model prose
  against the app’s own incomplete facts.

## Recommendation before investing further

Proceed **only** if the product is deliberately scoped to an evidence-backed
recap of one computer, with optional connectors and explicit coverage. Do not
proceed if the core bet requires automatic, universal, whole-life understanding.

The next investment should not be a larger prompt or more wrap layouts. It should
be:

1. A platform/source capability matrix with live Mac and Windows validation.
2. First-class provenance and coverage in the facts model and UI.
3. A connector policy: supported export/API/OAuth or nothing; no cache scraping
   as a product dependency, no decryption/bypass work.
4. A gold dataset plus separate capture, interpretation, and narration benchmarks.
5. A real Windows test fleet before claiming parity; the repository itself notes
   that Windows capture paths were reviewed but not manually verified on a real
   Windows day.

If those conditions are acceptable, this is buildable for real and can be better
than a chart dump. If the requirement is “fully understands everyone’s day by
itself,” the honest answer is no.

## Evidence reviewed

This conclusion was grounded in the current Daylens implementation and its
recorded live-data findings, especially:

- `src/main/services/tracking.ts`, `focusCapture.ts`,
  `windowsFocusCapture.ts`, and `browserContext.ts`
- `src/native/capture-helper/main.swift` and
  `src/native/windows-capture-helper/Program.cs`
- `src/main/services/gitSignals.ts`, `calendarSignals.ts`,
  `enrichmentDiscovery.ts`, `externalSignals.ts`, and `wrapPreflight.ts`
- `docs/findings.md`, `docs/specs/wrapped.md`,
  `docs/wrapped-benchmark-log.md`, and `tests/wrappedBenchmark.test.ts`

The external platform limits above are supported by the linked Apple, Microsoft,
and Chrome primary documentation, checked 2026-07-10.

---

## Claude Fable 5 — 2026-07-10

Independent pass over the capture layer, the connectors, the sanitizer/guard chain, the
benchmark harness, and the live benchmark log, done directly in code before reading the
other sections.

### The straight answer

**Yes — with a hard, nameable ceiling.** The core of this feature is not speculative:
most of it is already running in this repo, and the benchmark gate (every slide
AI-written and ≥7, deck average ≥9) passed on **both live days, twice back to back,
with no changes between runs** — Jul 10: 9.78/9.78, Jul 9: 9.36/9.73. But
"everything a desktop app can reach on its own" has real walls, two connectors are not
yet "for everyone," and the quality proof so far covers exactly one user's data
distribution. That last caveat is the biggest honest risk in this whole file.

### What the app verifiably reaches on its own today (checked in code, not docs)

- **Foreground truth, both platforms.** Native helpers stream app/window/tab focus
  events into `focus_events` — macOS via an NSWorkspace + Apple Events Swift helper
  (`src/native/capture-helper`), Windows via a UIA C# helper
  (`src/native/windows-capture-helper`). Sleep/wake/lock/unlock are captured, so idle
  is bounded honestly. `focus_events` is the proven ground-truth layer: the tracking
  engine was rebuilt *from it* after the Jul 6 repair.
- **Browser reality.** Live tab URLs (Apple Events on Mac; UIA address-bar
  `ValuePattern` read on Windows, Chromium only) plus retroactive history from local
  SQLite for Chrome, Edge, Brave, Arc, Dia, Comet on both platforms and Firefox on
  Windows (`browser.ts` copies History+WAL+SHM before opening — no lock contention).
  Private windows excluded by design, and that's correct.
- **What you actually shipped.** `gitSignals.ts` scans dev roots, reads the day's
  commits by the configured author, asks the user's own authenticated `gh` for PR
  activity. This is the single highest-leverage enrichment — it turns "1h 26m in Warp"
  into "seven commits to Daylens" — and it is local, silent, and free.
- **Meetings, partially** (see walls): `calendarSignals.ts` reads what's already synced
  — icalBuddy on Mac, Outlook COM on Windows. Titles, start, duration, attendee count
  only. Live-verified invocation; all-day events honestly dropped.
- **Honesty plumbing that already exists:** preflight gate (`wrapPreflight.ts`) that
  names thin data before wrapping; tombstones so a stale signal can't serve yesterday's
  commits as today's; sanitizers that strip paths, branches, URLs, and smuggled clock
  times before the writer sees them (`enrichmentResolve.ts`); runtime grounding guard →
  one repair round → deterministic fallback, with rejection reasons logged.

### Where the data is honest and where it lies

- **Honest:** durations, clock windows, app rankings, longest unbroken runs, and the
  work/leisure split all derive from observed focus events, with sleep/lock bounding
  the gaps.
- **Has lied before, now guarded:** classification is inference, not observation — it
  mislabelled localhost leisure as dev work and split days at midnight. Both fixed with
  tests, but that layer stays the least trustworthy. The runtime guard is what keeps a
  classification wobble from becoming a confident false sentence: the floor on any
  machine is a correct deterministic line, never a hallucinated one.
- **Structurally blind, and it must say so:** off-device time, private windows, and the
  *content* of work — it sees you were in a doc, not what the doc said. The preflight's
  posture is right: a recap that names its blind spots stays honest.

### Hard walls (verified, not guessed)

1. **Meeting notes/transcripts.** Granola's local store is encrypted
   (`cache-v6.json.enc`; granola.db is not plaintext SQLite) — verified on a real
   install 2026-07-10. The notes path in `enrichmentResolve` is dormant: no collector
   writes the signal. The only path is an authenticated API connector — which changes
   the deal from "reaches on its own" to "user logs in."
2. **Raycast focus history** is SQLCipher-encrypted (verified 2026-07-08). Presence
   detection is the ceiling; the code already treats it that way.
3. **Communication content** (Slack, email, iMessage): encrypted, TCC-locked, or
   absent locally. Not reachable without OAuth, full stop.
4. **Safari history** needs Full Disk Access; handled gracefully with a status flag in
   `browser.ts`, but many users will never grant it.
5. **Screen content.** OCR/screenshots would read what metadata can't, but that's a
   different privacy contract and a different product. Correctly out of scope.

### Not walls — gaps that are engineering hours, not physics

- **Calendar on Mac depends on icalBuddy** — a Homebrew power-user tool. Normal users
  don't have it. For-everyone fix: native EventKit read (one permission prompt).
- **Calendar on Windows uses classic Outlook COM** — "new Outlook" and
  Google-Calendar-in-browser users get nothing. Meet/Zoom URL inference recovers some;
  full coverage needs OAuth.
- **Windows Timeline backfill is dead on Win11 22H2+** (Microsoft removed it), so
  first-day backfill on modern Windows leans on browser history alone.
- **Firefox live tabs on Windows** are history-lagged (the UIA reader is Chromium-only).
- **Focus-app detection returns `[]` on Windows** today.

### Can the quality be held reliably, not by luck?

The benchmark is real and genuinely brutal: it runs the **exact production path**
against a read-only copy of the **real DB** with the **real provider** — no mocks. The
judge is grounded (any number, clock time, percentage, or name not in the slide's facts
is an automatic accuracy 0), and a guard-rejected line that fell back to the
deterministic floor counts as an **AI failure**, not a pass.

One correction to earlier variance concerns in this file's history: the harness now
scores each dimension by the **median of 3 judge samples** (`JUDGE_SAMPLES`,
`tests/wrapped-bench/harness.ts`), the wildcard slide was fixed **by contract** (tie
the hook to one other real named fact), not by luck, and the log shows the full gate
passing twice back to back with zero changes between runs. Residual variance is a 7–10
swing on light caption slides — all passing. The broader point stands, though: the
benchmark correctly punishes narrating garbage, so it will fail whenever capture or
classification lies upstream. That is the benchmark working, not failing.

**The caveat that matters most:** the benchmark has only ever eaten one person's days.
Two live days from one founder proves the machine works; it does not prove it works on
a day with 14 meetings and zero commits, a designer's day, or a nearly-empty day.
That's a fixture problem, not an architecture problem — the harness already supports
foreign fixtures. Until alien day-shapes are in the fixture set, "held reliably" is an
honest claim about this machine only.

Also worth naming: writer and judge are Anthropic API calls — the recap needs a key, a
network, and per-deck spend. Rate limiting and cost tracking exist; "for everyone"
makes this a billing decision, not a technical one.

### The honest ceiling

The buildable-for-everyone recap knows: every app, window, and site you touched and for
how long (private windows excluded, Safari behind FDA), what you shipped in git and
PRs, your meetings (after the calendar work above), and the day's rhythm — start,
longest unbroken run, the three returns to Warp, the forgotten 16 minutes in Google
Docs — told in grounded prose a brutal judge scores 9+.

It will never know, without logins: what was said in meetings, what you wrote in email
or Slack, what happened off the device, or what was inside a private window. "Catches
what you forgot" holds at the level of forgotten *time* and forgotten *apps* — it
cannot catch a commitment made verbally in a meeting. Opt-in authenticated connectors
(P4) raise the ceiling to meeting and message content — but that's a different privacy
contract and should be sold as one.

### Bottom line

Build it — it is mostly built, measured, and passing. Where the other assessments in
this file land on "no" or "partially yes," the difference is weighting, not facts: they
weight the gap between the literal promise ("understands your whole day, for everyone")
and physics; I weight the fact that the architecture already degrades honestly
(preflight warnings, guard floor, silent-optional connectors), so a thin day produces a
*thin honest recap*, not a broken product. We agree completely on where the ceiling is.
Spend the remaining effort on:

1. **Calendar for normal humans** — EventKit on Mac, Graph/OAuth on Windows.
2. **Alien day-shapes in the benchmark fixtures** — the one place "reliably, not by
   luck" is currently unproven.
3. **The opt-in connector tier** for content behind the walls.

And do not promise meeting content, message content, or off-device awareness in the
"on its own" tier. That promise cannot be kept — and this feature's entire identity is
that it doesn't lie.
