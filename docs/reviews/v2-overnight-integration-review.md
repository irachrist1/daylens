# V2 overnight integration review — the brutal day

**Date:** 2026-07-21 (overnight, final gate before merge)
**Integration branch:** `claude/v2-integration-check` (pushed; proof artifact, not a PR)
**Yardstick:** issue #21, `docs/specs/` (capture-and-evidence, timeline, memory-and-entities, ai-agent, agent-runtime-and-context, wrapped, briefs, connectors, screen-context, billing-and-entitlements), and the `docs/product/v2.md` release gate.

## 1. What was integrated

Merged into `claude/v2-integration-check`, in order, off `origin/main` (main tops at migration v59):

1. `origin/main` (base)
2. `claude/ci-blacksmith` — PR #32 (workflows only, clean merge)
3. `claude/dev-192-193-linear-granola` — Track A tip: #33 ← #35 ← #37 ← #39 (clean merge)
4. `claude/dev-200-201-pause-model-picker` — Track B tip: #34 ← #36 ← #38 ← #42 ← #43 (**3 conflicts, see below**)
5. `claude/issue-4-label-voice-rubric` — PR #40 (clean merge)
6. `claude/dev-194-195-entitlement-pass` — PR #41 (clean merge; `src/main/services/modelPricing.ts` is byte-identical on #41 and #43, so the "identical helpers" dedupe resolved itself — one copy, no divergence)

**Result: `tsc --noEmit` clean; full hermetic suite green — 302 files, 2055 pass, 0 fail, 10 skip (the 10 skips are real-DB-gated tests that always skip hermetically).**

## 2. Conflicts found and how they were resolved

### 2.1 `src/main/db/migrations.ts` — REAL cross-stack collision: two migrations both claimed v60

- Track A's GitHub connector (#35) shipped the `memory_records` CHECK-widening (admitting `connected_activity`) as **v60**, and meeting-attendance marks (#37) as **v61**.
- Track B's screen-context experiment (#34) ALSO shipped its frame-ledger/evidence migration as **v60**, with a comment reserving v62 "for the connector stack's next PR (Linear + Granola)" — but #39 (Linear+Granola) shipped **without** a migration, so v62 was reserved and unused.

Six migrations, slots 60–65. Minimal-churn resolution (keeps every PR-documented number except one):

| version | migration | origin |
|---|---|---|
| v60 | GitHub connector `memory_records` rebuild | Track A #35 (unchanged) |
| v61 | `meeting_attendance_marks` | Track A #37 (unchanged) |
| **v62** | **screen-context frames/evidence (renumbered from v60)** | Track B #34 |
| v63 | `day_analysis_versions` | Track B #38 (unchanged) |
| v64 | `screen_eval_pairs` | Track B #42 (unchanged) |
| v65 | `agent_turn_checkpoints` | Track B #43 (unchanged) |

Why renumber the screen-context migration and not GitHub's: within Track A's stack, GitHub (v60) must stay numerically below meeting-attendance (v61) because the runner applies array entries strictly increasing and #37 stacks on #35 — moving GitHub would cascade into renumbering v61 and colliding with v63. Moving screen-context v60→v62 is a one-number change that lands in the exact slot Track B itself had reserved for the connector stack, keeps every branch's array strictly increasing standalone, and keeps the interleaved array `[…59, 60, 61, 62, 63, 64, 65]` valid.

