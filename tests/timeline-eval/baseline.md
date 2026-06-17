# Daylens Timeline Evaluation

Command: `npm run timeline:eval`

Fixtures: 7
Overall score: segmentation 21/21 | labels 21/21 | intent 17/17 | wraps 5/5

This report compares editable offline fixtures against the current Daylens timeline, intent, and deterministic wrap logic.

## Coding day (coding-day)
A mostly continuous implementation morning with a short Slack interruption, one meeting, and a later wrap-polish pass.

Score: segmentation 3/3 | labels 3/3 | intent 3/3 | wraps 1/1

| Expected episode | Actual primary block | Result | Notes |
| --- | --- | --- | --- |
| implementation 09:00-11:10 "Timeline eval harness implementation" | 09:00-11:10 timeline-eval/run.ts (development, execution on timeline-eval/run.ts, apps: Cursor, Google Chrome, Warp) ⟦day-start → meeting-start⟧ | pass | ok |
| engineering-sync 11:10-11:50 "Engineering sync" | 11:10-11:50 Meeting (meetings, coordination, apps: Google Chrome) ⟦meeting-start → meeting-end⟧ | pass | ok |
| wrap-polish 12:10-12:45 "Wrapped narrative polish" | 12:10-12:45 Wrappednarrative (development, execution on Wrappednarrative, apps: Cursor) ⟦meeting-end → day-end⟧ | pass | ok |

Actual blocks:
- 09:00-11:10 timeline-eval/run.ts (development, execution on timeline-eval/run.ts, apps: Cursor, Google Chrome, Warp) ⟦day-start → meeting-start⟧; active 2h 10m pages: Fix timeline segmentation
- 11:10-11:50 Meeting (meetings, coordination, apps: Google Chrome) ⟦meeting-start → meeting-end⟧; active 40m
- 12:10-12:45 Wrappednarrative (development, execution on Wrappednarrative, apps: Cursor) ⟦meeting-end → day-end⟧; active 35m

Wrap check: quality full; dominant development; top app Cursor; top domain github.com; unsupported claims none
Review spine: mattered [timeline-eval/run.ts | Wrappednarrative]; needs review 1; carryover [Wrappednarrative (open-thread)]

Issues:
- none

## Pure leisure day (leisure-day)
A rest day: YouTube, Netflix, and some X scrolling, no work at all. Must read as leisure end-to-end — no work episodes, no focus scoring, no work intent, no raw video titles as labels.

Score: segmentation 2/2 | labels 2/2 | intent 0/0 | wraps 0/0

| Expected episode | Actual primary block | Result | Notes |
| --- | --- | --- | --- |
| watching-am 10:00-13:00 "Watching" | 10:00-13:00 Watching Netflix & YouTube (entertainment, ambient, apps: Safari) ⟦day-start → idle-gap⟧ | pass | ok |
| scrolling 14:00-15:15 "On X" | 14:00-15:15 On X (social, ambient, apps: Safari) ⟦idle-gap → day-end⟧ | pass | ok |

Actual blocks:
- 10:00-13:00 Watching Netflix & YouTube (entertainment, ambient, apps: Safari) ⟦day-start → idle-gap⟧; active 3h pages: The Comedy Lineup | Stranger Things
- 14:00-15:15 On X (social, ambient, apps: Safari) ⟦idle-gap → day-end⟧; active 1h 15m pages: X (Twitter)

Wrap check: quality full; dominant entertainment; top app Safari; top domain netflix.com; unsupported claims none
Review spine: mattered [none]; needs review 0; carryover [none]

Issues:
- none

## Meeting-heavy day (meeting-heavy-day)
Several meetings with short coordination and note-taking blocks between them.

Score: segmentation 6/6 | labels 6/6 | intent 6/6 | wraps 1/1

| Expected episode | Actual primary block | Result | Notes |
| --- | --- | --- | --- |
| design-critique 09:00-09:35 "Design critique" | 09:00-09:35 Design critique (meetings, coordination on Design critique, apps: Zoom) ⟦day-start → meeting-end⟧ | pass | ok |
| critique-followup 09:35-09:50 "Design critique follow-up" | 09:35-09:50 Design critique follow-up (communication, communication on Design critique follow-up, apps: Slack) ⟦meeting-end → meeting-start⟧ | pass | ok |
| product-planning 10:00-10:50 "Product planning" | 10:00-10:50 Meeting (meetings, coordination, apps: Google Chrome) ⟦meeting-start → meeting-end⟧ | pass | ok |
| roadmap-board 10:50-11:05 "Roadmap board" | 10:50-11:05 Roadmap board (productivity, coordination on Roadmap board, apps: Google Chrome) ⟦meeting-end → meeting-start⟧ | pass | ok |
| customer-interview 11:15-11:50 "Customer interview" | 11:15-11:50 Customer interview (meetings, coordination on Customer interview, apps: Microsoft Teams) ⟦meeting-start → meeting-end⟧ | pass | ok |
| interview-notes 12:00-12:25 "Customer interview notes" | 12:00-12:25 Customer interview notes (writing, execution on Customer interview notes, apps: Google Chrome) ⟦meeting-end → day-end⟧ | pass | ok |

