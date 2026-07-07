# Implementation record — 2026-07-06/07 fix work

> Reconstructed 2026-07-07 from the actual diffs (`git show`), not just the commit
> messages. Baseline for Sessions C/D/F: everything in "Cross-referenced against the
> audit" below is **already done** — do not redo it. Everything under "Still open"
> is confirmed still broken as of this writing.
>
> Note: the session prompt described the range as `6df04fa..HEAD` including
> `fad6cc0`; in reality `fad6cc0` is the *parent* of the audit-doc commit `6df04fa`.
> It is included here anyway because it is fix work from the same audit cycle.

## The commits

### `fad6cc0` — fix(tracking): sleep never counts, incognito never tracked, categories from sites, nesting indent (Jul 6, 18:15)

Four root causes from the founder's 2026-07-06 audit (`docs/findings.md`):

- **Sleep-gap flush** — `src/main/services/tracking.ts`: new `GAP_FLUSH_MS = 60_000`;
  `poll()` flushes on a >60s wall-clock gap between ticks at last evidence of
  activity and backdates an `away_start`; `cutSessionAfterWake()` ends a still-open
  session on `resume`/`unlock_screen`; `handleLockScreen`/`handleSuspend` trim
  already-idle time by flushing at `provisionalIdleStart`; snapshot recovery
  midnight-splits cross-day sessions into per-day slices.
- **Site-weighted block categories** — new `src/shared/domainCategories.ts` (126
  lines); `src/main/services/workBlocks.ts` computes block category distribution from
  site domains (Σ distribution = Σ session seconds); timeline-v10 bump recolors
  processed days without touching user corrections; Dia recataloged to browsing in
  `shared/app-normalization.v1.json`.
- **Incognito never tracked (poll pipeline)** — `src/main/services/browserContext.ts`:
  Chromium AppleScript `mode of front window` read plus `detectIncognitoFromTitle`
  fallback; `sample()` returns a structured `{ isPrivate }` before any session is
  created; a private sample records nothing and flushes the open session, regardless
  of the Tracking Controls master switch.
- **Nested site-row indent + residual child** — `src/renderer/lib/blockDetailRowTree.ts`
  and `src/renderer/views/Timeline.tsx`: single padding shorthand (the longhand was
  being reset by object-spread dedup); browser rows get an explicit "No page
  recorded" residual child so children sum to the parent.
- Tests: `trackingSleepGap`, `incognitoNeverTracked`, `domainCategories`,
  `weightedCategoryDistribution`, `blockDetailRowTree` (+ updates to 3 more).

### `79512ae` — fix(tracking): nesting canonical backfill, incognito focus-event gate, reconcile pools, stale-rowid insert (Jul 6, 23:33)

- **Site→browser nesting backfill** — `src/main/services/workBlocks.ts`
  (`normalizeAppSummaryForBlockDisplay` backfills `canonicalAppId`) and
  `src/main/db/queries.ts` (`getWebsiteSummariesForRange` backfills
  `canonicalBrowserId`) at read, so blocks persisted before those fields existed
  still nest sites under their browser. Verified over all 73 persisted blocks since
  Jun 25: orphaned site rows 53 → 1.
- **Incognito gate in the event pipeline** — `src/main/services/focusCapture.ts`:
  `shouldCaptureFocusEvent` now runs `detectIncognitoFromTitle` unconditionally
  (previously a passthrough with Tracking Controls off, so private URLs landed in
  `focus_events`). Regression test in `tests/focusCaptureGate.test.ts`.
- **Reconcile claim pools** — `src/main/db/queries.ts` `reconcileWebsiteVisits`:
  pools key on canonical browser id first and clip against the overlap-merged union
  of every identity form's foreground time, so a browser's two bundle-id forms
  (exe path vs bundle id) can't credit the same second twice.
- **Stale rowid** — `insertAppSession` returns `null` on an `INSERT OR IGNORE`
  dedup conflict instead of a stale `lastInsertRowid`.
- **Dev self-capture** — bare `electron` exe basename added to
  `SELF_NOISE_EXE_NAMES` in `src/main/services/tracking.ts` (macOS dev runner).

