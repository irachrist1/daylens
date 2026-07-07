# PostHog post-wizard report

The wizard audited the existing PostHog integration and completed the environment configuration. Daylens already ships a mature, privacy-first analytics layer built on `posthog-node` in the Electron main process — the wizard's role was to wire up the missing environment variables, align the build config to accept the standard `POSTHOG_PROJECT_TOKEN` name, document the existing event taxonomy, and create a monitoring dashboard.

**Files changed:**

| File | Change |
|---|---|
| `vite.main.config.ts` | Now reads `POSTHOG_PROJECT_TOKEN` first, then falls back to the existing `POSTHOG_KEY` — backward-compatible |
| `.env` _(created)_ | `POSTHOG_PROJECT_TOKEN` and `POSTHOG_HOST` set to the correct project values |

## Events documented

| Event name | Description | File |
|---|---|---|
| `app_launched` | Fired when the Electron app starts up | `src/main/index.ts` |
| `onboarding_completed` | Fired when the user finishes the onboarding flow | `src/main/services/onboarding.ts` |
| `activation_completed` | Key activation milestone: reconstructed timeline + onboarding done | `src/main/services/analytics.ts` |
| `tracking_permission_updated` | User grants or revokes screen-time tracking permission | `src/main/services/trackingPermissions.ts` |
| `ai_query_sent` | User sends a question or prompt to the AI assistant | `src/main/jobs/aiService.ts` |
| `ai_query_answered` | AI assistant returns a successful answer | `src/main/jobs/aiService.ts` |
| `ai_job_failed` | AI job fails after all retries | `src/main/services/aiOrchestration.ts` |
| `feature_adoption` | First engagement with timeline / apps / ai / export / notifications | `src/main/services/analytics.ts` |
| `weekly_active_user` | Once per calendar week on app open — WAU signal | `src/main/services/analytics.ts` |
| `retained_day_1` | User returns on or after day 1 since activation | `src/main/services/analytics.ts` |
| `retained_day_7` | User returns on or after day 7 since activation | `src/main/services/analytics.ts` |
| `update_available` | App update detected and ready to download | `src/main/services/updater.ts` |
| `update_downloaded` | Available update fully downloaded | `src/main/services/updater.ts` |
| `sync_link_completed` | Workspace sync link successfully established | `src/main/ipc/settings.handlers.ts` |
| `feedback_submitted` | User submits in-app feedback | `src/main/ipc/focus.handlers.ts` |

## Next steps

A dashboard and five insights have been created in PostHog to monitor user behavior as data starts flowing:

- **Dashboard:** [Analytics basics (wizard)](https://us.posthog.com/project/501413/dashboard/1809679)
- [Weekly Active Users](https://us.posthog.com/project/501413/insights/gDZrWSP6) — DAU by week, 90-day window
- [Activation Funnel](https://us.posthog.com/project/501413/insights/rIghaQrM) — `app_launched` → `onboarding_completed` → `activation_completed`
- [AI Query Volume](https://us.posthog.com/project/501413/insights/w1FiCUuk) — sent vs answered, daily, 30 days
- [Retention Milestones](https://us.posthog.com/project/501413/insights/t6MTN2ve) — cumulative Day 1 and Day 7 cohorts, 90 days
- [Feature Adoption](https://us.posthog.com/project/501413/insights/MSdKvubg) — first-touch `feature_adoption` events by week

## Verify before merging

- [ ] Run a full production build (`npm run make` or equivalent) and fix any lint or type errors introduced by the generated code.
- [ ] Run the test suite — call sites that were rewritten or instrumented may need updated mocks or fixtures.
- [ ] Add `POSTHOG_PROJECT_TOKEN` and `POSTHOG_HOST` to `.env.example` and any CI/CD environment configuration so collaborators and the build pipeline know what to set.
- [ ] Wire source-map upload (`posthog-cli sourcemap` or the Vite source-map plugin) into the release CI job so that production stack traces de-minify in PostHog error tracking.

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/integration-python/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.
