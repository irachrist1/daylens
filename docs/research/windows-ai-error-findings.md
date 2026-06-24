# Findings — Windows Anthropic API limit misclassification

**Status:** Investigated · **Date:** 2026-06-23 · **Source:** Live console logs + raw Node socket execution check

This is the root-cause report behind the Anthropic Claude errors seen on Windows when sending chat messages. The symptom was a generic "Anthropic Claude couldn't complete that" (unknown error) despite the settings panel claiming a successful "CONNECTED" state.

The one-line version: **The API key is valid and connected, but the account has hit its monthly spending limit, and our error classifier is blind to it.**

---

## 1. The proof: what the API actually returned

By writing a standalone diagnostic script and calling the Anthropic SDK with the user's saved credentials, we captured the raw API response:

```json
{
  "status": 400,
  "type": "invalid_request_error",
  "error": {
    "type": "invalid_request_error",
    "message": "You have reached your specified API usage limits. You will regain access on 2026-07-01 at 00:00 UTC."
  }
}
```

Anthropic returned a **400 Bad Request** error with a message indicating the account hit its user-defined spending cap.

---

## 2. Why the app misdiagnosed it

Our error classification logic in `src/main/services/providerErrors.ts` checks for rate limits (429) and auth failures (401/403), but it fell through on this 400 error:

- **Not a 429:** Because it is returned as a 400 Bad Request, the rate-limit regex and `isRateLimitError()` check did not catch it.
- **Not standard credit exhaustion:** It doesn't contain the specific string `'credit balance'` or the type `'credit_balance_too_low'` (it uses `invalid_request_error` with a custom message instead).
- **Fell through to `unknown`:** The error was classified as `{ code: 'unknown' }`, producing the generic user message: *"Anthropic Claude couldn't complete that. Please try again."*

---

## 3. The fix

We will update the classifier in `src/main/services/providerErrors.ts` to explicitly capture Anthropic's usage limit message format and classify it as `quota_exhausted`. This will cleanly report:

> *"You've hit Anthropic's request limit for now. Add billing to that provider to raise it, switch providers in Settings → AI, or try again later."*
