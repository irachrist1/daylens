# Daylens — Full Codebase Audit (2026-07-07)

> This document replaces all prior documentation as the operating reality of the
> codebase. It is written from the code, not from the docs. Every claim cites the
> file (and line, where it pins a fact) it came from. Where something was searched
> for and not found, it says "not found." Facts re-verified by hand against the
> code or the live database are flagged **[verified]**.
>
> This is a judgment document, not a description. Every section ends with a
> verdict — a direct answer, not a summary. The six that matter most are answered
> up front, in plain language, below.
>
> One fact colours everything: the desktop app shipped from this repo is an
> **offline, local-only private build**. Cloud sync, browser-linking, and AI
> feedback upload are switched off in code (`src/main/ipc/sync.handlers.ts:18`,
> `src/main/services/syncUploader.ts:48-50`, `src/main/services/aiFeedbackUpload.ts:238`).
> A large amount of real, working infrastructure (the Convex backend, the whole
> `apps/web` product, device-linking, billing) is therefore code with no live
> producer. Read every "cloud" and "at scale" statement through that lens.

---

## Verdicts

**1. Can a user pay me money today? No.** Not "not yet" — no. In a shipped build a
user never even sees a checkout button. The onboarding subscribe UI is gated on
`managedAvailable` (`src/renderer/views/Onboarding.tsx:1204,1699`) and the Settings
"See price and subscribe" button is gated on `access.checkoutAvailable`
(`src/renderer/views/Settings.tsx:1407-1411`) — both are false whenever billing is
"unavailable," and billing is *always* unavailable in a shipped build because the
build pipeline never sets `DAYLENS_BILLING_API_URL`, so `apiUrl()` returns `''` and
the app hard-codes `mode: 'unavailable'` (`src/main/services/billing.ts:57-63`)
**[verified]**. Even if you forced the button to appear, clicking it throws "Managed
AI is not configured for this build" before any network call, and there is no
deployed billing server behind it anyway (no Dockerfile/compose/fly config exists in
the repo). The billing *code* is genuinely good — real Polar and Flutterwave
integrations, real webhook signature verification, real 402-when-exhausted
enforcement — but good code that nobody can reach is worth exactly zero revenue. To
take a single dollar you must deploy Postgres + LiteLLM + the billing service, finish
Polar/Flutterwave KYC, and rebuild the desktop app with the API URL wired in. Until
then the honest answer to "can I charge?" is no.

**2. What happens to a user after 6 months? The app stays fast but gets fat and
fragile, and one bad write bricks it.** Do the math: the live DB is 639 MB after ~110
days of one developer, but 359 MB of that is a one-time retry-storm scar in
`ai_usage_events` **[verified]**; real durable data accrues at roughly 2.5–3.5 MB/day,
dominated by the `focus_events` event stream. So a normal user is around **0.8–1.0 GB
at 6 months and 1.3–1.6 GB at 12 months** (that includes the permanent 359 MB scar,
because nothing ever cleans it up). Here is the part that matters and that I got wrong
to worry about first: **query latency does not degrade with size.** Every hot read is
date-scoped through an index — `idx_timeline_blocks_date`, `idx_derived_sessions_date_start`,
`idx_website_visits_time`, `idx_focus_events_ts` all exist **[verified]** — so "show me
today" touches one day's rows whether the DB is 600 MB or 6 GB. The app will not feel
slow. What actually hurts at 6–12 months is threefold: the pre-update backup copies
the *entire* file three times (`src/main/index.ts:379-413`), so a 1 GB DB means +3 GB
of disk churn on every version bump; there is no `VACUUM` ever, so deleted space is
never reclaimed; and — the real cliff — a corrupt DB is a fatal, unrecoverable crash
loop with no integrity check and no repair path (`src/main/services/database.ts:46-124`
rethrows into `app.quit()`). Is there any mechanism in the code that prevents any of
this — retention, pruning, VACUUM, corruption recovery? **No** (all searched, all not
found) **[verified]**. The user doesn't hit a slowness wall; they hit a fragility
wall, and when they hit it the app dies and takes their history with it.

