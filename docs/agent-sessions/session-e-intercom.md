# Session E — Intercom (Fin) integration in the Electron app

**Read `docs/full-audit-2026-07-07.md` and `docs/implementation-2026-07-07.md` first.**

> **Credential status (2026-07-07).** Only the **App ID `y4l8ype0`** is confirmed (it's public
> — it ships in the widget URL anyway). The **REST access token**, **OAuth client id/secret**,
> and **Identity Verification secret** are not yet in hand. That means: the Messenger + basic
> client-side identify are **buildable and testable now**; Identity Verification (`user_hash`)
> and any server-side REST attribute sync are **blocked** until the founder pastes those into
> `services/billing/.env`. Build the unblocked parts, stub the blocked parts behind a clear TODO.

---

## Operating doctrine (applies to this whole session)

**Model & effort.** Run as Fable 5 at **HIGH** reasoning effort. Not xhigh/max/ultra. Effort
is per-step thinking, not how long you can work.

**Model routing (defaults, not limits).** *Intelligence* = hardest problem handled
unsupervised; *taste* = UI/UX, code quality, API design, copy. **Fable 5 (you):** best
intelligence + taste; write all user-facing copy (the day-3 message, Settings labels)
yourself. **Opus 4.8:** high taste, cheaper reviewer. **GPT-5.5 via Codex:** high
intelligence, low taste, effectively free — use for bulk reads and running-app verification;
review its code before it lands. Cost is a tie-breaker only; intelligence > taste > cost.

**Shelling out to GPT-5.5 (Codex) — verified working here.** Reads/analysis:
`codex exec -m gpt-5.5 -s read-only "<self-contained prompt>"` — effort is a Codex config value,
not a CLI flag (no `--effort`). Simple, literal prompts; "nothing found" is valid. **No
computer-use skill is installed and `codex exec` can't drive a GUI** — launching the app and
opening the Messenger is a founder check, not something the agent can do.

**Sub-agents vs. workflows.** Fan out reads to sub-agents; workflow when staged. Prefix
5.5-driven work with `[5.5]`.

**Verification rule (non-negotiable).** Done = (1) code correct, (2) verified — the agent
headless-verifies the wiring **and** the founder launches the app and confirms the Messenger
opens from Settings → Help with the right properties and reaches Fin, (3) committed. You have no
computer-use tool, so the live check is the founder's. Green tests are not proof.

**When the ground contradicts the prompt.** Flag stale premises; never invent paths.

---

## Security architecture — decide this before writing code (grounded in the repo)

The repo injects the public PostHog key at build time (`vite.main.config.ts` →
`__POSTHOG_KEY__`) and has a real backend at `services/billing/` (`.env.example` present).
Follow that split:

- **Client (Electron renderer) — public only.** Load the Messenger with `app_id` (`y4l8ype0`),
  `user_id` (the existing device id from `src/main/services/analytics.ts` /
  `attribution.ts`), and non-sensitive attributes. The `app_id` may be injected via the same
  build-time `define` mechanism as the PostHog key.
- **Backend (`services/billing`) — secrets only.** The Identity Verification secret and the
  REST access token live **only** in `services/billing/.env`. Compute the `user_hash`
  (HMAC-SHA256 of `user_id` with the IV secret) **server-side** and return it to the client;
  make any REST attribute-sync calls from here. **Never** bundle the token or IV secret into
  the Electron client — anything in the bundle is extractable by users.
- **Before storing any secret:** confirm `.env` is gitignored (root `.gitignore` currently has
  **no** env entry — add one). Never commit real token/secret values, including into this
  prompt file. Placeholders only.

## Tasks

1. **Install the Messenger in the renderer.** Add the Intercom snippet to
   `src/renderer/index.html` (or load it programmatically from the renderer entry). Use
   `api_base: "https://api-iam.intercom.io"` and `app_id: "y4l8ype0"`.
   - **Electron gotchas — verify, don't assume it "just works":** the widget loads from
     `https://widget.intercom.io`; confirm the renderer's origin and any
     `webPreferences`/CSP allow loading it and connecting to `*.intercom.io`. The classic
     failure here is a silently blank Messenger — you must open the app and see the launcher
     actually appear, not just ship the snippet.
2. **Identify the user on launch.** Send `user_id` = device id, `email` = the connected account
   email if present, and properties: `platform, version, subscription_status,
   days_since_install, total_tracked_days`. For Identity Verification, pass `user_hash`
   fetched from the backend (stub with a TODO until the IV secret exists).
3. **Discoverable launcher in Settings.** In addition to the default bottom-right launcher, add
   a "Chat with us / Get help" action in the existing Settings **Help/support** area
   (~`Settings.tsx:659`) that calls `Intercom('show')`. Founder's acceptance test is that the
   Messenger is reachable from Settings → Help.
4. **Tours / proactive messages (know the boundary).** Intercom Tours and proactive messages
   are **authored in the Intercom dashboard**, not in code — code's job is to fire the signals
   the dashboard targets. So:
   - Fire a custom event (e.g. `onboarding_completed`) when onboarding finishes, so a 3-step
     tooltip tour pointing at **Timeline, Apps, and AI Chat** can be triggered from it.
   - Ensure `days_since_install` / `total_tracked_days` attributes are set so a **day-3**
     proactive message can target `days_since_install >= 3`. Draft the message copy yourself,
     warm and specific — something like: *"How's Daylens working for you so far — and what were
     you hoping it would help you with?"* (refine it; make it sound human).
   - Document in `docs/implementation-2026-07-07.md` exactly which dashboard tours/messages the
     founder still needs to author, and against which event/attribute.

## Scope guards (from the founder)

- **Do NOT add Intercom to `apps/web`.** That companion app is a broken draft and is being
  cleaned up separately. Leave it alone.
- **The landing-page Fin is a SEPARATE surface** (a marketing visitor asking Fin how Daylens
  works). Before touching it, **confirm which directory the live landing page actually is** —
  `apps/web` vs. a separate site is currently ambiguous in the repo. Ask the founder / inspect
  before installing anything there. Do not guess.

## Verify & hand off, then commit

**Agent verification (headless):** confirm the Messenger snippet is wired with the right
`app_id`/`api_base`; the identify payload assembles the correct properties (cite the code); the
`user_hash` is computed server-side in `services/billing` (or clearly stubbed with a TODO until
the IV secret lands); and **no secret is bundled into the client or committed**. Type-check /
build.

**Founder handoff (the real check — required before "done"):** you have no computer-use tool, so
the founder launches the app, opens **Settings → Help**, confirms the Messenger appears, opens
it, checks the user properties, and sends a message that reaches Fin. Give them those exact
steps.

Commit after headless verification; note the live Messenger check and any credential/dashboard
blockers still open. Append three sentences to `docs/implementation-2026-07-07.md` summarizing
what shipped and what's blocked.