### `93f5ffb` — docs: night-window repair record (Jul 7, 00:12)

Docs only (+51 lines to `docs/findings.md`): the 2026-07-07 night-window repair —
Dia blob replaced from `focus_events`, Cursor's 54m recovered, a 10h YouTube visit
clamped. Data repair record, no code.

### `8c6f438` — fix(audit): pre-shipping sweep — updater verification, history poll perf, reconciliation, sweep fixes (Jul 7, 01:54)

- **Updater verification (security)** — `src/main/services/updater.ts` +
  `src/shared/updaterReleaseFeed.ts`: the macOS ad-hoc updater now verifies the
  SHA-256 of the downloaded ZIP against the GitHub release digest before staging,
  fail-closed (no digest or non-HTTPS URL → `canAutoInstall: false`, manual download
  only); `CFBundleIdentifier` checked against the running app before the swap; temp
  dirs cleaned on every failure path. Windows: auto-update disabled unless the
  running exe passes `Get-AuthenticodeSignature`. Feed side:
  `apps/web/app/api/update-feed/route.ts` + `_releaseAsset.ts` publish the digest;
  `src/renderer/components/UpdateBanner.tsx` + `Settings.tsx` show the
  manual-download-only state.
- **History poll perf** — `src/main/services/browser.ts` /
  `browserContext.ts`: 60s history reads moved from sync `copyFileSync` to async
  `fsp.copyFile` with `COPYFILE_FICLONE` (O(1) APFS clone); reentrancy guard on
  `pollAll`; 5s active-tab fallback clone-first with a 64 MB size guard.
- **Reconciliation everywhere** — `src/main/db/queries.ts`
  (`getDistractionByMonth/Hour/Domain`), `src/main/services/aiTools.ts`
  (`aggregateSiteUsage`), `src/main/services/workMemoryProfile.ts`: site time now
  computed via `getReconciledDomainIntervals` instead of raw `SUM(duration_sec)`.
- **Sweep** — `src/main/services/attribution.ts` `loadIdlePeriods` matches the
  event types actually written (`lock_screen`, `suspend`, `away_start`,
  `unlock_screen`, `away_end`); `src/main/core/projections/chunk2.ts`
  `IDLE_GAP_MS` 5min → 15min (matches founder decision and the main engine).
- Also: `CHANGELOG.md` backfill (63 lines), `docs/shipping-readiness-2026-07-07.md`.

### Uncommitted work in the tree (as of this writing)

Windows-shipping work in progress, not yet committed: `release-windows.yml`,
`electron-builder.config.js`, `docs/WINDOWS_SIGNING.md`, `src/main/services/
{tracking,windowsFocusCapture}.ts`, `src/native/windows-capture-helper/Program.cs`,
`vite.main.config.ts`, `.gitignore`, plus new `tests/windowsTrackingParity.test.ts`.
Treat as unfinished — not part of the done baseline.

## Cross-referenced against the audit (`full-audit-2026-07-07.md`)

What each fix closes, and what it explicitly does **not**:

