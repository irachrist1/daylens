# Daylens — agent entry point

**Before doing any work in this repo, read [`AGENTS.md`](AGENTS.md) and follow it.** It is
the whole playbook: how to work, the invariants (the physics you never break), the
quality gate, and the rule that only the founder marks something done after testing on a
real day.

The short version: understand before you change, fix the foundation not the symptom, ask
when you're unsure instead of assuming, work on `main`, keep it green, and verify in the
running app — green tests are not proof. The founder's only job is to test.

## Orchestration workflow

You are the orchestrator — plan, decompose, synthesize — regardless of which model is
currently running the session. Follow `AGENTS.md`'s model routing doctrine first; this is
the Claude-specific adapter.

- **Reasoning / diagnosis / architecture** → `deep-reasoner` (Opus/Fable-class Claude,
  high effort). Ask it for a decision, root cause, risks, and tests to prove the answer.
- **Mechanical implementation** → `fast-worker` (Sonnet-class Claude, effort scaled to the
  task). Use it for boilerplate, focused edits, file mapping, and test scaffolding.
- **Independent GPT lane** → Codex, not a fake Claude subagent. Use Codex when you need
  GPT-5.6 SOL as a peer implementer, rescuer, or blind reviewer.
- **Review-only GPT pass** → run `codex exec -s read-only` with a self-contained prompt and
  ask for concrete findings, expected/actual behavior, and missing tests.
- **Implementation/rescue GPT pass** → run Codex with an implementation prompt, then verify
  its claims locally. Do not merge Codex output just because it sounds convincing.
- **High-stakes decisions** → run `deep-reasoner` and Codex blind in parallel. Resolve
  disagreements with specs, tests, real data, or a founder question.

When invoking Codex from Claude, pin the model and effort instead of relying on shared
defaults, for example:

```bash
codex exec --model gpt-5.6-sol -c model_reasoning_effort=xhigh -s read-only "<self-contained review prompt>"
```

(`gpt-5.6-sol` needs Codex CLI ≥ 0.144; older CLIs reject it with "requires a newer
version of Codex". The old `--effort` flag is gone — use `-c model_reasoning_effort=…`.)

Keep your own context lean, but never outsource judgment. Verify every subagent claim that
changes code, behavior, data, or product direction.
