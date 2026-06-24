# Identified Issues (Tested on Windows)

These are the immediate issues identified from the Rize onboarding analysis and a review of the current UI state on Windows.

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

## 4. Timeline View Bugs
- **Useless default block names:** Before a day is fully analyzed, blocks are simply titled "Active now" with no summary. These placeholders are unhelpful. The system should either provide a more descriptive default title or ensure analysis happens fast enough that users aren't left looking at generic placeholders.
- **Block details auto-closing:** When clicking on an active time block to view its details, the block abruptly auto-closes after about 2 seconds, kicking the user back to the overall daily summary.
- **System noise tracked as work:** The timeline (and weekly view) is tracking system noise and naming blocks after it, such as a 1h 8m block named "New notification" or tracking "Windows Default Lock Screen". This violates the core invariant that system noise should be invisible and blocks shouldn't be named after window titles.

## 5. UI and Asset Bugs
- **Missing or incorrect icons:** Many app icons are failing to load or are assigned incorrectly. System processes (like `Vmmem Wsl`, `Memory Compression`) show generic placeholder letters, and some web pages/apps are inheriting incorrect icons (e.g., "Widget" or "Getting Started" inheriting the "Rize" icon).
- **PDF Report duplicate date:** The generated PDF report has a layout bug where the date is printed twice.

---

## Proposed Daylens Onboarding Flow
Daylens currently uses an onboarding technique that is very concise and almost non-existent. It should instead act as an engine for capturing user intent and integrating external data before the user ever sees the dashboard. A screen-by-screen blueprint:

- **Name capture:** Start immediately with identity ("What's your name?") on a clean, single-input card.
- **Personalized welcome:** Greet the user with their name and use a dynamic typing effect to explain exactly what Daylens is about to do for them, building anticipation.
- **Workspace setup:** Build a profile of the user's environment by asking for company name, size, job title, and whether they work solo or on a team.
- **Intent capture (Crucial):** Ask "How can Daylens help you?" Let the user click intent chips (e.g., Track billable work, Improve focus) which auto-fill into a text box, capturing exactly *why* the user downloaded the app.
- **Time & AI settings:** Collect basic utility preferences (12h/24h, Timezone) and immediately prompt for an AI API key so the assistant works on day one.
- **Integrations introduction:** Introduce the ecosystem (Google Calendar, Outlook, ClickUp, Linear).
- **Meeting detection:** Walk the user through connecting their calendar specifically to detect meetings, proving the connection worked with a clear success state.
- **Task workspace sync:** Deep integration flow that connects task trackers (like Linear), asks which workspace to sync, and starts pulling in tasks immediately.
- **Team invites:** Use the momentum of setup to ask for team invites.
- **Recommendation synthesis:** Play back the user's intent ("You're set up to track projects...") and reveal the specific workspace modules and productivity rules it has enabled based on their answers.
