You are making Daylens fast. perf-audit/findings/ holds performance audits from several AI agents, each a list of bottlenecks in the same format. Agreement is the strongest signal. A bottleneck several agents flagged independently is almost certainly real. Fix it first.

Read every file in perf-audit/findings/. Merge findings that point to the same root cause or location into one. Build one ranked list, ordered by: how many agents flagged it, then Impact, then lowest Risk.

Fix top-down. For each fix:
- Measure the relevant number first: cold start, tab-switch latency, input latency, re-render count, or query time. Whichever the finding concerns.
- Make the change.
- Measure again. If the number did not improve, revert.
- Commit, then run npm run typecheck.

Rules:
- Performance only. Do not change behavior or features.
- Do not rewrite in another language or leave Electron. Fixes live in the React render graph, work scheduling, SQLite queries, and IPC.
- Never run billed AI commands: no test:behaviour, ai:bench, test:toolcalls, test:entity-prompts, no report regeneration, no memory backfills, no API keys. typecheck and running the app are safe.
- Small commits. No new docs.

When done, open a PR. The title states the worst-case speedup as a multiple. The body is a before-and-after table for every metric you moved, then the merged fixes ranked by impact, one line each on the root cause. Real measured numbers only. Delete the perf-audit/ folder in the same PR.
