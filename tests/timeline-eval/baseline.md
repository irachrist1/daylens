# Daylens Timeline Evaluation

Command: `npm run timeline:eval`

Fixtures: 7
Overall score: segmentation 20/20 | labels 20/20 | intent 12/16 | wraps 7/7

This report compares editable offline fixtures against the current Daylens timeline, intent, and deterministic wrap logic.

## Coding day (coding-day)
A mostly continuous implementation morning with a short Slack interruption, one meeting, and a later wrap-polish pass.

Score: segmentation 3/3 | labels 3/3 | intent 2/3 | wraps 1/1

| Expected episode | Actual primary block | Result | Notes |
| --- | --- | --- | --- |
| implementation 09:00-11:10 "Timeline eval harness implementation" | 09:00-11:10 timeline-eval/run.ts (development, execution on timeline-eval/run.ts, apps: Cursor, Google Chrome, Warp) ⟦day-start → meeting-start⟧ | pass | ok |
| engineering-sync 11:10-11:50 "Engineering sync" | 11:10-11:50 Meeting (browsing, research, apps: Google Chrome) ⟦meeting-start → meeting-end⟧ | fail | category browsing; role research |
| wrap-polish 12:10-12:45 "Wrapped narrative polish" | 12:10-12:45 Wrappednarrative (development, execution on Wrappednarrative, apps: Cursor) ⟦meeting-end → day-end⟧ | pass | ok |

Actual blocks:
- 09:00-11:10 timeline-eval/run.ts (development, execution on timeline-eval/run.ts, apps: Cursor, Google Chrome, Warp) ⟦day-start → meeting-start⟧; active 2h 10m pages: Fix timeline segmentation
- 11:10-11:50 Meeting (browsing, research, apps: Google Chrome) ⟦meeting-start → meeting-end⟧; active 40m
- 12:10-12:45 Wrappednarrative (development, execution on Wrappednarrative, apps: Cursor) ⟦meeting-end → day-end⟧; active 35m

Wrap check: quality full; active 3h 25m (work 3h 25m / leisure 0m / personal 0m); leisure day false; unsupported claims none
Wrap facts: activities [Meeting 40m | Wrappednarrative 35m]; standout Coding 2h 10m; slices [Cursor | GitHub | Warp | Slack]; leisure [none]

Issues:
- wrong intent role engineering-sync: got research, expected coordination

## Pure leisure day (leisure-day)
A rest day: YouTube, Netflix, and some X scrolling, no work at all. Must read as leisure end-to-end — no work episodes, no focus scoring, no work intent, no raw video titles as labels.

Score: segmentation 2/2 | labels 2/2 | intent 0/0 | wraps 1/1

| Expected episode | Actual primary block | Result | Notes |
| --- | --- | --- | --- |
| watching-am 10:00-13:00 "Watching" | 10:00-13:00 Watching Netflix & YouTube (entertainment, ambient, apps: Safari) ⟦day-start → idle-gap⟧ | pass | ok |
| scrolling 14:00-15:15 "On X" | 14:00-15:15 On X (social, ambient, apps: Safari) ⟦idle-gap → day-end⟧ | pass | ok |

Actual blocks:
- 10:00-13:00 Watching Netflix & YouTube (entertainment, ambient, apps: Safari) ⟦day-start → idle-gap⟧; active 3h pages: Stranger Things | The Comedy Lineup
- 14:00-15:15 On X (social, ambient, apps: Safari) ⟦idle-gap → day-end⟧; active 1h 15m pages: X (Twitter)

Wrap check: quality full; active 4h 15m (work 0m / leisure 4h 15m / personal 0m); leisure day true; unsupported claims none
Wrap facts: activities [none]; standout none; slices [Netflix | YouTube | X]; leisure [Netflix | YouTube | X]

Issues:
- none

## Meeting-heavy day (meeting-heavy-day)
Several meetings with short coordination and note-taking blocks between them.

Score: segmentation 6/6 | labels 6/6 | intent 5/6 | wraps 1/1

| Expected episode | Actual primary block | Result | Notes |
| --- | --- | --- | --- |
| design-critique 09:00-09:35 "Design critique" | 09:00-09:35 Design critique (meetings, coordination on Design critique, apps: Zoom) ⟦day-start → meeting-end⟧ | pass | ok |
| critique-followup 09:35-09:50 "Design critique follow-up" | 09:35-09:50 Design critique follow-up (communication, communication on Design critique follow-up, apps: Slack) ⟦meeting-end → meeting-start⟧ | pass | ok |
| product-planning 10:00-10:50 "Product planning" | 10:00-10:50 Meeting (browsing, research, apps: Google Chrome) ⟦meeting-start → meeting-end⟧ | fail | category browsing; role research |
| roadmap-board 10:50-11:05 "Roadmap board" | 10:50-11:05 Roadmap board (productivity, coordination on Roadmap board, apps: Google Chrome) ⟦meeting-end → meeting-start⟧ | pass | ok |
| customer-interview 11:15-11:50 "Customer interview" | 11:15-11:50 Customer interview (meetings, coordination on Customer interview, apps: Microsoft Teams) ⟦meeting-start → meeting-end⟧ | pass | ok |
| interview-notes 12:00-12:25 "Customer interview notes" | 12:00-12:25 Customer interview notes (writing, execution on Customer interview notes, apps: Google Chrome) ⟦meeting-end → day-end⟧ | pass | ok |

