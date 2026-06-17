# Linear setup — Daylens v2

**Status: structure built (2026-06-17).** Workspace `irachrist1` (ctonny111@gmail.com), team **Irachrist1 / DEV**.
Project: **Daylens v2** — https://linear.app/irachrist1/project/daylens-v2-7ae66ef24a80

## What exists

**Workflow states** (team defaults, mapped — MCP can't create custom states):
Backlog = broken today · Todo = planned · In Progress = building · **In Review = ready for founder to test** · Done = verified by founder · Canceled = out of scope.

**Labels:**
- Surface (group): timeline, apps, ai-chat, memory, morning-brief, evening-wrap, wraps, notifications, settings, onboarding, capture, trust
- Severity (group): blocker, major, minor
- `ready-to-test` — agent finished + self-verified; waiting on founder
- `unverified` — agent couldn't confirm by running the app; needs live test

**Convention** (in the project description): agents move Todo → In Progress → In Review (+`ready-to-test`, with evidence comment); never set Done — only the founder does, after testing. Couldn't verify → stay In Progress + `unverified`.

## Founder's daily queue
Filter by the `ready-to-test` label, or watch the **In Review** column. Save it as a view in the Linear UI (the MCP can't create saved views).

## Still to do — seed issues
Not seeded yet, by design — wait for the council's `docs/plans/DAYLENS-V2-PLAN.md`. Then run:

```
In Linear workspace irachrist1, project "Daylens v2": read docs/plans/DAYLENS-V2-PLAN.md
and docs/plans/FEATURE-REGISTRY.md. Create one issue per feature. Title = feature name.
Description = Should / Now / Gap / Fix / Acceptance (from the plan). Set the Surface label
and a Severity label. Status: Backlog if broken today, Todo if it's fine and just queued.
Attach the relevant screenshot from docs/plans/screenshots/. Then create milestones from
the plan's build-sequence phases and assign each issue to its phase.
```

To seed from the current registry instead of waiting, point the same prompt at `FEATURE-REGISTRY.md` only — but expect churn, since UNVERIFIED rows may change after the council.