**3. What does a new user see in the first 10 minutes? A permission dance, one genuine
"it's already watching" moment, then an eight-screen questionnaire — and no reason,
anywhere, to pay.** On macOS the first minutes are: name entry, a three-beat "why"
story, then an Accessibility permission request that *forces an app relaunch*
(`src/renderer/views/Onboarding.tsx:1288-1307`) — the single most confusing moment,
because the app quits and reopens mid-setup and a user who doesn't expect it reads it
as a crash. If they grant it, the "proof" screen polls live data every 2.5s and shows
their real activity within seconds — this is the one real aha, the moment the product
earns trust by showing it already works. Then come eight more screens (tour,
superpowers, about, voice, work, connections, privacy, ai_setup) of personalization
questionnaire before they reach the actual app. On Windows/Linux there's no permission
step at all — tracking silently starts before they've clicked past "welcome"
(`src/main/lib/onboardingState.ts:66`) **[verified]**, which is smoother but means they
never consciously consent. Where's the confusion? The mac relaunch, and the fact that
early block names can come out as raw app strings like "daylens" or "AGENT" (the
founder's own `docs/findings.md:271` records exactly this from a real test). Where's
the moment they see a reason to pay? **There isn't one.** In a shipped build the
subscribe UI is hidden (see verdict 1), so the AI features simply, quietly, need a key
the user doesn't have — no paywall, no pitch, no "here's what Plus unlocks." The
product shows its value (the timeline) and then never asks for the sale. I'm reading
this from code plus the founder's testing notes, not from watching a real first-run;
to fully close it I'd want a screen recording of one cold install on each OS.

**4. Is the tracking approach correct? The bones are right; the current build is not,
and the flaw is architectural, not a bug list.** The individual repairs — 888k retry
rows, the 9-hour overnight phantom, Dia overcounted by hours, 54 minutes of Cursor
missing — look like a bug parade, but read `docs/findings.md` (the founder's own title
for it is *"why Daylens gets the day wrong"*) and the same root cause recurs on nearly
every page: **two capture streams that don't reconcile, with session IDs living in two
namespaces** (`app_sessions` polling vs. `focus_events` events; app-time vs. site-time,
`docs/findings.md:474,366`). That is one architectural fault wearing ten different
shirts, not ten independent bugs. Now the honest other half: the *target* architecture
underneath is right — an append-only event log (`focus_events`), a deterministic
projection to sessions and blocks (`src/main/core/projections/chunk2.ts`), and a
correction ledger anchored on durable keys (time spans, not churning row IDs,
`src/main/db/schema.ts:349-355`). If you rebuilt it tomorrow, **yes, I'd use
essentially this architecture — but with one source of truth from day one.** The
mistake wasn't the design; it was shipping the new event pipeline *alongside* the old
polling pipeline and leaving both live, so every total has two possible origins and
the reconciliation bugs are structural and endless. The fix is not more patches; it is
finishing the migration — make `focus_events` the only truth, extend it to all
platforms, and delete `tracking.ts`/`app_sessions` as a parallel reality. Do that and
the numbers become trustworthy; leave both running and you will be repairing "the day
came out wrong" forever.

**5. Should this be Electron? Yes — keep Electron, and the SwiftUI app is a real but
abandoned alternative you should formally retire, not revive.** `daylens-swift` is not
an experiment: it's a feature-complete native macOS app with its own Xcode project,
a WidgetKit widget, 13 test files, and full view/service parity — but its last commit
is 2026-04-15, twelve weeks before this repo's daily work, and nothing marks it dead.
If someone rewrote the mac client in Swift today they'd *gain* a smaller bundle, a real
notarized signature (killing the updater hole), and native widgets; they'd *lose* the
entire cross-platform TypeScript engine — thousands of lines of projection,
attribution, and AI code plus every test — which they'd have to reimplement from
scratch, and then again in C# for Windows, maintaining N copies of the hard part
instead of one. The single biggest thing Electron costs this product that a native app
would not: **it forces the ad-hoc-signing updater that can execute unverified
downloaded code** (verdict/§9) — but that costs about $99/year to fix (an Apple
Developer ID and notarization), not a rewrite. So the SwiftUI directory answers its own
question: it proves native is *possible* and simultaneously proves it's a second
codebase that rots the moment attention moves. Stay on Electron, buy the Developer ID,
delete the Squirrel-bypass, and archive `daylens-swift` with a note so it stops
masquerading as a live second product.

**6. What is the single highest-leverage thing to do in the next 2 weeks? Fix the
broken build and get it back into CI-verified, signed shape — because right now you
cannot ship anything at all.** Not the updater, not billing, not the DB — those matter,
but they're improvements to a product that *can currently be built and shipped*, and
this one can't. A clean `npm ci` build fails on every platform because `recharts` was
deleted from `package.json` but is still referenced in `vite.renderer.config.ts:28`;
it only works on your machine because of a stale `node_modules` copy **[verified]**.
On top of that the version was reset 1.0.44 → 1.0.0 **[verified]** (which breaks
auto-update ordering), and `main` is 206 commits ahead of origin with nothing pushed in
11 days **[verified]** — so there is no backup and no CI proof that any of the last
two weeks of work packages on any OS. The one two-week move that flips this product from
"might work" to "could actually ship": **fix the recharts reference, restore a correct
version number, push, and get all three runtime-verify workflows green again.** Until
that's done, every other fix is being written into a tree that can't produce a release.
Everything else on the roadmap is real, but it's second.

---

## 1. What this codebase actually is

A **hand-rolled, script-glued monorepo** for a personal time-tracking product.
`README.md:5` self-labels it a monorepo, but structurally it is not a tooled one: root
`package.json` has **no `workspaces` field** and there are **two independent lockfiles**
with two separate `node_modules` trees **[verified]**. Cross-package wiring is manual:
`apps/web` runs via `npm --prefix` shims (`package.json:19-22`) and
`@daylens/remote-contract` resolves through a hand-made symlink.

| Path | What it is | Status |
|---|---|---|
| `src/` | The Electron app: `main/`, `preload/`, `renderer/` (React 19 SPA), `shared/`, `native/` (Swift + .NET capture helpers) | **Live core** |
| `apps/web/` | Next.js 16 + Convex web companion + marketing site; separate npm project | **Live but structurally disconnected** (§3) |
| `packages/remote-contract/` | Shared wire-contract types | Live; imported both sides |
| `packages/mcp-server/` | Local stdio MCP server; **no `package.json`** | Live, not a real package |
| `services/billing/` | Standalone Polar+Flutterwave billing service; `pg` not even installed locally | Live code, **never deployed** (§6) |
| `shared/` (root) | One JSON file, `app-normalization.v1.json` — unrelated to `src/shared/` (name collision) | Live runtime resource |
| `tests/` | 187 files | Live |
| `Casks/` | Homebrew cask pinned at **v1.0.29**; README says automation "Not wired up yet" | **Stale, never activated** |
| `probes/`, `assets/` | A manual Swift spike; a `.gitkeep`-only dir | Unwired / empty |
| `artifacts/` (23M) | Stale QA screenshots, **untracked AND un-gitignored** — a `git add -A` sweeps them in | Dead weight (§10) |

The three sibling-folder facts worth stating plainly: the four folders the brief named
(`daylens-web-ux-isolated`, `daylens-linux`, `daylens-spec`, `daylens-review-handoffs`)
**do not exist** anywhere on disk or in git history **[verified]**; `/Dev-Personal/Dayflow`
is a **third-party competitor's repo** (`JerryZLiu/Dayflow`) kept as reference, not
Daylens code; `/Dev-Personal/daylens-swift` is the dormant original (§2, §5).

**Verdict:** It's one live product (the Electron app) wearing the costume of three. The
monorepo is real but ungoverned — two lockfiles, one member with no `package.json`, one
whose dependency isn't installed, empty orphan dirs, and a 23 MB screenshot pile one
`git add` away from a commit. None of it is fatal, and none of it is where your risk
lives; it's untidy, not broken. Fix it opportunistically, not first.

---

## 2. Is Electron the right choice

Electron uniquely buys this app: a React 19 SPA sharing `@shared/*` types with the main
process; synchronous in-process `better-sqlite3`; a Node-subprocess MCP server;
`electron-updater`; `keytar`; tray, global shortcuts, single-instance lock, login-item
integration. What it costs: the signing pain that produces the dangerous updater (§9);
bundle size; and — tellingly — it did **not** buy cross-platform capture, which still
needs a **Swift** helper on macOS (`src/native/capture-helper/main.swift`, 634 lines) and
a **.NET** helper on Windows (`src/native/windows-capture-helper/Program.cs`, 289 lines).

`daylens-swift` is a **serious, feature-complete, dormant** native app (own Xcode project,
WidgetKit widget, 13 tests, full parity; last commit 2026-04-15). It proves native mac is
achievable and simultaneously proves the maintenance cost — it fell 12 weeks behind the
instant focus moved.

**Verdict:** Stay on Electron. The product's hard part is the platform-independent
TypeScript engine (projection, attribution, AI); going native means reimplementing it per
platform and maintaining N copies of the exact code that carries all your fixed bugs. The
one genuinely damning thing Electron costs you — the ad-hoc-signing updater that runs
unverified code — is a $99/year fix (Apple Developer ID + notarization), not a reason to
abandon the framework. Buy the Developer ID, delete the Squirrel-bypass, and **formally
archive `daylens-swift`** so a second product stops rotting in the dark. Native is the
right call only if the mac experience becomes the whole company's focus, and the code
shows the opposite intent.

---

## 3. Is the tech stack right everywhere else (and what happens at scale)

**SQLite (`better-sqlite3` 12.8, WAL, tuned pragmas):** correct for a local-first tracker.
Pragmas are already tuned for size (`src/main/services/database.ts:55-63`, comment
concedes "large (500MB+, growing)"). The problems are operational, and they are the
substance of verdict 2 above:

- **No retention/pruning/VACUUM anywhere** **[verified]** — the 359 MB retry-storm scar is
  permanent, and normal data only accretes.
- **A corrupt DB is a fatal, unrecoverable crash** (`database.ts:46-124` →
  `src/main/index.ts:906-909`): no `integrity_check`, no recreate, no restore.
- **`schema_version` cannot be fully trusted:** migration v42 dropped four tables and
  committed the version bump in the same transaction, yet all four still exist with 0 rows
  in the live DB — proof a stale file was restored over a newer one **[verified]**.

**Web app (Next.js 16 + Convex):** a full parallel product surface deployed on Vercel, with
a well-built Convex schema and auth model (§9). But the desktop app **never calls it** — no
`ConvexHttpClient`/`CONVEX_URL` anywhere in `src/main`; the `__DAYLENS_CONVEX_SITE_URL__`
build constant has zero consumers **[verified]**; sync is a documented no-op. So if the web
backend dies, the desktop app loses nothing — and the entire `apps/web` `(app)` group is,
today, an unreachable duplicate: real code, real backend, no producer feeding it.

**Verdict:** The choices are right; the discipline around them is missing. SQLite is
correct but is being run like it will never fill up, never corrupt, and never need
reclaiming — all three of which are wrong on a long enough timeline, and 6–12 months is
long enough. Convex + Next is a competent stack solving a problem the shipped product
doesn't currently have (sync is off), which makes it maintenance you're paying for and not
using. Add retention + corruption recovery to SQLite before you add anything to the cloud
stack, and decide whether the web app is a real surface or dead weight (§7 roadmap).

---

## 4. Is the tracking approach fundamentally correct

Two capture pipelines run **concurrently**: polled foreground presence every 5s into
`app_sessions` (`src/main/services/tracking.ts:86`, with 10s min / 2min idle / 5min away /
60s sleep-gap guards) and event-driven native focus capture into `focus_events`
(NSWorkspace events + 1s title poll + 1–3s AppleScript tab poll on mac; .NET UIA at 500ms
on Windows; **no native helper on Linux**). Browser history is copied every 60s into
`website_visits`. `focus_events` projects deterministically into `derived_sessions` →
`derived_blocks`; `app_sessions` materializes `timeline_blocks`. **Both are live at once.**

What it measures *incorrectly by design*: foreground focus ≠ work (an idle-but-focused
window counts as active); polled tab URLs undersample fast switching; Linux/Firefox have no
live URL at all. What it *fails to measure*: Linux native fidelity, anything off the primary
machine, and any real signal of output or depth. The founder's `docs/findings.md` is a
catalogue of the consequences — phantom overnight days, double-counted app-vs-site time,
session IDs colliding across two namespaces — and the through-line is always the same two
unreconciled streams, not ten separate defects.

**Verdict:** The architecture is *right in design and wrong in execution*, and the wrongness
is structural, not a bug backlog. The correct spine already exists — an event log, a
deterministic projection, a correction ledger keyed on durable time spans. If I rebuilt this
tomorrow I would keep that spine and change exactly one thing: **one source of truth from the
first commit.** The whole class of "the day came out wrong" bugs traces to running the new
event pipeline beside the old polling pipeline and never retiring either, so every total has
two possible origins and reconciliation is a permanent tax. This is fixable — but the fix is
to *finish* the architecture (promote `focus_events` to the only truth, extend it to Windows
and Linux, delete `tracking.ts`/`app_sessions`), not to keep patching symptoms. Do that and
the numbers become trustworthy. Don't, and you will repair the timeline forever.

---

## 5. User journey — the first 10 minutes

"Fresh install" = a missing `electron-store` key (`src/main/services/settings.ts:27,92`);
`App.tsx:337` gates the whole app on it. The 15-stage flow
(`src/renderer/views/Onboarding.tsx:1206-1775`): welcome (name) → why → [mac: permission →
relaunch → verifying] → **proof** (live data in ~2.5s) → tour → superpowers → about → voice
→ work → connections → privacy → ai_setup → ready. No account, no sign-in.

Tracking starts mid-onboarding on mac (after the permission relaunch) and *before the
welcome screen* on Windows/Linux **[verified]** — smoother but with no consent moment.
Subscription appears only in `ai_setup`, and only when `managedAvailable` is true — which it
never is in a shipped build (§6, verdict 1), so the real shipped experience shows a BYOK-only
"turn on AI" screen with no price and no pitch. Re-engagement is local-only OS notifications
plus a day-7 feedback modal; no email, no push. Uninstall cleans up nothing on any platform
and leaves `launchOnLogin: true` registered **[verified]** — the stale-login-item trap from
project memory.

**Verdict:** The journey nails the one thing most trackers miss — the "proof" step that shows
real captured data within seconds is a genuine trust moment — and then squanders it two ways.
First, the mac permission-relaunch reads as a crash to anyone who doesn't expect their app to
quit and reopen mid-setup, and it sits *before* the payoff. Second, there is no point,
anywhere in the first ten minutes or after, where the user is shown a reason to pay — the
paywall is code-gated out of shipped builds, so the product demonstrates its value and then
never asks for the sale. Cut the personalization questionnaire down, move the aha earlier,
soften the relaunch, and — once billing is real — put an actual "here's what Plus gives you"
moment somewhere a paying user would see it. Right now the funnel has no bottom.

---

## 6. Billing and subscription

Two real provider integrations exist in `services/billing/src/server.mjs` — **Polar** and
**Flutterwave** — with real checkout, webhook signature verification (Standard-Webhooks HMAC
/ `verif-hash`), a $5 one-time free credit metered on real LiteLLM cost, and genuine
enforcement (HTTP 402 server-side, a thrown "AI access is paused" desktop-side before the
call). The subscription gates exactly one thing: whether managed AI calls succeed. Capture,
timeline, and apps are never gated.

Why none of it can take money today: the billing service has **no deploy artifact** anywhere
in the repo, and the build pipeline **never sets `DAYLENS_BILLING_API_URL`** **[verified]**,
so `apiUrl()` is `''`, `mode` is hard-coded `'unavailable'`, and every subscribe affordance
is conditionally hidden (`Onboarding.tsx:1699`, `Settings.tsx:1407-1411`). The one real copy
bug: onboarding says "$5 / month" but the backend grants $5 *once* and never replenishes.

**Verdict: No, a user cannot pay you today, and it is not close.** This is the answer to the
question that matters most, so I'll be blunt: you have a well-engineered payment system that
is unreachable, unhosted, and hidden — three independent blockers, any one of which alone
would stop a sale. The code quality is real and worth keeping; the revenue is zero and will
stay zero until you deploy the service (Postgres + LiteLLM + `server.mjs`), finish
Polar/Flutterwave KYC, and rebuild with the API URL wired. Either commit to doing that, or
remove the subscribe UI entirely and present honestly as BYOK-only — but stop shipping a
buy button that can never complete.

---

## 7. Analytics and metrics

Well-designed, opt-in, privacy-clean (event properties are allowlist-sanitized — no titles,
URLs, or paths ever leave the device; Sentry additionally regex-redacts). Coverage is
genuinely thorough when enabled: 94 desktop call sites across lifecycle, a 13-step onboarding
funnel, per-view opens, the full AI loop, updater lifecycle, and retention milestones.

The killers: `POSTHOG_KEY`/`SENTRY_DSN` are referenced in **zero** workflows or build configs
**[verified]**, so every official release ships with analytics and crash reporting
hard-disabled. And even enabled, React render errors are reported nowhere (`ErrorBoundary`
has no `componentDidCatch`; no renderer→Sentry IPC path, `src/preload/index.ts:382-385`). The
allowlist also silently drops useful properties (`provider_calls`, `redaction_count`), 10
event constants are declared but never fired, and the one shipped feature (Wrap) has zero
telemetry.

**Verdict:** You built a good instrument and never plugged it in. In the app you ship today,
when it crashes for a real user, **you do not find out** — not from analytics (keys absent),
not from Sentry (keys absent, and React errors unwired even if present). That is how a stale
build burned ~$110/week on AI retries for days before a manual audit caught it. This is not a
"nice to have later" — it's the difference between learning about failures from data and
learning about them from luck. Add the two secrets to the release workflows and wire
`componentDidCatch` before you ship to anyone you can't call on the phone.

---

## 8. Cross-platform reality

| | Builds | Tracks | Biggest risk |
|---|---|---|---|
| **macOS** | v1.0.44 shipped; current `main` buildability **unverified** (recharts) | Full — Swift helper, Accessibility-gated, "never guess" invariant probe-tested | Not notarized → Gatekeeper warning on every fresh download |
| **Windows** | Shipped & CI-launch-tested **through 2026-06-22**; failing since on recharts | Real .NET/UIA helper (not a stub); Firefox marked "unknown" not guessed | The recharts break blocks any clean build **now**; unsigned → SmartScreen |
| **Linux** | AppImage/deb/rpm tested through 2026-06-22; failing since on recharts | Real but self-limiting: **no native helper**, needs XWayland, no live tab URL | Native-Wayland capture materially degraded; pacman gets no auto-update |

CI is honest (it actually installs and launches the packaged app on real runners, which is
why the recharts break is *visible*). But both runtime-verify workflows have been red since
2026-06-22, and `main` is 206 commits ahead of origin **[verified]**.

**Verdict:** All three platforms have real, working capture code — this is not a "Windows is a
stub" situation. But "the code works" and "we can ship it" are different claims, and the
second is currently false everywhere: there is no CI evidence that today's `main` packages on
any OS, because the same recharts break fails every platform's build and nobody has pushed in
11 days. macOS is the closest to shippable and still carries the notarization warning; Linux
is the weakest (no native helper, degraded on Wayland) and should be labeled "beta" honestly
rather than presented as equal.

---

## 9. Security and privacy

Design is, with one severe exception, genuinely security-conscious: keytar-backed secrets
with no plaintext fallback, sound Convex JWT auth with consistent per-workspace scoping (one
user cannot read another's data), locked-down navigation, and a near-zero data-exfiltration
posture as shipped (sync off, analytics off, AI calls only to the user's own provider).

The exception is critical and detailed here because it drives verdict 5 and the roadmap: the
**macOS auto-updater executes unverified downloaded code.** With no Apple Developer ID, the
updater bypasses Squirrel — downloads a ZIP, checks only a byte count, then
`codesign --force --deep --sign -` / `xattr -cr` / `open -n` on whatever arrived
(`src/main/services/updater.ts:647-649` **[verified]**), automatically ~10s after launch. No
checksum, no signature check, no host allowlist. Whoever controls the feed host or the GitHub
releases gets code execution on every user's machine. Lower-severity items: `sandbox: false`
on the main window (undocumented), an unvalidated `shell:open-path` IPC
(`src/main/index.ts:711-713` **[verified]**), a Convex device-revocation gap on two routes,
and visited-domains leaking to DuckDuckGo for favicons. No automatic data deletion on
uninstall, and no server-side account deletion path.

**Verdict:** Everything except the updater is the work of someone who takes security
seriously — and the updater alone is bad enough to override that impression for anyone
downloading a build. It is a remote-code-execution channel open on every user by default. Fix
it *first among security items* and it's cheap: the $99 Apple Developer ID + notarization
lets you delete the entire Squirrel-bypass, and you should add a checksum/signature check
regardless of platform. Do not ship another auto-updating macOS build until this is closed.

---

## 10. What should not exist

**Delete outright (zero risk):** `artifacts/` (23 MB, and add it to `.gitignore`);
`scripts/__verify-fixes.mjs`, `scripts/__verify-today.mjs`; the 4 dead exports
(`wrappedNarrativeCacheKey`, `proposeUnstoredMemoryFact`, `LATEST_CHANGELOG_ISSUE`, the shadow
`ClientMemoryGroup`); the empty orphan dirs `apps/web/shared/` and
`apps/web/packages/remote-contract/`; and the 3 unused `apps/web` deps
(`class-variance-authority`, `lenis`, `next-pwa`).

**Delete after confirming not run manually (tracked):** the ~6 one-off verification scripts
in `scripts/` (`calendar-verify`, `cdp-eval`, `dev105-screenshots`, `spike-toolcalls-cli`,
`timeline-v8-verify`, `overnight-verify.sh`, `windows-shipping-workflow`).

**Fix, don't delete:** drop 25 unnecessary `export`s; backfill `CHANGELOG.md`; **restore the
version number** (the priority item here); move the dated `docs/issues-*.md` into
`docs/sessions/`; finish or clearly deactivate `Casks/`.

**Verdict:** The junk is real but harmless — none of it is where your risk lives, and cleaning
it is a rainy-afternoon task, not a priority. The two items in this list that actually matter
are not junk at all: the **version regression** (breaks auto-update) and the **un-gitignored
`artifacts/`** (one `git add -A` from polluting a commit). Handle those two now; batch the
rest whenever.

---

## 11. What is missing before this ships

User-facing, broken or incomplete: clean builds don't build; the version is regressed; billing
can't take a payment; browser-linking is half-shipped (web live, desktop throws); the "$5/month"
copy contradicts a one-time grant.

Infrastructure that must exist: DB retention + VACUUM + a one-time cleanup of the 359 MB scar;
DB corruption recovery; analytics + crash keys in CI and a renderer-error→Sentry path; a
signed, verified update path; server-side data deletion before sync is ever enabled.

Docs a new developer needs (mostly missing): an accurate architecture doc (the two capture
pipelines and the plan to collapse them), a "what's disabled and why" doc (sync, billing,
analytics — currently only in code comments), and a build/release runbook listing the env vars
that must be set. This audit is the starting point.

**Verdict:** The gap between "this exists" and "this is a product real users can rely on" is
not features — it's the unglamorous middle layer: a build that builds, a DB that survives a
year, an update that can't be hijacked, and a way to know when it breaks. None of those are
research problems; all of them are known, bounded work. The product is closer than the
five-alarm findings suggest, but it is not shippable to a stranger today, and the blocking
items are infrastructure, not polish.

---

## 12. Roadmap — ordered by leverage

The full ordered list stands, but the honest headline is verdict 6, restated as the roadmap's
own conclusion:

1. **Fix the build** — remove the `recharts` reference, restore version 1.0.45+, push, get all
   three runtime-verify workflows green. *Nothing else ships until this passes.* (Hours.)
2. **Close the updater RCE** — Apple Developer ID + notarization, delete the Squirrel-bypass,
   add signature verification. (~1 week.)
3. **Turn on production observability** — `POSTHOG_KEY`/`SENTRY_DSN` in release workflows +
   `ErrorBoundary.componentDidCatch`→Sentry. (1–2 days.)
4. **DB retention + corruption recovery** — cap/prune `ai_usage_events`, periodic VACUUM,
   integrity-check-and-recover on open. (3–5 days.)
5. **Push `main`** — 206 unpushed commits is a one-laptop single point of failure. (Hours,
   after #1.)
6. **Decide billing** — deploy it and wire the URL, or remove the buy button. (Days to weeks.)
7. **Collapse the two capture pipelines** — `focus_events` as the only truth; retire
   `app_sessions`. (Multi-week; the durable fix for "the day is wrong.")
8. **Consent + uninstall gaps** — Windows/Linux tracking-consent step; clean up data and the
   login item on uninstall. (2–3 days.)
9. **Resolve the two-product / two-UI ambiguity** — archive `daylens-swift`; connect or demote
   the web surface. (Days of decisions.)

**Verdict:** If you do exactly one thing in the next two weeks, do #1 — a shippable build is
the precondition for every other item on this list having any value. If you do three, do #1,
#2, and #3: a build that ships, an update that can't be weaponized, and eyes on production.
Everything below that is real and important, but it is improving a product that can be
shipped — and right now this one can't.

---

*Items flagged **[verified]** were confirmed directly against the code or the live database
during synthesis; all other claims carry the sub-agent's file:line citation and were reviewed
for internal consistency. Where a verdict rests on experience I could not observe directly
(the first-run feel in §5), it says so and names what would close the gap.*
