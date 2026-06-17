> ⚠️ **SUPERSEDED — council process artifact (Round 1/2). Do NOT use for implementation.**
> The canonical, assembled plan is [`../DAYLENS-V2-PLAN.md`](../DAYLENS-V2-PLAN.md). Kept for provenance only.

# Daylens v2 Council Scorecard — gemini

## PMF Surfaces

### 1. Capture / Tracking
- **Claude:** 5. Phenomenal detail on segmentation and evidence. Clearly defined the noise exclusion and duration accuracy fixes.
- **Codex:** 5. Proposed an explicit `DayFactBlock` contract. Great insight into block creation as a product contract.
- **Cursor:** 4. Solid, screenshot-backed analysis.
- **Gemini:** 4. Good analysis with a focus on raising the distraction threshold.
- **Best plan:** **Codex** (The `DayFactBlock` contract makes the fix extremely implementable).

### 2. Timeline
- **Claude:** 5. Great breakdown of day vs week issues (legend, main mode, edits).
- **Codex:** 5. Emphasized a single payload contract and keeping editing behind "Not right?".
- **Cursor:** 4. Concise and accurate.
- **Gemini:** 4. Mentioned the Gemini quota failure vs Claude settings. 
- **Best plan:** **Claude** (Most comprehensive breakdown of the timeline sub-features).

### 3. Apps View
- **Claude:** 5. Excellent spot on app naming vs category naming across periods, and domain misattribution.
- **Codex:** 5. Strong recommendation to separate app identity from inferred label.
- **Cursor:** 4. Good fix suggestions for list row model.
- **Gemini:** 4. Good focus on deduplication and deletion.
- **Best plan:** **Claude**

### 4. AI Chat / Q&A
- **Claude:** 5. Spotted the tool plumbing issue for "today" vs "week".
- **Codex:** 5. The "resolver-first" architecture is the best architectural fix proposed.
- **Cursor:** 4. Good state persistence fixes.
- **Gemini:** 4. Mentioned React Context for state persistence.
- **Best plan:** **Codex** (Resolver-first architecture guarantees grounding).

### 5. Memory (Work memory/patterns)
- **Claude:** 5. Good focus on confidence recalculation.
- **Codex:** 5. Framed it perfectly: Memory should be an attribution layer, not a generic pattern list.
- **Cursor:** 4. Solid.
- **Gemini:** 4. Good DB aggregation focus.
- **Best plan:** **Codex**

### 6. Morning Brief
- **Claude:** 5. Marked unverified in UI, correctly derived Should from PMF.
- **Codex:** 4. Marked unverified.
- **Cursor:** 5. Verified via code that the UI is still a carousel using legacy heuristics. Great investigative work.
- **Gemini:** 4. Good fix snippet.
- **Best plan:** **Cursor** (Proved the gap via codebase investigation when UI screenshots were missing).

### 7. Evening Wrap
- **Claude:** 5. Detailed 5-card layout.
- **Codex:** 5. Emphasized no lecture on a leisure day.
- **Cursor:** 5. Solid UI rewrite plan.
- **Gemini:** 5. Good card breakdown.
- **Best plan:** **Claude** (Most detailed card-by-card breakdown).

### 8. Wraps (Daily/weekly/monthly/annual)
- **Claude:** 5. Correctly deferred monthly/annual.
- **Codex:** 5. Emphasized using frozen daily fact snapshots for weekly/monthly.
- **Cursor:** 4. Solid.
- **Gemini:** 4. Solid.
- **Best plan:** **Codex** (Frozen snapshots prevent retroactive data shifts).

### 9. Notifications
- **Claude:** 4. Unverified.
- **Codex:** 4. Unverified.
- **Cursor:** 5. Detailed fix for `dailySummaryNotifier.ts` copy order.
- **Gemini:** 4. Good snippet.
- **Best plan:** **Cursor**

### 10. Settings
- **Claude:** 5. Centralized provider resolution.
- **Codex:** 5. Operational Settings: any change invalidates/recomputes downstream surfaces.
- **Cursor:** 4. Solid.
- **Gemini:** 4. Solid.
- **Best plan:** **Codex** (The invalidation requirement is critical for trust).

### 11. Onboarding
- **Claude:** 4. 
- **Codex:** 5. Clear focus on proving capture works as the first success state.
- **Cursor:** 4.
- **Gemini:** 3.
- **Best plan:** **Codex**

### 12. Trust
- **Claude:** 4.
- **Codex:** 5. Explicitly defined trust as a product surface (showing hidden/edited/low-confidence states).
- **Cursor:** 4.
- **Gemini:** 5. Proposed a brilliant `locked` database flag for user-edited blocks.
- **Best plan:** **Gemini** (The `locked` flag is the most foolproof way to guarantee trust in manual edits).

---

## Cross-cutting Sections

### 13. Problem Statement
- **Claude:** 5. Six incredibly sharp, evidence-backed points.
- **Codex:** 5. Framed the core issue perfectly: the data layer is broken, causing a chain reaction.
- **Cursor:** 4. Very concise.
- **Gemini:** 4. Good summary.
- **Best plan:** **Claude**

### 14. Build Sequence
- **Claude:** 5. 9 phases, strictly gated by trust.
- **Codex:** 5. 9 phases, excellent acceptance criteria.
- **Cursor:** 5. Added a brilliant "Phase 0" for a Dogfood harness using a seeded founder day/week.
- **Gemini:** 4. 5 phases, slightly less detailed.
- **Best plan:** **Cursor** (Phase 0 is essential for verifying autonomous work).

### 15. Testing
- **Claude:** 5. 12 automated invariants.
- **Codex:** 5. 16 extremely thorough external behavior tests.
- **Cursor:** 5. Clear table mapping tests to the screenshots they would have caught.
- **Gemini:** 4. 
- **Best plan:** **Codex** (Most comprehensive test suite).

---

## Drops and Gaps

- **Drops:** None of the plans made false claims of "works" without evidence. Claude and Cursor were exceptionally honest about marking things `UNVERIFIED`.
- **Gaps:** 
  - **Browser distinction:** No plan clearly delineated how `domain` attribution handles Chrome vs Safari vs Arc, especially if multiple browsers are used simultaneously.
  - **Offline/Local AI:** While plans noted the provider mismatch (Gemini vs Claude), they didn't deeply address local LLM fallback (like Ollama/MCP) when offline, which is critical for an "always-on" local memory.