Actual blocks:
- 09:00-09:35 Design critique (meetings, coordination on Design critique, apps: Zoom) ⟦day-start → meeting-end⟧; active 35m
- 09:35-09:50 Design critique follow-up (communication, communication on Design critique follow-up, apps: Slack) ⟦meeting-end → meeting-start⟧; active 15m
- 10:00-10:50 Meeting (browsing, research, apps: Google Chrome) ⟦meeting-start → meeting-end⟧; active 50m
- 10:50-11:05 Roadmap board (productivity, coordination on Roadmap board, apps: Google Chrome) ⟦meeting-end → meeting-start⟧; active 15m pages: Roadmap board
- 11:15-11:50 Customer interview (meetings, coordination on Customer interview, apps: Microsoft Teams) ⟦meeting-start → meeting-end⟧; active 35m
- 12:00-12:25 Customer interview notes (writing, execution on Customer interview notes, apps: Google Chrome) ⟦meeting-end → day-end⟧; active 25m pages: Customer interview notes

Wrap check: quality full; active 2h 55m (work 2h 55m / leisure 0m / personal 0m); leisure day false; unsupported claims none
Wrap facts: activities [Meeting 50m | Design critique 35m | Customer interview 35m | Customer interview notes 25m]; standout Meeting 50m; slices [Zoom | Microsoft Teams | Google Docs | Slack]; leisure [none]

Issues:
- wrong intent role product-planning: got research, expected coordination

## Mixed browser/AI day (mixed-browser-ai-day)
AI planning, issue research, implementation, AI review, browser lookup, and resumed implementation on one harness task.

Score: segmentation 1/1 | labels 1/1 | intent 1/1 | wraps 1/1

| Expected episode | Actual primary block | Result | Notes |
| --- | --- | --- | --- |
| ai-assisted-implementation 09:00-11:20 "AI-assisted timeline eval implementation" | 09:00-11:20 Timelineeval (development, execution on Timelineeval, apps: Cursor, Google Chrome, ChatGPT) ⟦day-start → day-end⟧ | pass | ok |

Actual blocks:
- 09:00-11:20 Timelineeval (development, execution on Timelineeval, apps: Cursor, Google Chrome, ChatGPT) ⟦day-start → day-end⟧; active 2h 20m pages: Daylens timeline eval ideas | Timeline segmentation issue #128

Wrap check: quality full; active 2h 20m (work 2h 20m / leisure 0m / personal 0m); leisure day false; unsupported claims none
Wrap facts: activities [Timelineeval 2h 20m]; standout Timelineeval 2h 20m; slices [Cursor | ChatGPT | Claude | ChatGPT]; leisure [none]

Issues:
- none

## Mixed work + leisure day (mixed-work-leisure-day)
The 2026-06-03 worked example: under an hour of coding on a malaria notebook, then an afternoon of YouTube/Netflix. Coding must be its own work episode, never absorbed into the video block; the watching episodes are leisure, named by activity, and carry no work intent.

Score: segmentation 3/3 | labels 3/3 | intent 1/1 | wraps 1/1

| Expected episode | Actual primary block | Result | Notes |
| --- | --- | --- | --- |
| coding 08:07-08:59 "malaria notebook" | 08:07-08:59 ResNet50 Malaria notebook (development, execution on ResNet50 Malaria notebook, apps: Ghostty, Codex) ⟦day-start → kind-shift⟧ | pass | ok |
| watching-morning 09:00-12:00 "Watching YouTube & Netflix" | 09:00-12:00 Watching Netflix & YouTube (entertainment, ambient, apps: Safari) ⟦kind-shift → idle-gap⟧ | pass | ok |
| watching-afternoon 13:00-15:00 "Watching YouTube" | 13:00-15:00 Watching YouTube (entertainment, ambient, apps: Safari) ⟦idle-gap → day-end⟧ | pass | ok |