The stale "v62 is reserved for Linear + Granola" comment was rewritten to describe the final numbering (integration branch and #38's branch).

### 2.2 `src/main/services/workBlocks.ts` — both-sides-keep (2 hunks)

Track A added `scheduledMeetings` (resolved calendar events, DEV-189) to the day payload; Track B added `dayEntities` (durable entities for the wrap) at the same seam. Resolution: keep both computations and both fields in the return object, followed by Track A's `resolveScheduledMeetingsForDay` helper. No semantic interaction — both are additive, optional payload fields.

### 2.3 `src/shared/types.ts` — both-sides-keep (1 hunk)

`DayTimelinePayload` gains BOTH additive optional fields: `scheduledMeetings?: TimelineScheduledMeeting[]` (+ the `TimelineScheduledMeeting` interface, Track A) and `dayEntities?: DayWrapEntity[]` (Track B).

No other conflicts. `Settings.tsx`, preload, ipcContract tests, `queries.ts`, `index.ts` auto-merged cleanly and the merged suite proves no double registrations or interface drift survived.

## 3. Fixes pushed to responsible stack branches

1. **`claude/dev-197-202-screen-context-wrapped` (PR #34) — commit `69d1db5`**: screen-context migration renumbered v60 → v62 (+ renumbering note in its description; `tests/screenContextLifecycle.test.ts` test name updated). Branch suite spot-checked green (upgradedDatabaseMigration, screenContextLifecycle, migrationRoundtrip). The stacked branches (#36/#38/#42/#43) inherit the old v60 in their trees but never touch that hunk, so git's 3-way merges carry the renumber forward automatically once #34 lands.
2. **`claude/dev-205-206-briefs-versioned-analysis` (PR #38) — commit `9511144`**: the migration-numbering comment (introduced by this PR) corrected to describe the final v60/v61/v62 assignment; v63's description parenthetical updated. Comment-only.

No other cross-stack code fixes were needed — the integrated tree typechecked and passed the full suite after the three merge resolutions alone.

## 4. Migration ladder

`tests/upgradedDatabaseMigration.test.ts` (the v25-frozen representative database) climbs **v25 → v65** through the interleaved set on the integration branch and asserts `MAX(version) === LATEST_SCHEMA_VERSION (65)`: **PASS**. Also passes on #34's branch post-renumber (`…59 → 62 → 63 → 64 → 65`, runner tolerates ordered gaps) and Track A standalone (`…59 → 60 → 61`).

## 5. The brutal day — scorecard

New hermetic test on the integration branch: **`tests/brutalDay.test.ts` (16 tests, all PASS)** plus `tests/support/armBrutalBilling.ts`. One adversarial day driven through the REAL seams — `driveCaptureDay` (production tracking FSM + browser-context tracker + focus-event capture filter), the tracking-FSM harness, the connector fake providers (Google Calendar, GitHub, Linear, Granola), the fixture embedder over real sqlite-vec, and the fixture model (`MockLanguageModelV3`) through the real `sendMessage` pipeline. The armed exhausted-entitlement snapshot is Ed25519-signed with a test key and persisted where the app persists it.

| # | Subsystem | Spec mandate | Verdict | Evidence |
|---|---|---|---|---|
| 1 | Capture pipeline + privacy gates | capture-and-evidence.md: private windows never persist; exclusions enforced before persistence | **PASS** | brutalDay.test.ts:347 — incognito page/URL and excluded-app events rejected pre-storage (`rejectedFocusEvents === 2`); `findDatabaseTextMatches` sweep of every table for the private terms returns empty |
| 2 | Display visibility (full-screen Coursera in Dia, monitor 2) | capture-and-evidence.md §Per-display visibility: presence evidence, "never adds to foreground totals… one minute is never counted twice"; browser full-screen keeps identity+timing only | **PASS** | brutalDay.test.ts:366 — `payload.secondaryDisplay` carries the ~2h Dia span with `presence: 'visible'`; `totalSeconds` equals the block sum exactly (Invariant 7) |
| 3 | Passive reading hold | capture: a passive read is real activity; the unproven stretch is never stretched over | **PASS** | brutalDay.test.ts:836 — 20 min of zero-input Coursera reading holds the session live (0 flushes); switching away persists the honest ≥15 min duration |
| 4 | Rapid app/window switching bursts | capture-and-evidence.md: "Brief window or application switches remain evidence… capture remains responsive during dense switching"; no junk sessions | **PASS** | brutalDay.test.ts:836 — 5-second flips never persist (`persisted: false` under the 10 s floor); zero sub-10 s `app_sessions` rows |
| 5 | Incognito vanish | "a confirmed private window produces no application title, page title, URL, history record, or derived evidence" | **PASS** | brutalDay.test.ts:347 + :626 — nothing in any table, search returns nothing, and the context packet sent to the model never contains the private terms |
| 6 | Connectors (Calendar, GitHub, Linear, Granola) | connectors.md: fake-provider contract, idempotent sync, connected memory | **PASS** | brutalDay.test.ts:389 — all four connect+sync `status: 'ok'` via the real adapters against fakes; calendar + git day signals land; `connected_activity` memory records project; the merged PR is retrievable by name with `sourceType: 'connected'` |
| 7 | Meetings: matched / captured-only / calendar-only double-booked | timeline.md §Meetings: "A calendar event alone appears as scheduled context, not proof"; "Overlapping calendar events do not create additive time" | **PASS** | brutalDay.test.ts:501 — Acme sync `matched` (+`noteSupported: true` from Granola, observed time from the captured Zoom span); ad-hoc Zoom `captured_only`; the 13:00/13:30 double-booked pair both `calendar_only` with `observedSeconds: null`; `payload.scheduledMeetings` = 1 matched + 2 calendar-only; totals unmoved by scheduled events |
| 8 | Granola note attachment | connectors.md §Granola + timeline.md: notes corroborate occurrence, never invent minutes | **PASS** | brutalDay.test.ts:501 — `noteSupported === true` on the matched meeting via `google_calendar_event` source identity |
| 9 | Exact + semantic search | memory-and-entities.md: full-text owns exact names; semantic handles meaning; both hermetic | **PASS** | brutalDay.test.ts:536 — "Prompts are technical debt" found by name; "cheap television offers" (zero word overlap) finds "Best OLED TV discounts" by meaning through real sqlite-vec with the fixture embedder |
| 10 | Supplied memory confirmed in chat | memory-and-entities.md: "Nothing becomes durable until the person confirms it" | **PASS** | brutalDay.test.ts:556 — `propose_memory` card with exactly `['Save to memory', "Don't save"]`; explicit confirm persists; retrievable with `sourceType: 'supplied'` |
| 11 | Correction via agent propose→confirm | ai-agent.md: `propose → preview → confirm → apply atomically → offer undo`; timeline.md: corrections durable, change every surface | **PASS** | brutalDay.test.ts:578 — rename to "Client research for ACME" behind the preview card; label live on Timeline; row in `correction_undo_log`; the pre-existing day-analysis version is retired `retiredReason: 'correction'` (append-only, never erased); corrected label immediately searchable |
| 12 | Versioned analysis | agent-runtime: versioned inference, corrections retire rather than erase | **PASS** | brutalDay.test.ts:578 (retirement) on `day_analysis_versions` (migration v63) |
| 13 | Deletion + backup-restore replay honesty | capture-and-evidence.md §Deletion: "After deletion, rebuilding, restarting, reprojection, search… must not make the information reappear" | **PASS** | brutalDay.test.ts:739 — site purge removes the domain from every table and search; simulated backup restore resurrects rows; `replayDeletionJournal` kills them again (`failed: 0`); reindexing does not resurrect |
| 14 | Context packet Q&A + citations + inspector | agent-runtime-and-context: recorded disclosure, verified citations, inspectable context | **PASS** | brutalDay.test.ts:626 — `[C1]` verifies against the bound packet and renders superscript; unbacked `[C99]` dropped; every persisted citation's identity exists in the packet; `inspectContextPacket` fingerprint and item count equal the packet's exactly |
| 15 | Entitlement exhaustion → calm pause; BYOK unaffected | ai-agent.md: "Managed exhaustion pauses managed AI… without disabling local data or BYOK"; billing: money + questions, never raw tokens | **PASS** | brutalDay.test.ts:681 — signed exhausted snapshot ⇒ `canUseAI: false` with the calm message (names what keeps working + offers BYOK); `getManagedAIConfig() === null` (no session mint attempt); keyless resolution rejects `/AI access is paused/`; unreachable-service catalog shows NO invented allowance; reachable exhausted allowance reads 0 questions; picker keeps `byok:anthropic` selectable. **And** :626 — a real turn ANSWERS through the own-key path while exhausted |
| 16 | Evening recap / day wrap / weekly rollup reconciliation | wrapped.md: "Totals reconcile exactly with Timeline and Apps"; briefs.md: "a brief can never disagree with the surface it opens" | **PASS** | brutalDay.test.ts:770 — Apps total === Timeline total (exact); wrap `activeSeconds` === Timeline total; work+leisure+personal === headline; `factOnlyRecapLine` has zero ungrounded numeric tokens against the fact table; week rollup === sum of frozen day snapshots; the corrected label is what the evening surfaces say |
| 17 | Export honesty | capture/privacy: deleted + private content absent; withheld tables named | **PASS** | brutalDay.test.ts:806 — full history export byte-scan: purged domain, private-window terms, and excluded app absent everywhere; `screen_context_frames`/`screen_context_evidence` named in the omissions manifest; the corrected label and the matched meeting are in the exported day |
| 18 | Screen experiment refusal (password manager) | screen-context + v2.md: "Respect… password surfaces… before capture" | **PASS** | brutalDay.test.ts:941 — a 1Password foreground title is refused `reason: 'protected_surface'` with **zero** frame-source calls (no pixel read) and zero ledger rows |
| 19 | Screen experiment lifecycle honesty | v2.md §Screen-context: "Atomically persist the derived evidence… before marking the frame safe to delete"; quarantine failures | **PASS** | brutalDay.test.ts:1000 — raw file deleted only after the evidence commit (`deletedWithoutEvidence: false`); a failing extractor never deletes the only copy |
| 20 | Pause/resume checkpoints | agent-runtime §Sessions and interruption: restart recovery marks incomplete work accurately | **PASS** | brutalDay.test.ts:1067 — running/awaiting degrades to `paused (restart)` with the verbatim question; resume rejoins; terminal close deletes the row |

**Iterated fixes during the brutal day (test-side only, no product defects found):**
- The privacy sweep initially flagged `app_sessions.ended_reason = 'incognito'` — that is an operational capture-state enum, not captured content; the sweep now asserts on content terms.
- `lifecycle.captureFrame` returns `{ captured, frame }`, not the frame — the first draft silently skipped `processFrame`.
- With the billing service unreachable, the exhausted snapshot is honestly `mode: 'unavailable'` and the model catalog shows NO allowance block by design ("never a made-up figure") — the test now asserts that honesty and exercises the 0-questions view with a reachable-shaped snapshot.
- The billing "vite defines" are captured at module-evaluation time by the test loader, so the entitlement arming had to ride a first-evaluated module (`tests/support/armBrutalBilling.ts`).

**Product defects found by the brutal day: none.** Every subsystem behaved to spec on the integrated tree at the first honest attempt; all four initial failures were test-harness misuses, documented above.

## 6. Recommended merge order (exact)

The migration runner never revisits versions below `MAX(applied)`, so the connector stack (v60/v61) **must** merge before the screen/wrapped stack (v62–v65). Merge PRs in this order:

1. **#32** `claude/ci-blacksmith` — clean.
2. **#33 → #35 → #37 → #39** (Track A, in stack order) — each merges clean into main.
3. **#34** `claude/dev-197-202-screen-context-wrapped` (now carrying the v62 renumber, commit `69d1db5`) — **expect one conflict** in `src/main/db/migrations.ts`: both sides appended after v59. Resolution: keep Track A's v60 (GitHub) and v61 (meetings) first, then #34's v62 (screen-context) — exactly the integration branch's file; copy from `claude/v2-integration-check` if in doubt.
4. **#36** `claude/dev-203-204-wrapped-story-recap` — **expect conflicts** in `src/main/services/workBlocks.ts` and `src/shared/types.ts` (Track A's `scheduledMeetings` vs this PR's `dayEntities`). Resolution: keep BOTH (order: `scheduledMeetings`, then `dayEntities`) — again exactly the integration branch's files.
5. **#38** `claude/dev-205-206-briefs-versioned-analysis` (carrying the comment fix `9511144`) — expect clean (the v62 renumber carries through the 3-way).
6. **#42** `claude/dev-199-198-fix-day-screen-experiment` — expect clean.
7. **#43** `claude/dev-200-201-pause-model-picker` — expect clean (`modelPricing.ts` identical to #41's copy).
8. **#40** `claude/issue-4-label-voice-rubric` — clean.
9. **#41** `claude/dev-194-195-entitlement-pass` — clean.

After each merge, main should be green; after all nine, main's `migrations.ts`, `workBlocks.ts`, and `types.ts` should be byte-equivalent to `claude/v2-integration-check` (modulo the brutal-day test and this report, which can be cherry-picked or merged from the integration branch afterwards if wanted on main).

Do **not** merge `claude/v2-integration-check` itself — it is the proof artifact.

## 7. Verification on the integrated tree

- `npx tsc --noEmit` — clean.
- Full hermetic suite (`scripts/run-tests.mjs` semantics, per-file process isolation): **302 files · 2055 pass · 0 fail · 10 skip** (skips are real-DB-gated). Note: the container cannot download the Electron binary (egress policy), so the suite ran under plain Node with the identical per-file loader — better-sqlite3, sqlite-vec, and every stub behave identically; CI (which has Electron) re-verifies on push.
- `eslint` on all merged/new files — clean.
- Migration ladder v25 → v65 — PASS (integration branch); v25 → 62..65 — PASS (#34 branch); v25 → 61 — implicit in Track A's own green suite.

## 8. Genuinely unresolved / out of overnight scope

1. **Electron-binary suite run**: the sandbox's egress policy blocks the Electron download, so the overnight verification ran the per-file suite under Node (identical loader and stubs). CI on the pushed branches provides the Electron-run confirmation.
2. **Stacked branches still carry the pre-renumber v60 in their own trees** (#36, #38, #42, #43). Harmless — each branch's array is strictly increasing standalone and the 3-way merge inherits #34's fix — but if any of those PRs later edits the screen-context migration hunk directly, re-check the number survives.
3. **A user database that already applied a Track B build** (v62+ before v60/v61) would permanently skip the GitHub/meetings migrations. No such build has shipped — this is only a warning to keep the merge order above and not to cut a release between steps 3 and 2.
4. **`docs/reviews/`** did not exist before; this report creates it. If the owner prefers reviews elsewhere, it is one `git mv`.
