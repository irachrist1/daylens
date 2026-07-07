# Session C — Monorepo cleanup (irreversible — run supervised)

**Read `docs/full-audit-2026-07-07.md` and `docs/implementation-2026-07-07.md` first.**

> This session makes structural, hard-to-reverse changes. **Do not run it headless or fully
> autonomous.** You have autonomy for anything reversible in git (adding files, `git mv`,
> workspace wiring). For anything that leaves git's reach — deleting files, or moving
> untracked / external directories — **stop and get founder confirmation first.** Archive,
> never delete.

---

## Operating doctrine (applies to this whole session)

**Model & effort.** Run as Fable 5 at **HIGH** reasoning effort. Not xhigh/max/ultra. Effort
is per-step thinking, not how long you can work.

**Model routing (defaults, not limits).** *Intelligence* = hardest problem handled
unsupervised; *taste* = UI/UX, code quality, API design, copy. **Fable 5 (you):** best
intelligence + taste, steer everything. **Opus 4.8:** high taste, cheaper reviewer.
**GPT-5.5 via Codex:** high intelligence, low taste, effectively free — use for bulk reads
(e.g. mapping which dir imports which); review its code before landing. Cost is a tie-breaker
only; intelligence > taste > cost for anything that ships.

**Shelling out to GPT-5.5 (Codex) — verified working here.** Reads/analysis:
`codex exec -m gpt-5.5 -s read-only "<self-contained prompt>"` — effort is a Codex config value,
not a CLI flag (no `--effort`). Simple, literal prompts; "nothing found" is valid. **No
computer-use skill is installed and `codex exec` can't drive a GUI** — build/install checks you
run yourself in the shell; there's nothing GUI to verify in this session anyway.

**Sub-agents vs. workflows.** Fan out import-graph reads to sub-agents; workflow when staged.
Prefix 5.5-driven work with `[5.5]`.

**Verification rule (non-negotiable).** Done = (1) `npm install` from root succeeds with one
lockfile, (2) the build passes, (3) committed. Green tests are not proof — actually run the
install and the build. If you can't, say so and stop.

**When the ground contradicts the prompt.** The audit is stale in places (see corrections
below). Flag mismatches; never invent paths to satisfy an instruction.

---

## Grounded corrections to the audit (verified 2026-07-07 — read before acting)

- `packages/` today contains **only** `mcp-server` (no `package.json`) and `remote-contract`.
- `snapshot-schema` and `prompt-builder` **do not** live at top-level `packages/` — they are
  at **`apps/web/packages/snapshot-schema`** and **`apps/web/packages/prompt-builder`**.
  Decide from their imports whether they belong to the `apps/web` workspace or should be
  promoted to top-level shared packages. **Do not create empty duplicates at `packages/`.**
- There is **no `daylens-swiftUI` directory in this repo** — only a single file
  `probes/capture-probe.swift`. The audit's "move the SwiftUI directory to archive" step
  cannot be done here. **Do not invent or fabricate it.** If the SwiftUI project lives in a
  separate repo/location, that archival is a separate task — flag it to the founder and stop.

## Tasks

1. **Workspaces.** Add a `workspaces` field to the root `package.json` covering the packages
   that genuinely exist and should be workspace members. Investigate imports first; use the
   real paths (see corrections). Add a `package.json` to `packages/mcp-server` so it's a valid
   workspace member.
2. **Single lockfile.** Consolidate the two lockfiles (root + `apps/web`). Run `npm install`
   from the root and confirm everything resolves to one lockfile.
3. **`STRUCTURE.md`** at repo root: map every top-level directory — what it is, active vs.
   archived, and which other directories import it. Use Codex to build the import graph.
4. **Archival (only if a real dormant dir exists).** For any confirmed-dormant directory the
   founder OKs archiving: create `/archive/<name>-<month-year>/`, `git mv` the contents there,
   and add a `README.md` inside describing what it did, where it stopped, and enough context
   that it could be open-sourced for others to build on. Kept for reference, not a dependency.
   **Archive only — never delete.** (Per the correction above, the SwiftUI archival is likely
   out of scope for this repo; do not force it.)

## Verify & commit

- `npm install` from the root succeeds with **one** lockfile.
- The build passes (run it — don't infer). 
- Commit. Append three sentences to `docs/implementation-2026-07-07.md` summarizing what this
  session added, and list explicitly anything you flagged for the founder instead of doing.

The goal is a clean, distraction-free workspace that's genuinely pleasant for both humans and
agents to work in — not a pile of half-wired workspace globs.
