# Identified Issues (Onboarding, AI, and UI)

These are the immediate issues identified from the Rize onboarding analysis and a review of the current UI state.

## 1. AI and Error Handling
- **AI Missing API Key Error:** The AI feature works, but when a user tries to use it without an API key configured, the app throws a generic `COULDN'T COMPLETE THAT` error. It must show a proper, actionable error message directing the user to add their API key in Settings.
- **AI Tab defaults are wrong for new users:** When the database is empty, the AI tab suggests queries that require historical data (e.g., "What did I work on today?"). It should immediately prompt them to set up AI, and the default suggestions should be onboarding-focused (e.g., "Introduce me to how Daylens works").

## 2. Onboarding & Intent
- **No Intent Capture:** We don't ask the user why they downloaded the app or what they want to achieve (e.g., track deep work, invoice clients, understand habits). The app drops them in without customizing the experience to their goals.
- **No integrations during setup:** We don't sync external context like their calendar or tasks during setup. Unlike reference apps that pull in meetings and Linear tasks immediately, Daylens leaves the timeline completely empty on day one.

## 3. Apps View UI Issues
- **Ugly URL parameters displayed:** When viewing web activity (e.g., Microsoft Edge), the "What you did there" section shows raw, unreadable URL-encoded strings (like `9917state=%7B%successPath...`) instead of clean, readable page titles.
- **Repetitive block summaries:** The "What you did there" section repeats the exact same generic text (e.g., "Running Daylens Locally") for every single block instead of generating a unique, descriptive summary of what actually happened during that specific session.
- **Empty state rendering bug:** Selecting an app in the left sidebar (like Rize) sometimes results in a broken UI where the right pane remains blank and just says "Select an app", failing to load the app's actual activity data.

## 4. Timeline View
- **Useless default block names:** Before a day is fully analyzed, blocks are simply titled "Active now" with no summary. These placeholders are unhelpful. The system should either provide a more descriptive default title or ensure analysis happens fast enough that users aren't left looking at generic placeholders.
