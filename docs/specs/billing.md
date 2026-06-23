# Billing & AI access — build spec

## 1. What this is

Daylens needs an AI provider to do its best work — the recaps, the chat, the wraps. Today
the only way to get one is to paste an API key, and that's a wall most people won't climb.
They don't know which model is good, they don't have a key, and they bounce. This spec is how
a normal person gets the full Daylens without ever touching an API key — while the technical
ones who *want* their own key still can.

There are three ways to power the AI, and a person moves down the ladder naturally:

1. **Free credit** — every new user gets **$5 of AI on us**. No key, no card, nothing to set
   up. They just use Daylens and it works. This is the on-ramp; its whole job is to get them
   to the magic moment before money is ever mentioned.
2. **Subscription** — when the free credit runs out, they subscribe and we keep handling the
   AI for them (we cover the provider cost). Flat price, no key, no thinking about models.
3. **Bring your own key** — at any point, a technical user can paste their own provider key and
   pay the provider directly instead. This bypasses the credit and the subscription entirely.

## 2. How the AI actually gets called

This is the part that matters, because it touches Daylens's core promise — *nothing leaves
your machine unless you ask.*

- **With your own key**, an AI call goes **straight from your machine to the provider**
  (Anthropic, OpenAI, Google), exactly as it does today. Daylens never sees it.
- **On free credit or a subscription**, the call routes **through the Daylens proxy** — our
  server, our provider keys — and then to the provider. We meter it and bill it.

Either way, the rule is the same and it's the honest privacy story: **your activity always
lives on your machine. When you ask a question, only the handful of resolved facts needed for
that one answer leave — never your whole history, never the raw capture.** The resolver-first
design (`ai.md` §4) is what makes this safe: the model is only ever handed the small fact set
for the question, so "what leaves" is the same tiny payload whether it goes direct or through
our proxy. We say this plainly in the UI; we never imply the proxy sees more than it does.

The proxy adds nothing to the payload beyond what the provider needs. It does not store the
prompts or the answers beyond what's required to meter usage, and that retention is stated in
plain language where the user signs up.

## 3. The free credit

- Every new user starts with **$5 of AI credit**, granted on first run, no card required.
- A small, honest meter shows what's left — not a nag, just a quiet "$3.40 of AI left" the
  user can find when they look. Never a countdown that pressures them mid-thought.
- Credit is consumed by real metered usage (the actual provider cost of each call), not by a
  made-up token count. When it's gone, AI features pause and the user is shown the one clear
  choice: subscribe, or add your own key. Capture and the local views keep working without AI
  (same as the no-credits rule, `ai.md` §5) — losing AI never breaks tracking.
- One free grant per user. The system has to resist the obvious abuse (one person farming many
  free grants), but that's a backend concern, not a user-facing one.

## 4. The subscription

- A flat recurring price. While subscribed, Daylens handles the AI through the proxy and the
  user never thinks about keys, models, or per-call cost.
- Subscribing and managing the plan lives in **Settings → Billing** (the redesigned, sectioned
  Settings — see §6). Upgrade, see the renewal date, update payment, cancel — all there, all
  plain.
- A subscriber who cancels keeps Daylens; the AI just falls back to "no credit" (subscribe
  again, or add a key). Their data is theirs and never held hostage.
- Sensible guardrails so a single subscription can't be abused as unlimited industrial AI — a
  fair-use ceiling, stated honestly, that a real person will never hit.

## 5. Bring your own key

- Unchanged from today in spirit: paste a provider key in Settings, pick a model, and every AI
  surface uses it (`settings.md` §3, `ai.md` §5). The call goes straight to the provider.
- A user with their own key is **not** charged by us and **not** drawing down credit — they're
  paying the provider directly. The UI makes which mode they're in obvious.
- Switching modes is clean: add a key and you're on your key; remove it and you fall back to
  credit or subscription.

## 6. Where it lives — the Settings redesign

Billing is the reason to finally redesign Settings into the clean, sectioned layout we want
(the bar is the Claude settings in the reference screenshots: a left rail of sections —
General, Account, Privacy, **Billing**, Usage, and so on — each a focused page, not one long
scroll). Billing and Usage are new sections:

- **Billing** — your plan (free / subscribed / own-key), the renewal/payment details when
  subscribed, and the upgrade path when on free credit.
- **Usage** — the honest meter: credit left, or this period's usage on a subscription. Plain
  numbers, no dark patterns.

This redesign is design work — get reference screenshots and agree the look before building it
(`AGENTS.md` "Design work"). The existing `settings.md` invariants still hold, as does the
round-2 visual direction in `settings.md` §10: Billing and Usage render in the same calm,
grouped, plain-number Claude style as every other section — current mode flagged honestly,
future modes clearly "arriving", no dark patterns.

## 7. Invariants (rules this must always obey)

1. A new user gets full AI on $5 of free credit with no key and no card.
2. With your own key, AI calls go straight to the provider; on credit or subscription, they go
   through the Daylens proxy. The user can always tell which mode they're in.
3. Whatever the mode, only the resolved facts for a single answer ever leave the machine —
   never the whole history, never raw capture.
4. The proxy stores no more than it needs to meter usage, and that retention is stated plainly
   at sign-up.
5. Losing AI (credit exhausted, no subscription, no key) never breaks capture or the local
   views — it shows one clear "subscribe or add a key" message and nothing fake.
6. Credit is metered on real provider cost, shown honestly, granted once per user.
7. Cancelling a subscription never holds the user's data hostage.
8. Billing and Usage live in the redesigned, sectioned Settings; no dark patterns, no pressure
   meters.
