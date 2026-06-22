# Daylens — how agents work here

Read this before you touch the repo. Then read [`PRODUCT.md`](PRODUCT.md) (the vision),
[`docs/plans/DAYLENS-V2-PLAN.md`](docs/plans/DAYLENS-V2-PLAN.md) (the 12 invariants), the
specs in [`docs/specs/`](docs/specs/), and
[`docs/plans/AGENT-EXECUTION-PLAN.md`](docs/plans/AGENT-EXECUTION-PLAN.md) (the issue
order, models, build spine). The invariants are physics — never break one to ship a feature.

## The goal

Daylens is broken in the ways listed in the plan. Your job is to take it from there to the
PMF vision by completing the Linear issues in the "Daylens v2" project. One issue at a time
turns into one tested feature. You are done when the issues are done and the user has
confirmed each one works on a real day.

## The loop

You run this loop without stopping to ask questions:

1. **Pick the issue.** Work the "Daylens v2" project — issues **DEV-87 … DEV-92**, each one a
   whole shippable PR. Take the lowest-numbered issue that is **not blocked** (Linear shows the
   blockers; DEV-87 unblocks the rest). If nothing is unblocked, say so and stop.
2. **Branch from `main`.** `git fetch` and branch from the latest `main`:
   `agent/dev-<n>-<slug>`. Never commit to `main`.
3. **Plan first, in the issue.** Before writing code, read the issue's spec links and the
   invariants (they are physics — never break one to ship), then comment your plan on the issue:
   the files/systems you'll change, the approach, decisions where the spec is silent, and the
   edge cases you see. **If the issue involves visual or UX design, your plan pauses here for
   references — see "Design work" below.** Move the issue to **In Progress**.
4. **Build it.** Make reasonable calls when the spec is silent — document them in the PR, don't
   stop to ask. Be ruthless about deleting legacy code; if you're not adding it back, it wasn't
   needed. Tick the issue's acceptance checklist as each item lands.
5. **Verify it for real** (quality gate below) — including the issue's "one test you run."
6. **Open a PR and clear review.** Open the PR, move the issue to **In Review**, and comment in
   the format below. Then **resolve every comment the automated reviewers leave** (Bugbot,
   CodeRabbit, `/code-review` — whatever runs on the PR): fix it, or reply with why it's
   intentional, and re-request review. The issue is not ready until every reviewer thread is
   resolved and the acceptance checklist is fully ticked.
7. **Repeat** with the next unblocked issue.

## Definition of done — the ship checklist

An issue (DEV-87 … DEV-92) is ready for the user to test only when **all** of these are true:

- [ ] Every box in the issue's **acceptance checklist** is ticked and true in the running app.
- [ ] The issue's **"one test you run"** passes when you do it by hand in the app.
- [ ] `npm run typecheck` and `npm run lint` are clean; `npm test` is green.
- [ ] You **drove the real app** (`npm start`) and attached **before/after screenshots** to the
      issue — green tests are not proof.
- [ ] No spec **invariant** is broken to ship the feature.
- [ ] **Every automated-reviewer comment** on the PR is resolved — fixed or answered — and review
      re-requested.
- [ ] The Linear comment (What changed / What to test / Evidence) is posted and the issue is **In
      Review** — never Done. Only the user sets Done, after testing on a real day.

The user's only job is to test. Everything up to the test is yours. Never ask the user a
question mid-run — make the call, write down why, and surface it when the issue is ready.

## Design work — ask before you invent a look

The specs define **behavior**, not **aesthetics**. They say what a screen shows, its states,
and how it acts — never the visual style. That is on purpose.

**If an issue involves visual or UX design — a new screen, a redesigned panel, onboarding, the
wrap carousel, the AI chat surface, the Apps layout — stop and ask Tonny for reference
screenshots before you build the look.** "Here are three apps whose onboarding I like — which
direction?" beats inventing one and getting it thrown out. Touchstones already named in the
specs: **Raycast** (clean, native, keyboard-first), **Dia** (the morning-brief voice and feel),
**Spotify Wrapped** (the wraps). Use them as a starting point, but get Tonny's actual
screenshots and pick a direction with him **before** writing the UI — this is the one place you
do pause and ask. Functional behavior never waits; the *look* always does.

## Work whole issues, never micro-PRs

Each issue **DEV-87 … DEV-92 is already one whole testable feature = one PR** — a PR the user
can open the app and check. Ship the whole issue, not a PR per file or per checklist line. If a
change can't be tested on its own, it belongs with the rest of its issue.

## The quality gate — green tests are not truth

`npm run typecheck` must pass. That's the floor, not the proof.

**Green `npm test` does not mean the feature works.** The only proof is the running app.
For every issue:

- Drive the real Electron app (`npm start`).
- Take screenshots of what you actually see — the timeline, the block, the chat answer.
- Attach them to the Linear issue as evidence.
- If you can't visually verify something, **say so plainly.** Never claim a screen works
  when you haven't seen it work. "I couldn't reproduce this on a live day" is a real,
  acceptable answer. A false "it works" is not.

## Linear protocol

- Move an issue to **In Progress** when you start it.
- Move it to **In Review** when the PR is open.
- **Never set an issue to Done.** Only the user does that, after testing. Done means a human
  confirmed it on a real day.
- Comment on each issue when the PR is ready, in exactly this shape:
  - **What changed for you** — the user-visible difference, plain English.
  - **What to test** — numbered steps the user follows to verify.
  - **Evidence** — the screenshots you took driving the app.

## Commands that need human approval

These cost money, mutate data, or hit the AI providers. **Never run them without explicit
human approval:**

- `npm run test:behaviour`
- `npm run ai:bench`
- `npm run test:toolcalls`
- `npm run test:entity-prompts`
- Report regeneration (day/week/month recaps, wraps)
- Work-memory backfills / rebuilds

These are always safe and need no approval: `npm run typecheck`, `npm start` (running the
app), reading code, taking screenshots. `npm run timeline:eval` is safe to read; it is a
scored baseline, not a pass/fail gate.

## Language

Plain English. No role honorifics ("as requested, sir"), no agent-speak ("I shall now
proceed to..."), no walls of text. Write like the specs are written — short, specific,
grounded. Say what changed and what to test. That's it.

## Cursor Cloud specific instructions

This is an Electron desktop app. Standard commands live in `package.json` / `CONTRIBUTING.md`
(`npm run typecheck`, `npm run lint`, `npm test`, `npm start`). The VM snapshot already has the
native-module system libraries (`libsecret-1-dev`, `xvfb`, `dbus-x11`, etc.) and node deps
installed; the startup update script runs `npm install`, whose `postinstall` rebuilds the native
modules (`better-sqlite3`, `@paymoapp/active-window`, `keytar`) against Electron. If a run ever
hits a native-module ABI error, re-run `npm install` to rebuild.

- **Running the app:** it needs a display. A desktop is on `DISPLAY=:1`, and the container needs
  the sandbox off, so launch with `DISPLAY=:1 ELECTRON_DISABLE_SANDBOX=1 npm start`.
- **Expected non-fatal noise:** `Failed to connect to the bus` (dbus), `Exiting GPU process`,
  `failed to register global shortcut`, and `keytar`/`settings hasApiKey` "transport disabled"
  errors are all normal headless-VM output — the app still runs. There is no OS keyring, so API
  keys can't be stored; the app starts fine without one.
- **Tests:** `npm test` is hermetic (no API keys, no network) and runs each file in its own
  Electron-as-node process. It does not need a display. The paid AI suites listed above still
  require human approval and real keys.
