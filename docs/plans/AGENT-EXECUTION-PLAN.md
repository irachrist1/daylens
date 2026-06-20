# Daylens v2 — agent execution plan (issues, models, order)

The issue order. Read [`AGENTS.md`](../../AGENTS.md) first for how the loop works. Pick the
lowest-numbered **unblocked** issue in the "Daylens v2" project (DEV-87 … DEV-92), plan it in
the issue, build it, PR it, clear review, move it to In Review.

## Which model does which work

Match the model to the risk and shape of the work:

- **Opus 4.8** — risky cross-surface work where one mistake breaks the invariants: the capture
  foundation and block engine (DEV-87, DEV-88). When in doubt, this one.
- **GPT-5.5** — backend, aggregation, resolvers, SQL: the AI resolver layer (DEV-90), frozen
  snapshots and wrap math (DEV-91).
- **Sonnet 4.6** — frontend and React: the Timeline/Apps/AI views, the wrap carousel, Settings
  and onboarding UI (DEV-89, and the view layers of DEV-88/90/91/92).
- **Composer 2.5** — mechanical, well-specified patches: renames, prop plumbing, deleting dead
  code, label string changes.

## The build order spine

**Capture first, then everything fans out.** Nothing downstream is trustworthy until DEV-87 is
merged — every view reads the same evidence object (one truth, three views), so blind capture
poisons all of them. After capture: the Timeline and Apps and AI fan out; briefs/wraps need a
trustworthy day and the resolvers; settings/onboarding cross-cut.

```
DEV-87 capture ──┬── DEV-88 timeline ──┐
                 ├── DEV-89 apps        ├── DEV-91 briefs + wraps
                 ├── DEV-90 AI ─────────┘
                 └── DEV-92 settings + onboarding
```

(The blocking relations in Linear encode this: DEV-87 blocks 88/89/90/92; DEV-88 and DEV-90
block 91.)

## The issues

| Issue | What it ships | Blocked by | What the user tests |
|---|---|---|---|
| **DEV-87** | **Capture foundation** — window-title + permission capture, OS-based browser discovery (Zen), the rich evidence object, 10s dwell floor, system-noise + day-boundary rules. | — | Zen browsing shows up; blocks carry real window/page context; sessions are tens not thousands; no `loginwindow`. |
| **DEV-88** | **Timeline** — ~8-block segmentation, tiered intent naming + unknown-intent rule, merge + absorb, proportional sizing, provisional live block, recap replaces grades, corrections that stick. | DEV-87 | A real day reads as ~8 named blocks; a Netflix peek is absorbed; no Score/Drift; a rename survives re-analyze. |
| **DEV-89** | **Apps** — real app-name titles every period (+ All-time), domain attribution to the hosting browser, deduped work-first pages, Today not empty, delete page/domain, no "often used with". | DEV-87 | Click Zen/Safari → right name, right domains, deduped pages, detail without Generate. |
| **DEV-90** | **AI** — plan → resolve → phrase (tool-loop deleted), resolver set, tables, DOCX/PDF export, recall, chat state, model-from-Settings. | DEV-87 | "What did I do today?" → grounded answer; week → a table; report → a real doc; history survives a tab switch. |
| **DEV-91** | **Briefs & wraps** — frozen daily snapshots, morning brief (2 notifications), evening wrap (≤5 / 2 cards), weekly + monthly + annual. | DEV-88, DEV-90 | A weekly wrap: card and write-up agree to the minute, reads like Wrapped, no score. |
| **DEV-92** | **Settings & onboarding** — labels (all apps, auto-categorize, propagate), work memory (editable paragraph), MCP off in prod, clients, model selector, first-run that proves capture. | DEV-87 | Relabel an app → changes everywhere; edit the memory paragraph → it persists; onboarding proves capture before asking for trust. |

Each issue carries its own spec links, acceptance checklist, and the one user-facing test in
its Linear description. Accessibility (keyboard + screen-reader path) and the visual quality
gate are **not** separate work — every issue ships keyboard-completable and screenshot-verified.
See [`docs/research/open-questions.md`](../research/open-questions.md) for the cross-cutting
decisions, [`docs/findings.md`](../findings.md) for why capture comes first, and
[`docs/research/prior-art.md`](../research/prior-art.md) for the patterns behind the thresholds.
