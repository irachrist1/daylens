# Session D — Shipping checklist (unsigned Mac + Windows) and Linear issue tracking

**Read `docs/full-audit-2026-07-07.md` and `docs/implementation-2026-07-07.md` first.** The
implementation record tells you which build/security fixes are already in — do not assume.

> Needs access to the Linear Daylens workspace for the second half.

---

## Operating doctrine (applies to this whole session)

**Model & effort.** Run as Fable 5 at **HIGH** reasoning effort. Not xhigh/max/ultra. Effort
is per-step thinking, not how long you can work.

**Model routing (defaults, not limits).** *Intelligence* = hardest problem handled
unsupervised; *taste* = UI/UX, code quality, API design, copy. **Fable 5 (you):** best
intelligence + taste; write all user-facing copy (checklist prose, ticket titles) yourself.
**Opus 4.8:** high taste, cheaper reviewer. **GPT-5.5 via Codex:** high intelligence, low
taste, effectively free — use for bulk reads (parsing the audit into findings), running
builds, and web research; review its writing before it ships. Cost is a tie-breaker only.

**Shelling out to GPT-5.5 (Codex) — verified working here.** Reads/research/build logs:
`codex exec -m gpt-5.5 -s read-only "<self-contained prompt>"` — effort is a Codex config value,
not a CLI flag (no `--effort`). Simple, literal prompts. **No computer-use skill is installed
and `codex exec` can't drive a GUI** — you can run builds in the shell, but *launching*
installers and walking SmartScreen/Gatekeeper is a founder check.

**Sub-agents vs. workflows.** Fan out audit parsing to sub-agents; workflow when staged.
Prefix 5.5-driven work with `[5.5]`.

**Verification rule (non-negotiable).** Done = the file exists and is correct, you have
*actually run* the builds/steps you document, and it's committed / tickets created. Green
tests are not proof. If a build fails, report the failure — don't paper over it.

**When the ground contradicts the prompt.** Flag stale premises; never invent to satisfy an
instruction. In particular, confirm claimed prior fixes against
`docs/implementation-2026-07-07.md` and git before relying on them.

---

## Deliverable 1 — `docs/shipping-checklist.md`

A step-by-step document a **non-engineer** can follow, with exact terminal commands and a
clear "what success looks like" at each step. This is arguably the most important
deliverable: if users can't download and open the app, nothing else matters.

**Preconditions (confirm before writing the build steps):**
- Confirm the build-blocking fixes are actually in (the recharts / version regression, and
  the auto-updater security fix). Check `docs/implementation-2026-07-07.md` and git — do not
  assume. If they're not in, say so at the top of the checklist as a blocker.

**macOS without an Apple Developer ID:**
- First launch requires **right-click → Open** (Gatekeeper blocks unsigned apps by default).
- Alternative: ship ad-hoc signed and document it on the download page.
- Notarization: **research the current facts and state them honestly** — can you notarize
  without a paid Developer ID account, or not? Don't guess; verify (web / Codex) and cite.
- No Mac App Store distribution without a Developer ID.
- Action: add a clear "How to open on Mac" section to the download page (with a screenshot).
- Future: a $99/year Apple Developer ID removes all of this — budget it for the next release.

**Windows without an EV certificate:**
- SmartScreen shows "Windows protected your PC." Users click **More info → Run anyway**.
  Annoying, not blocking.
- Action: add "How to bypass SmartScreen" to the download page (with a screenshot).
- Future: EV cert ~$300/year — budget it.

**Both platforms:**
- Run a clean build: Mac (DMG) and Windows (NSIS installer). Include the **exact** commands.
- Confirm both installers open and the app launches.
- Test the update flow: install an old build, point the update feed at a new version, confirm
  the update downloads and relaunches (works even without code signing). The auto-updater
  security fix must be in before shipping any update mechanism.

Write it so someone non-technical can execute it start to finish.

## Deliverable 2 — Linear issue tracking

The Daylens Linear workspace exists but is unused. Wire it up.

1. **Teams:** Tracking Engine · UI / Product · Infrastructure.
2. **Labels:** bug · security · performance · debt · feature.
3. **Import** every open issue from `docs/full-audit-2026-07-07.md` and
   `docs/issues-2026-07-06.md` as tickets. Each ticket: title, description, team, priority
   (urgent / high / medium / low), and one label. **Translate each finding into a single
   actionable ticket** — do not paste the audit verbatim. A finding with no clear owner or
   action gets label `debt` and priority `low`.
4. **Close** any tickets whose fixes already landed (cross-reference
   `docs/implementation-2026-07-07.md`). Mark them Done with a one-line note on what fixed them.

**Ticket titles:** plain, on-the-point sentences. No fancy words that communicate nothing.
E.g. "Analyze Day button does nothing on empty days" — not "Enhance temporal analysis UX
resilience."

## Verify & hand off, then commit

**Agent verification (headless):**
- Run the documented build commands for real where the platform allows: the Mac DMG builds on
  this Mac. A Windows NSIS build likely needs CI or a Windows box (see the `release-windows`
  workflow) — if it can't run here, **say so in the checklist** and point at the workflow rather
  than pretending it built locally.
- Confirm the Linear teams, labels, and tickets exist and already-fixed ones are closed.

**Founder handoff:** *installing and launching* the DMG/installer, and walking the
Gatekeeper / SmartScreen bypass and the update flow, is a GUI check you cannot do (no
computer-use). Hand the founder the exact steps to confirm each installer opens, the app
launches, and an update downloads + relaunches. Only the founder marks the shipping path
verified.

Commit the checklist and Linear changes; note the founder install-check is pending. Append
three sentences to `docs/implementation-2026-07-07.md`.
