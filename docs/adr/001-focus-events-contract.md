# 001 — Treat focus_events as a capture contract
Date: 2026-05-27
Status: accepted

`focus_events` is the raw replay log for future session and block projections, so helper output must be validated against a small explicit event contract before persistence instead of accepting arbitrary strings. We will keep the current v1 behavior, including the never-guess rule for browser failures, but make the TypeScript sink reject unknown event types, sources, confidence values, schema versions, and `confidence=unknown` rows that carry URL or page-title content; fresh v27 tables mirror those checks where SQLite can express them. We rejected leaving the contract in comments because projection code would have to rediscover producer semantics, and we rejected a broad repair migration now because existing databases may already have v27; runtime validation gives the contract immediately without weakening raw capture.
