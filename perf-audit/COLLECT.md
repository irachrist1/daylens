You are auditing Daylens, an Electron + React + SQLite desktop app, for performance problems. The app works correctly. It is just slow. Read only. Do not change code, run commands, or start the app.

Find what makes it slow. Look hardest at:
- Startup: heavy work the main process redoes on every launch.
- React renders: state held higher than it needs to be, missing memoization, inline object/function props that defeat React.memo, effects that read layout (scrollHeight, getBoundingClientRect) on every keystroke or frame.
- SQLite (src/main): full scans, missing indexes, N+1 patterns, queries run per render or per IPC call.
- IPC (src/preload, src/main/ipc): chatty calls, large payloads, data refetched on every navigation.

Report every bottleneck in exactly this format, one block per finding, nothing between blocks:

---
ID: F1
Symptom: what the user feels
Location: file:line
Root cause: why it is slow
Evidence: the exact code or pattern that proves it
Fix: one sentence
Impact: high | medium | low
Risk: high | medium | low
---

Rules:
- Read only. Every finding cites a real file and line you actually read. No guesses.
- Do not propose another language or leaving Electron. No new docs.
- Rank by Impact, highest first.

Save your output to perf-audit/findings/NAME.md where NAME is your model (for example gemini, composer, claude). If you cannot write files, return the list and it will be saved there.
