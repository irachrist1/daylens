# V1 progress workspace

This folder is the shared source of truth for the current V1 repair pass. The user gave the same prompt to multiple agents, so the goal here is to keep the surviving plan small, current, and grounded in code plus screenshots.

## Files to use

- [STATUS.md](./STATUS.md) — V1 UX/performance issue status, next steps, and what is actually proven.
- [MEMORY-SYSTEM.md](./MEMORY-SYSTEM.md) — Work Memory vision, research queue, and implementation plan (labels/summaries that learn over time).
- [PLATFORM-SHIPPING.md](./PLATFORM-SHIPPING.md) — Windows/Linux shipping audit, fix log, and work queue (separate track).
- [REVIEW.md](./REVIEW.md) — code and screenshot review of the latest fast-moving implementation.
- [TRACKER.md](./TRACKER.md) — compatibility pointer for older agent notes; use `STATUS.md` moving forward.

Historical per-agent notes and per-issue investigation files were consolidated into `STATUS.md` and `REVIEW.md`. Do not add more one-off note files unless the user asks for another parallel-agent collection pass.

## Branch & repo (required — read before every session)

**Wrong-branch work was a real problem.** Agents have worked on different branches and remotes; CI results, code changes, and progress docs did not always match.

### Before you change anything

Run and record in your session report:

```bash
git branch --show-current
git status -sb
git remote -v
git log -1 --oneline
```

If branch, remote, or dirty state does not match what the progress doc says, **stop and reconcile** (checkout correct branch, pull, or ask the user). Do not implement on a stale or unrelated branch.

### Canonical setup (V1 active work)

| Item | Value |
|---|---|
| **Repo** | `irachrist1/daylens-v1` (local remote name: `v1`) |
| **Integration branch** | Confirm at session start — often `main` or a named feature branch (e.g. `codex/platform-shipping-sh3`) after merges |
| **Legacy repo** | `irachrist1/daylens` (`origin`) — do not assume this is where V1 CI runs |

Tonny is **merging divergent branches**. After a merge, update the **Active branch** line in the relevant progress doc (`PLATFORM-SHIPPING.md`, `MEMORY-SYSTEM.md`, or `STATUS.md`) with branch name + commit SHA.

### Rules for all agents

1. **One branch per track** unless the user explicitly splits work — platform shipping, memory, and V1 UX should land on the same integration branch when possible.
2. **Push before CI claims** — if you say "CI passed", cite run URL, **repo**, **branch**, and **commit SHA**.
3. **Update progress docs on the same branch** as your code — do not document SH-3 green on branch A while fixes live on branch B.
4. **Do not touch unrelated dirty files** — note them in the report; do not commit them accidentally.
5. If `docs/v1-progress/` is untracked on your branch, add and commit it with your track's changes so other agents see the same plan.

### Active branch (update when merge completes)

| Track | Branch | Commit | Remote | Last updated |
|---|---|---|---|---|
| Platform shipping | `codex/platform-shipping-sh3` | `a03ee30` (partial SH-3) | `v1` / `irachrist1/daylens-v1` | 2026-05-28 |
| Work Memory | *pending merge* | — | `v1` | 2026-05-28 |
| V1 UX fixes | *local dirty / unmerged* | — | confirm | 2026-05-28 |

*User: after you finish merging, update this table to a single integration branch and commit.*

## Ground rules

- Work one issue or sub-step at a time.
- Do not mark an issue `done` from typecheck alone.
- Claims should be marked as `code-proven`, `screenshot-observed`, `tested`, or `not validated`.
- Screenshots are evidence of current UX, not proof of performance timing.
- The Definition of Done is: scoped code change, typecheck/tests as appropriate, screenshot or runtime validation, and status updated here.

## Product references

- [../AGENTS.md](../AGENTS.md)
- [../AI-PRODUCT-DIRECTION.md](../AI-PRODUCT-DIRECTION.md)
- [../V1-PHASE-4-TIMELINE.md](../V1-PHASE-4-TIMELINE.md)
- [../V1-PHASE-5-APPS.md](../V1-PHASE-5-APPS.md)
- [../V1-PHASE-6-AI.md](../V1-PHASE-6-AI.md)