Actual blocks:
- 09:00-09:35 Design critique (meetings, coordination on Design critique, apps: Zoom) ⟦day-start → meeting-end⟧; active 35m
- 09:35-09:50 Design critique follow-up (communication, communication on Design critique follow-up, apps: Slack) ⟦meeting-end → meeting-start⟧; active 15m
- 10:00-10:50 Meeting (meetings, coordination, apps: Google Chrome) ⟦meeting-start → meeting-end⟧; active 50m
- 10:50-11:05 Roadmap board (productivity, coordination on Roadmap board, apps: Google Chrome) ⟦meeting-end → meeting-start⟧; active 15m pages: Roadmap board
- 11:15-11:50 Customer interview (meetings, coordination on Customer interview, apps: Microsoft Teams) ⟦meeting-start → meeting-end⟧; active 35m
- 12:00-12:25 Customer interview notes (writing, execution on Customer interview notes, apps: Google Chrome) ⟦meeting-end → day-end⟧; active 25m pages: Customer interview notes

Wrap check: quality full; dominant meetings; top app Google Chrome; top domain docs.google.com; unsupported claims none
Review spine: mattered [Design critique | Customer interview | Design critique follow-up]; needs review 3; carryover [Customer interview notes (open-thread)]

Issues:
- none

## Mixed browser/AI day (mixed-browser-ai-day)
AI planning, issue research, implementation, AI review, browser lookup, and resumed implementation on one harness task.

Score: segmentation 1/1 | labels 1/1 | intent 1/1 | wraps 1/1

| Expected episode | Actual primary block | Result | Notes |
| --- | --- | --- | --- |
| ai-assisted-implementation 09:00-11:20 "AI-assisted timeline eval implementation" | 09:00-11:20 Timelineeval (development, execution on Timelineeval, apps: Cursor, Google Chrome, ChatGPT) ⟦day-start → day-end⟧ | pass | ok |

Actual blocks:
- 09:00-11:20 Timelineeval (development, execution on Timelineeval, apps: Cursor, Google Chrome, ChatGPT) ⟦day-start → day-end⟧; active 2h 20m pages: Daylens timeline eval ideas | Timeline segmentation issue #128

Wrap check: quality full; dominant development; top app Cursor; top domain chatgpt.com; unsupported claims none
Review spine: mattered [Timelineeval]; needs review 0; carryover [Timelineeval (open-thread)]

Issues:
- none

## Mixed work + leisure day (mixed-work-leisure-day)
The 2026-06-03 worked example: under an hour of coding on a malaria notebook, then an afternoon of YouTube/Netflix. Coding must be its own work episode, never absorbed into the video block; the watching episodes are leisure, named by activity, and carry no work intent.

Score: segmentation 3/3 | labels 3/3 | intent 1/1 | wraps 0/0

| Expected episode | Actual primary block | Result | Notes |
| --- | --- | --- | --- |
| coding 08:07-08:59 "malaria notebook" | 08:07-08:59 ResNet50 Malaria notebook (development, execution on ResNet50 Malaria notebook, apps: Ghostty, Codex) ⟦day-start → kind-shift⟧ | pass | ok |
| watching-morning 09:00-12:00 "Watching YouTube & Netflix" | 09:00-12:00 Watching Netflix & YouTube (entertainment, ambient, apps: Safari) ⟦kind-shift → idle-gap⟧ | pass | ok |
| watching-afternoon 13:00-15:00 "Watching YouTube" | 13:00-15:00 Watching YouTube (entertainment, ambient, apps: Safari) ⟦idle-gap → day-end⟧ | pass | ok |