Actual blocks:
- 08:07-08:59 ResNet50 Malaria notebook (development, execution on ResNet50 Malaria notebook, apps: Ghostty, Codex) ⟦day-start → kind-shift⟧; active 52m
- 09:00-12:00 Watching Netflix & YouTube (entertainment, ambient, apps: Safari) ⟦kind-shift → idle-gap⟧; active 3h pages: Divided States of America Part 1 | I spent $200 to try Opus 4.8, was it worth it?
- 13:00-15:00 Watching YouTube (entertainment, ambient, apps: Safari) ⟦idle-gap → day-end⟧; active 2h pages: Jubilee

Wrap check: quality full; active 5h 52m (work 52m / leisure 5h / personal 0m); leisure day true; unsupported claims none
Wrap facts: activities [ResNet50 Malaria notebook 52m]; standout ResNet50 Malaria notebook 52m; slices [YouTube | Netflix | Ghostty | Codex]; leisure [YouTube | Netflix]

Issues:
- none

## Research day (research-day)
Competitive research across several sources, followed by synthesis in notes and a second evidence pass.

Score: segmentation 3/3 | labels 3/3 | intent 2/3 | wraps 1/1

| Expected episode | Actual primary block | Result | Notes |
| --- | --- | --- | --- |
| source-scan 08:50-10:15 "Time tracking competitive research" | 08:50-10:15 Time tracking competitive research (browsing, research on Time tracking competitive research, apps: Google Chrome, ChatGPT) ⟦day-start → category-shift+research-to-execution⟧ | fail | category browsing |
| matrix-synthesis 10:15-10:45 "Competitive research matrix" | 10:15-10:45 Time tracking competitive matrix (writing, execution on Time tracking competitive matrix, apps: Notion) ⟦category-shift+research-to-execution → idle-gap⟧ | pass | ok |
| second-pass-notes 11:00-12:05 "ActivityWatch and notes synthesis" | 11:00-12:05 ActivityWatch documentation (writing, execution on ActivityWatch documentation, apps: Google Chrome) ⟦idle-gap → day-end⟧ | fail | category writing; role execution |

Actual blocks:
- 08:50-10:15 Time tracking competitive research (browsing, research on Time tracking competitive research, apps: Google Chrome, ChatGPT) ⟦day-start → category-shift+research-to-execution⟧; active 1h 25m pages: Toggl Track Auto-tracker | Rize AI Time Tracking
- 10:15-10:45 Time tracking competitive matrix (writing, execution on Time tracking competitive matrix, apps: Notion) ⟦category-shift+research-to-execution → idle-gap⟧; active 30m
- 11:00-12:05 ActivityWatch documentation (writing, execution on ActivityWatch documentation, apps: Google Chrome) ⟦idle-gap → day-end⟧; active 1h 5m pages: ActivityWatch documentation | Competitive research notes

Wrap check: quality full; active 3h (work 3h / leisure 0m / personal 0m); leisure day false; unsupported claims none
Wrap facts: activities [Time tracking competitive research 1h 25m | ActivityWatch documentation 1h 5m | Time tracking competitive matrix 30m]; standout Time tracking competitive research 1h 25m; slices [Activitywatch | Notion | Google Docs | ChatGPT]; leisure [none]

Issues:
- wrong intent role second-pass-notes: got execution, expected research

## Scattered admin day (scattered-admin-day)
Short email, calendar, Slack, password, checklist, issue-triage, social detour, and budget tasks.

Score: segmentation 2/2 | labels 2/2 | intent 1/2 | wraps 1/1

| Expected episode | Actual primary block | Result | Notes |
| --- | --- | --- | --- |
| admin-triage 09:00-10:26 "Admin triage" | 09:00-10:26 Weekly checklist (productivity, coordination on Expense receipts, apps: Google Chrome, Notion, 1Password) ⟦day-start → subject-change⟧ | pass | ok |
| budget-tracker 10:26-10:48 "Budget tracker" | 10:26-10:48 Budget tracker (writing, execution on Budget tracker, apps: Google Chrome) ⟦subject-change → day-end⟧ | fail | category writing; role execution |

Actual blocks:
- 09:00-10:26 Weekly checklist (productivity, coordination on Expense receipts, apps: Google Chrome, Notion, 1Password) ⟦day-start → subject-change⟧; active 1h 26m pages: Calendar | Expense receipts
- 10:26-10:48 Budget tracker (writing, execution on Budget tracker, apps: Google Chrome) ⟦subject-change → day-end⟧; active 22m pages: Budget tracker | X (Twitter)

Wrap check: quality full; active 1h 48m (work 1h 48m / leisure 0m / personal 0m); leisure day false; unsupported claims none
Wrap facts: activities [Expense receipts 1h 26m | Budget tracker 22m]; standout Expense receipts 1h 26m; slices [Gmail | Google Calendar | Notion | Google Docs]; leisure [none]

Issues:
- wrong intent role budget-tracker: got execution, expected coordination

