# Onboarding — unresolved issues

These are the immediate issues with the current onboarding flow that need to be fixed to reach the PMF vision, identified after reviewing reference implementations (like Rize). 

## What's broken

1. **AI doesn't work out of the box.** Daylens pitches itself as an AI-powered tool, but onboarding never asks you to configure an AI provider or paste an API key. A new user lands on the AI tab, asks a question, and hits a generic `COULDN'T COMPLETE THAT` error because no provider is connected.
2. **The AI chat tab assumes you already have data.** When a new user clicks the AI tab with an empty database, the suggested prompts are things like "What did I work on today?". It should immediately prompt them to set up AI, and the default suggestions should be onboarding-focused (e.g., "Introduce me to how Daylens works").
3. **We capture zero intent.** We don't ask the user why they downloaded the app or what they want to achieve (e.g., track deep work, invoice clients, understand habits). We just drop them on the timeline and expect them to figure it out. The app isn't customized to their goals.
4. **The app feels empty on day one.** We don't sync external context like their calendar or tasks during setup. Unlike reference apps that pull in meetings and Linear tasks immediately, Daylens drops the user onto a blank timeline.

## How it should work

- **Capture AI configuration early:** Onboarding must include a clear step to configure the AI provider and API key so the AI tab is functional from minute one.
- **Context-aware AI defaults:** If the database is empty, the AI tab should suggest queries that help the user learn the app, not queries that require historical data.
- **Intent capture:** Ask the user "How can Daylens help you?" during setup, and use that to tailor the default views and recaps.
- **Connect external integrations:** Allow the user to connect their calendar or task manager during onboarding so the timeline is populated and useful immediately.