Actual blocks:
- 08:07-08:59 ResNet50 Malaria notebook (development, execution on ResNet50 Malaria notebook, apps: Ghostty, Codex) ⟦day-start → kind-shift⟧; active 52m
- 09:00-12:00 Watching Netflix & YouTube (entertainment, ambient, apps: Safari) ⟦kind-shift → idle-gap⟧; active 3h pages: I spent $200 to try Opus 4.8, was it worth it? | Divided States of America Part 1
- 13:00-15:00 Watching YouTube (entertainment, ambient, apps: Safari) ⟦idle-gap → day-end⟧; active 2h pages: Jubilee

Wrap check: quality full; dominant entertainment; top app Safari; top domain youtube.com; unsupported claims none
Review spine: mattered [ResNet50 Malaria notebook]; needs review 0; carryover [ResNet50 Malaria notebook (open-thread)]

Issues:
- none

## Research day (research-day)
Competitive research across several sources, followed by synthesis in notes and a second evidence pass.

Score: segmentation 3/3 | labels 3/3 | intent 3/3 | wraps 1/1

| Expected episode | Actual primary block | Result | Notes |
| --- | --- | --- | --- |
| source-scan 08:50-10:15 "Time tracking competitive research" | 08:50-10:15 Time tracking competitive research (research, research on Time tracking competitive research, apps: Google Chrome, ChatGPT) ⟦day-start → category-shift+research-to-execution⟧ | pass | ok |
| matrix-synthesis 10:15-10:45 "Competitive research matrix" | 10:15-10:45 Time tracking competitive matrix (writing, execution on Time tracking competitive matrix, apps: Notion) ⟦category-shift+research-to-execution → category-shift+idle-gap⟧ | pass | ok |
| second-pass-notes 11:00-12:05 "ActivityWatch and notes synthesis" | 11:00-12:05 ActivityWatch documentation (research, research on Competitive research notes, apps: Google Chrome) ⟦category-shift+idle-gap → day-end⟧ | pass | ok |

Actual blocks:
- 08:50-10:15 Time tracking competitive research (research, research on Time tracking competitive research, apps: Google Chrome, ChatGPT) ⟦day-start → category-shift+research-to-execution⟧; active 1h 25m pages: Rize AI Time Tracking | Toggl Track Auto-tracker
- 10:15-10:45 Time tracking competitive matrix (writing, execution on Time tracking competitive matrix, apps: Notion) ⟦category-shift+research-to-execution → category-shift+idle-gap⟧; active 30m
- 11:00-12:05 ActivityWatch documentation (research, research on Competitive research notes, apps: Google Chrome) ⟦category-shift+idle-gap → day-end⟧; active 1h 5m pages: ActivityWatch documentation | Competitive research notes

Wrap check: quality full; dominant research; top app Google Chrome; top domain activitywatch.net; unsupported claims none
Review spine: mattered [Time tracking competitive research | Competitive research notes | Time tracking competitive matrix]; needs review 0; carryover [Competitive research notes (open-thread)]

Issues:
- none

## Scattered admin day (scattered-admin-day)
Short email, calendar, Slack, password, checklist, issue-triage, social detour, and budget tasks.

Score: segmentation 3/3 | labels 3/3 | intent 3/3 | wraps 1/1

| Expected episode | Actual primary block | Result | Notes |
| --- | --- | --- | --- |
| admin-triage 09:00-10:26 "Admin triage" | 09:00-10:26 Weekly checklist (productivity, coordination on Expense receipts, apps: Google Chrome, Notion, 1Password) ⟦day-start → kind-shift⟧ | pass | ok |
| social-detour 10:26-10:34 "X detour" | 10:26-10:34 On X (social, ambient, apps: Google Chrome) ⟦kind-shift → kind-shift⟧ | pass | ok |
| budget-tracker 10:34-10:48 "Budget tracker" | 10:34-10:48 Budget tracker (productivity, coordination on Budget tracker, apps: Google Chrome) ⟦kind-shift → day-end⟧ | pass | ok |

Actual blocks:
- 09:00-10:26 Weekly checklist (productivity, coordination on Expense receipts, apps: Google Chrome, Notion, 1Password) ⟦day-start → kind-shift⟧; active 1h 26m pages: Calendar | Expense receipts
- 10:26-10:34 On X (social, ambient, apps: Google Chrome) ⟦kind-shift → kind-shift⟧; active 8m pages: X (Twitter)
- 10:34-10:48 Budget tracker (productivity, coordination on Budget tracker, apps: Google Chrome) ⟦kind-shift → day-end⟧; active 14m pages: Budget tracker

Wrap check: quality full; dominant productivity; top app Google Chrome; top domain mail.google.com; unsupported claims none
Review spine: mattered [Expense receipts]; needs review 1; carryover [Budget tracker (open-thread)]

Issues:
- none