| Audit finding | Status | Closed by |
|---|---|---|
| §9 / verdict 5: updater executes unverified downloaded code — "add a checksum/signature check regardless of platform" | **Substantially closed** (checksum + bundle-id + HTTPS, fail-closed; Windows gated on Authenticode) | `8c6f438` |
| §9: full updater fix — Apple Developer ID + notarization, delete the Squirrel-bypass (roadmap #2) | **Open** — the ad-hoc path still exists, now verified rather than blind | — |
| §4 / verdict 4: reconciliation bugs from the two unreconciled pipelines (double-crediting across identity forms, site time ≠ foreground time in Distraction/AI/work-memory readers) | **Closed at the symptom level** | `79512ae`, `8c6f438` |
| §4 / roadmap #7: collapse the two capture pipelines — `focus_events` as the only truth, retire `app_sessions`/`tracking.ts` | **Open** — both pipelines still live; all of the above are repairs *within* the dual-pipeline world | — |
| §4: overnight phantom sessions ("Active now · 16h 34m"), sleep counted as work | **Closed** (gap flush + wake cut + idle trim + midnight split) | `fad6cc0` |
| §4 examples: Dia overcounted, Cursor's missing 54m, 10h visit | **Closed as data repair** (records in `docs/findings.md`; engine causes fixed by the two tracking commits) | `93f5ffb`, `fad6cc0`, `79512ae` |
| Privacy: incognito windows tracked (both pipelines) | **Closed** (poll pipeline + `focus_events` gate) | `fad6cc0`, `79512ae` |
| §5: block names/colors wrong (categories collapsed to the browser's catalog category) | **Closed** | `fad6cc0` |
| Verdict 6 / roadmap #1: **the build is broken** — `recharts` still referenced in `vite.renderer.config.ts:28`, deleted from `package.json` | **Open** [re-verified today] | — |
| Verdict 6: version regressed 1.0.44 → 1.0.0 | **Open** — `package.json` still says 1.0.0 [re-verified today] | — |
| Verdict 6 / roadmap #5: `main` unpushed (now 207 commits ahead of origin) | **Open** [re-verified today] | — |
| Verdict 1 / §6 / roadmap #6: billing unreachable (no deploy, `DAYLENS_BILLING_API_URL` never set, subscribe UI hidden); "$5/month" copy vs one-time grant | **Open** | — |
| §7 / roadmap #3: `POSTHOG_KEY`/`SENTRY_DSN` in zero release workflows; no `componentDidCatch` → Sentry | **Open** | — |
| §2–3 / roadmap #4: DB retention/VACUUM, 359 MB scar cleanup, corruption recovery | **Open** | — |
| Roadmap #8: Windows/Linux consent step; uninstall cleanup (data + login item) | **Open** | — |
| Roadmap #9: archive `daylens-swift`; decide the web surface | **Open** | — |
| §10: `artifacts/` un-gitignored, one `git add -A` from a commit | **In progress** — a `.gitignore` change exists uncommitted in the working tree | — |

**Reading for Sessions C/D/F:** the tracking-engine symptom repairs and the updater
verification are done — build on them, don't re-fix them. The audit's structural
items (pipeline collapse, build repair, version, push, billing, observability, DB
lifecycle) are all still open, and roadmap #1 (fix the build) remains the gate on
everything else.

---

Session A also produced `docs/user-journey.html` — a self-contained interactive map
of every screen, gate, data write, and dead end from first launch onward, with each
node's color justified by a cited `file:line` (128 anchors machine-verified against
the working tree, zero external references). Notable facts it pinned beyond the
audit: the three report notifications all default off and silently never fire
without an AI provider, there is no "seen Wrapped before" flag or Wrapped telemetry
anywhere, and period Wrapped is reachable only through the command palette. It is
headless-verified only — the founder still needs to open it in a browser and click
through the nodes before it counts as done.

---

Session B (PostHog feature events) confirmed the audit's "nothing fires" verdict and
found two independent kill switches — no build ever received the key (`.env` was never
loaded by `vite.main.config.ts`, and no release workflow sets the secrets) and
`analyticsOptIn` defaults off with no onboarding prompt — then fixed key injection via
`loadEnv` plus env blocks in the macOS/Linux/Store/preview release workflows (the
dirty `release-windows.yml` still needs the same 6-line block when Session D commits).
Nine of the ten taxonomy events are implemented with single fire-once call sites
(`app_launched`, `view_opened`, `analyze_day_clicked`, `ai_chat_sent`, `block_edited`,
`tracking_paused`/`tracking_resumed` — tray toggle now instrumented too,
`onboarding_step_completed` — centralized in `persistOnboarding` replacing 11 scattered
calls, `paywall_seen` — Settings→Billing is the only real paywall surface, and
`subscription_started` — fired on the billing-mode transition, price unavailable from
the API); `crash_recovery_shown` was not implemented because no corruption screen or
integrity check exists in the app to hook. Headless verification passed —
`tests/featureEventTaxonomy.test.ts` guards the sanitizer allowlist, all ten payloads
were sent through the real `posthog-node` config and PostHog returned `200 {"status":"Ok"}`
— but the live in-app check (launch → three views → Analyze Day → chat, events landing
within 60s) is pending the founder, and requires Settings → Privacy → analytics opt-in ON.

A post-session verification pass caught two gaps in the above and fixed them: the
"Settings is the only paywall surface" claim was false — onboarding's AI-setup screen
shows plan cards with a Subscribe to Plus checkout, so `paywall_seen` now fires there
with `trigger: 'onboarding'` — and `subscription_started` hardcoded `trigger: 'settings'`,
so checkouts now thread a validated `PaywallTrigger` from the launching surface through
IPC into `billing.ts`, which attributes the purchase to the last checkout opened
(falling back to `'settings'`). Note the opt-in caveat above is stale: the later
telemetry-always-on commit removed the opt-in entirely, so the founder check needs no toggle.

---

Session C (monorepo cleanup) turned the two-lockfile, hand-symlinked repo into a real
npm-workspaces monorepo — `workspaces: ["apps/web", "packages/*", "services/billing"]`,
a `package.json` for `packages/mcp-server`, the `apps/web` lockfile deleted, and one root
`npm install` now resolving all 1497 packages (billing's `pg` included) — verified by a
green `build:all`, `web:build`, `typecheck`, and both contract checks. Along the way it
fixed two build-breakers: the dead `recharts` reference in `vite.renderer.config.ts:28`
(audit roadmap #1), and the `postinstall` crash on Node ≥ 26 (yargs 17's extensionless CJS
shim parsed as ESM by `require(esm)`) — replaced with `scripts/rebuild-natives.mjs` calling
the `@electron/rebuild` JS API; it also added `STRUCTURE.md`, and with founder approval
deleted the untracked 23 MB `artifacts/` pile (now gitignored), removed the two empty
orphan dirs (`apps/web/shared/`, `apps/web/packages/remote-contract/`), and bumped
`Casks/daylens.rb` 1.0.29 → 1.0.44 (sha256 from the GitHub release digest) since the
founder wants brew as the agent-friendly install path. Flagged instead of done: Codex was
unavailable (usage limit until Jul 8) so the import graph was built by direct grep; the
audit's SwiftUI archival does not apply to this repo (no such directory — separate-repo
task); `apps/web/packages/{ai-models,prompt-builder,snapshot-schema}` are web-only by
import graph and deliberately stayed inside the `apps/web` workspace; the CI workflows
still call the deprecated `electron-rebuild` CLI (fine on their Node 20/22, breaks on
Node ≥ 26); and Session D's uncommitted `.env` gitignore line was left uncommitted on
purpose (the committed `.gitignore` contains only the `artifacts/` addition).

---

Session D (shipping checklist + Linear) wrote `docs/shipping-checklist.md` and ran a
real `npm run dist:mac`, confirming the build is clean but still stamped `1.0.0` —
the version regression is not yet fixed, only documented as the required first step.
It also found that the Windows shipping plan itself was stale: `release-windows.yml`
and `docs/WINDOWS_SIGNING.md` already hard-require a real Authenticode certificate
and refuse to ship an unsigned auto-updating build, so the audit's "ship unsigned,
bypass SmartScreen" framing no longer matches what the code enforces. All 41 audit
findings from `full-audit-2026-07-07.md` and `issues-2026-07-06.md` were imported
into Linear as DEV-120 through DEV-160 (11 already-fixed findings closed as Done
with citations, 30 left open across new Tracking Engine / UI · Product /
Infrastructure projects — Linear has no team-creation API, so projects substitute
for the teams the session asked for). The Mac DMG install, Windows installer, and
the update-flow test all still need the founder at a keyboard before shipping.

---

Session E (Intercom/Fin) installed the Messenger in the Electron renderer — a
programmatic loader in `src/renderer/lib/intercom.ts` boots with
`api_base: api-iam.intercom.io` and the public app id `y4l8ype0` (build-time
`__INTERCOM_APP_ID__` define in `vite.renderer.config.ts`), identified on launch from
main-process truth over a new `intercom:get-identity` IPC
(`src/main/ipc/intercom.handlers.ts`: `user_id` = the PostHog `analyticsId` so both
tools see one person, `platform`, `version`, `subscription_status` from the billing
snapshot, `days_since_install` from `firstLaunchDate`, `total_tracked_days` via
`getDaysTracked`), plus a new Settings → System → **Help & support** section whose
"Chat with us" button calls `Intercom('show')`, with the floating launcher hidden
during onboarding and revealed when `finishOnboarding` fires the Intercom
`onboarding_completed` custom event. Identity Verification is stubbed exactly at the
security boundary: `services/billing/src/server.mjs` gained an authenticated
`POST /v1/intercom/user-hash` (HMAC-SHA256 computed server-side; 503 until
`INTERCOM_IDENTITY_VERIFICATION_SECRET` is set), the desktop fetches it through
`getIntercomUserHash` in `src/main/services/billing.ts` (resolves null in every current
build since `DAYLENS_BILLING_API_URL` is never set), the secret slots exist only in
`services/billing/.env` (created locally, gitignored by the root `.env` entry) and
`.env.example`, and no `email` attribute is sent because the app stores no account email
anywhere (verified — the identify contract keeps a null `email` field for the day one
exists). Still open: the founder pastes the IV secret + REST access token into
`services/billing/.env`, does the live Messenger check (launch → Settings → Help &
support → chat reaches Fin with the right user properties), and authors the dashboard
pieces below; two stale premises were flagged — the session prompt's "existing Help
area at `Settings.tsx:659`" did not exist (the section was created), and the
landing-page Fin surface remains out of scope pending the founder confirming which
directory the live landing page is.

**Intercom dashboard work the founder still needs to author (code fires the signals):**

None of the following is code-configurable — Fin's answering, the Messenger's name,
and the workspace name all live in the Intercom dashboard. The app only opens the
Messenger and identifies the user. Specifically:

- **Make Fin answer instead of routing to the team.** Symptom seen 2026-07-07: Fin
  fronts the Messenger but every message goes straight to "SPCS Technology will reply /
  Waiting for a teammate." On a Fin-Pro workspace this is almost always **no content
  sources connected** — Fin has nothing to answer from, so it hands off. Fix in
  Intercom → AI / Fin: connect content (publish Help Center articles or add Snippets),
  set Fin **live for the Messenger channel + Users/Visitors audience**, and check the
  "when Fin can't help" workflow isn't set to route-to-team-first. Test with a real
  question ("How do I export my data?"), not "Hey."
- **Rename the Messenger from "Fin" / "SPCS Technology" to Daylens.** Both are dashboard
  branding, not code: "SPCS Technology" is the **workspace name** (Intercom → Settings →
  General/Workspace → Name) shown on new conversations; "Fin" is the **AI agent's
  display name** (Intercom → AI / Fin → Fin's name/persona). Set the workspace name to
  "Daylens" and rename the agent (e.g. "Daylens AI" or "Daylens Support") plus its
  avatar; the Messenger header then reads Daylens instead of Fin/SPCS Technology.
- **Post-onboarding tour** — 3-step tooltip tour pointing at **Timeline, Apps, AI
  Chat**, triggered on the Intercom custom event `onboarding_completed` (fired once
  when onboarding finishes).
- **Day-3 proactive message** — target user attribute `days_since_install >= 3`
  (refreshed on every launch). Draft copy, refine in dashboard: *"Hey — you've had
  Daylens for a few days now. What were you hoping it would help you figure out? And is
  the timeline matching how your days actually feel? I read every reply — if something
  looks off, tell me here and it usually turns into a fix. — Christian"*
- **Identity Verification** — do not enforce IV in the dashboard until the IV secret is
  in `services/billing/.env` AND the billing service is deployed with
  `DAYLENS_BILLING_API_URL` wired into the build, or every Messenger boot gets rejected.
- Segmentation attributes available now: `platform`, `version`, `subscription_status`,
  `days_since_install`, `total_tracked_days`.
