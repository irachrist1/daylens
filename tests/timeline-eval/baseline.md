# Daylens Timeline Evaluation

Command: `npm run timeline:eval`

Fixtures: 9
Overall score: segmentation 28/32 | labels 31/32 | intent 18/20 | wraps 5/5 | day 0/1 | week 0/1

This report compares editable offline fixtures against the current Daylens timeline, intent, and deterministic wrap logic.

## Phase 0 external-behavior checks

| Check | Witnesses | Result | Current-main defects |
| --- | ---: | --- | --- |
| 1. Dogfood real-week fixture | 3175 | fail | founder-real-jun16-week: kind: midday-machine-learning-pipeline is leisure, expected work; founder-real-jun16-week: forbidden label appears: Untitled block |
| 2. Segmentation scenario | 4 | fail | founder-real-jun16-week: morning-network-setup: overlaps 5 blocks; founder-real-jun16-week: morning-network-setup: boundary mismatch; founder-real-jun16-week: midday-machine-learning-pipeline: overlaps 7 blocks |
| 3. Duration invariant | 160 | fail | founder-real-jun16-week: one-duration total 419m != observed truth 361m ±15m |
| 4. Kind/tag invariant | 4 | fail | founder-real-jun16-week: midday-machine-learning-pipeline: displayed leisure, expected work |
| 5. Gap reasons | 6 | fail | phase0-contract-witnesses: 13:00:00-14:00:00: idle, expected paused; phase0-contract-witnesses: 15:00:00-16:00:00: idle, expected permission_limited; phase0-contract-witnesses: 19:00:00-20:00:00: idle, expected no_samples |
| 6. System-noise exclusion | 4 | fail | phase0-contract-witnesses: UserNotificationCenter survives into Apps summaries; phase0-contract-witnesses: Finder survives into Apps summaries |
| 7. Apps aggregation | 2184 | pass | none |
| 8. Week consistency | 16 | fail | founder-real-jun16-week: week chart 91484s != review source 114853s; founder-real-jun16-week: week chart 1525m != observed truth 1207m ±15m |

The strict founder-baseline command fails while any row above is red.

## Coding day (coding-day)
A mostly continuous implementation morning with a short Slack interruption, one meeting, and a later wrap-polish pass.

Score: segmentation 3/3 | labels 3/3 | intent 3/3 | wraps 1/1 | day 0/0 | week 0/0

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

## Founder real Jun 16 + current week (founder-real-jun16-week)
Sanitized real founder day/week export for the Phase 0 truth baseline. Timing, duration, category, and behavior-relevant public app/site identity are retained; personal content, paths, accounts, private hosts, and unrelated page titles are pseudonymized.
Expected-red baseline: this fixture should fail under `--strict` until the v2 truth packets fix the real-day defects.

Score: segmentation 0/4 | labels 3/4 | intent 1/3 | wraps 0/0 | day 0/1 | week 0/1
Phase 0: dogfood fail | segmentation fail | duration fail | kind-tag fail | apps pass | week-consistency fail

| Expected episode | Actual primary block | Result | Notes |
| --- | --- | --- | --- |
| morning-network-setup 08:03-10:07 "Starlink setup and testing" | 09:18-10:07 Building & Testing (development, execution on Starlink, apps: Ghostty, Safari, Dia) ⟦kind-shift → category-shift⟧ | fail | boundary 09:18-10:07; over-split into 5 blocks |
| midday-machine-learning-pipeline 11:10-13:11 "Machine learning pipeline class" | 11:22-11:46 On X & YouTube (social, ambient, apps: Safari) ⟦kind-shift → kind-shift⟧ | fail | boundary 11:22-11:46; over-split into 7 blocks; label "On X & YouTube"; kind leisure, expected work; role ambient; subject null |
| afternoon-starlink-debugging 14:55-16:47 "Starlink and NextDNS debugging" | 16:00-16:24 Nextdns (aiTools, research on Nextdns, apps: Codex, Safari) ⟦kind-shift → category-shift⟧ | fail | boundary 16:00-16:24; over-split into 14 blocks; role research |
| evening-watching 18:36-20:54 "Watching Netflix and YouTube" | 19:22-20:27 Watching Netflix & YouTube (entertainment, ambient, apps: Dia, Finder, Safari) ⟦idle-gap → kind-shift⟧ | fail | boundary 19:22-20:27; over-split into 6 blocks |

Actual blocks:
- 08:03-08:47 Building & Testing (development, execution on [redacted page on site-0010.example], apps: Ghostty, Safari, UniFi OS Server) ⟦day-start → kind-shift⟧; active 29m pages: [redacted page on site-0010.example] | [redacted page on site-0009.example]
- 08:47-08:47 Watching YouTube (entertainment, ambient, apps: Safari) ⟦kind-shift → kind-shift⟧; active 0m pages: [redacted page on youtube.com]
- 08:47-09:17 Starlink (development, execution on Starlink, apps: Ghostty, Finder, UniFi OS Server) ⟦kind-shift → kind-shift⟧; active 22m pages: Starlink | Starlink
- 09:17-09:18 Watching YouTube (entertainment, ambient, apps: Safari, UniFi OS Server) ⟦kind-shift → kind-shift⟧; active 1m pages: [redacted page on youtube.com]
- 09:18-10:07 Building & Testing (development, execution on Starlink, apps: Ghostty, Safari, Dia) ⟦kind-shift → category-shift⟧; active 30m pages: Starlink | Starlink
- 10:07-10:16 Untitled block (uncategorized, ambiguous, apps: UniFi OS Server) ⟦category-shift → kind-shift⟧; active 9m
- 10:17-10:29 Watching YouTube (entertainment, ambient, apps: Safari, Siri, System Settings) ⟦kind-shift → kind-shift⟧; active 13m pages: YouTube | YouTube
- 10:29-10:30 Communication (communication, communication, apps: Messages) ⟦kind-shift → kind-shift⟧; active 1m
- 10:30-10:35 Watching YouTube (entertainment, ambient, apps: Siri, Safari) ⟦kind-shift → kind-shift⟧; active 5m pages: YouTube
- 10:35-10:37 Development (development, execution, apps: Ghostty, Finder) ⟦kind-shift → kind-shift⟧; active 1m
- 10:37-10:50 Watching YouTube & X (entertainment, ambient, apps: Safari) ⟦kind-shift → kind-shift⟧; active 13m pages: YouTube | [redacted page on x.com]
- 10:50-10:51 Development (development, execution, apps: Ghostty) ⟦kind-shift → kind-shift⟧; active 0m
- 10:51-10:59 Watching YouTube (entertainment, ambient, apps: Safari) ⟦kind-shift → kind-shift⟧; active 8m pages: YouTube | YouTube
- 10:59-11:00 [redacted page on meet.google.com] (aiTools, coordination on [redacted page on meet.google.com], apps: Dia) ⟦kind-shift → kind-shift⟧; active 1m pages: [redacted page on meet.google.com] | [redacted page on account.example]
- 11:00-11:03 Watching YouTube (browsing, ambient, apps: Safari) ⟦kind-shift → kind-shift⟧; active 3m pages: [redacted page on site-0019.example] | [redacted page on site-0020.example]
- 11:03-11:05 Development (development, execution, apps: Ghostty, Granola) ⟦kind-shift → kind-shift⟧; active 2m pages: [redacted page on meet.google.com]
- 11:05-11:09 On X & YouTube (social, ambient, apps: Safari) ⟦kind-shift → kind-shift⟧; active 4m pages: [redacted page on x.com] | YouTube
- 11:09-11:10 Meetings (meetings, coordination, apps: Granola) ⟦kind-shift → kind-shift⟧; active 1m
- 11:10-11:10 Browsing (entertainment, ambient, apps: Music) ⟦kind-shift → kind-shift⟧; active 0m
- 11:10-11:22 [redacted page on chatgpt.com] (aiTools, research on [redacted page on chatgpt.com], apps: Dia) ⟦kind-shift → kind-shift⟧; active 11m pages: [redacted page on chatgpt.com] | ChatGPT
- 11:22-11:46 On X & YouTube (social, ambient, apps: Safari) ⟦kind-shift → kind-shift⟧; active 17m pages: [redacted page on x.com] | YouTube
- 11:46-12:03 Machine Learning Pipeline (aiTools, coordination on Machine Learning Pipeline, apps: Dia, Granola) ⟦kind-shift → meeting-start⟧; active 16m pages: Machine Learning Pipeline | [redacted page on account.example]
- 12:03-12:22 Meetings (meetings, coordination, apps: Granola) ⟦meeting-start → meeting-end⟧; active 7m
- 12:52-13:11 Machine Learning Pipeline (aiTools, coordination on Machine Learning Pipeline, apps: Dia, Granola) ⟦meeting-end → kind-shift⟧; active 8m pages: Machine Learning Pipeline | Google Meet
- 14:09-14:35 Watching YouTube & X (entertainment, ambient, apps: Dia, Safari, Siri) ⟦kind-shift → kind-shift⟧; active 26m pages: YouTube | YouTube
- 14:35-14:36 Development (development, execution, apps: Ghostty) ⟦kind-shift → kind-shift⟧; active 0m
- 14:36-14:38 Watching Netflix & YouTube (entertainment, ambient, apps: Safari, Dia, Finder) ⟦kind-shift → kind-shift⟧; active 2m pages: Netflix | YouTube
- 14:38-14:38 Development (development, execution, apps: Ghostty) ⟦kind-shift → kind-shift⟧; active 0m
- 14:38-14:39 Watching Netflix (entertainment, ambient, apps: Safari) ⟦kind-shift → kind-shift⟧; active 1m pages: Netflix
- 14:39-14:40 Development (development, execution, apps: Ghostty) ⟦kind-shift → kind-shift⟧; active 1m
- 14:40-14:45 Watching Netflix & YouTube (entertainment, ambient, apps: Dia, Safari) ⟦kind-shift → kind-shift⟧; active 5m pages: Netflix | Netflix
- 14:45-14:49 Starlink (browsing, research on Starlink, apps: Safari, Ghostty) ⟦kind-shift → kind-shift⟧; active 4m pages: Starlink | [redacted page on site-0018.example]
- 14:49-14:51 Watching Netflix (aiTools, ambient, apps: Dia) ⟦kind-shift → kind-shift⟧; active 1m pages: Starlink | Starlink
- 14:51-15:09 Starlink (development, execution on Starlink, apps: Ghostty, Codex, Dia) ⟦kind-shift → kind-shift⟧; active 18m pages: Starlink | Starlink
- 15:09-15:10 Watching Netflix (entertainment, ambient, apps: Dia) ⟦kind-shift → kind-shift⟧; active 1m pages: Netflix
- 15:11-15:17 Starlink (aiTools, research on Starlink, apps: Codex, Dia) ⟦kind-shift → kind-shift⟧; active 6m pages: Starlink
- 15:17-15:19 Watching Netflix (aiTools, ambient, apps: Dia) ⟦kind-shift → kind-shift⟧; active 2m pages: [redacted page on site-0010.example] | Starlink
- 15:19-15:29 AI Tools (aiTools, research, apps: Codex) ⟦kind-shift → kind-shift⟧; active 10m
- 15:29-15:31 Watching Netflix (entertainment, ambient, apps: Dia) ⟦kind-shift → kind-shift⟧; active 2m pages: Netflix
- 15:31-15:43 Netflix (entertainment, research, apps: Codex, Finder) ⟦kind-shift → kind-shift⟧; active 13m pages: Netflix
- 15:43-15:44 Watching Netflix (entertainment, ambient, apps: Dia) ⟦kind-shift → kind-shift⟧; active 0m pages: Netflix
- 15:44-15:58 Starlink (aiTools, research on Starlink, apps: Codex, Dia, Comet) ⟦kind-shift → kind-shift⟧; active 14m pages: Starlink | Starlink
- 15:58-16:00 Watching Netflix (entertainment, ambient, apps: Dia) ⟦kind-shift → kind-shift⟧; active 2m pages: Netflix
- 16:00-16:24 Nextdns (aiTools, research on Nextdns, apps: Codex, Safari) ⟦kind-shift → category-shift⟧; active 16m pages: Nextdns | Nextdns
- 16:24-16:31 Nextdns (browsing, research on Nextdns, apps: Safari) ⟦category-shift → category-shift⟧; active 7m pages: Nextdns | Nextdns
- 16:31-16:44 Nextdns (aiTools, research on Nextdns, apps: Codex) ⟦category-shift → kind-shift⟧; active 13m pages: Nextdns
- 16:44-16:47 Watching Netflix (entertainment, ambient, apps: Dia) ⟦kind-shift → idle-gap⟧; active 3m pages: Netflix
- 18:36-18:41 Watching Netflix (entertainment, ambient, apps: Dia, Safari) ⟦idle-gap → idle-gap⟧; active 5m pages: Netflix | Netflix
- 19:22-20:27 Watching Netflix & YouTube (entertainment, ambient, apps: Dia, Finder, Safari) ⟦idle-gap → kind-shift⟧; active 32m pages: Netflix | [redacted page on site-0030.example]
- 20:27-20:30 Figma (browsing, research on Figma, apps: Safari, Figma) ⟦kind-shift → kind-shift⟧; active 3m pages: Figma | Figma
- 20:30-20:43 On X & YouTube (social, ambient, apps: Dia, factory-desktop) ⟦kind-shift → kind-shift⟧; active 12m pages: [redacted page on x.com] | [redacted page on site-0030.example]
- 20:43-20:44 [redacted page on account.example] (design, execution on [redacted page on account.example], apps: Framer, Framer, Safari) ⟦kind-shift → kind-shift⟧; active 1m pages: [redacted page on account.example] | [redacted page on site-0036.example]
- 20:44-20:54 On X & YouTube (social, ambient, apps: Dia, Safari) ⟦kind-shift → day-end⟧; active 11m pages: [redacted page on x.com] | [redacted page on site-0037.example]

Wrap check: quality full; dominant entertainment; top app Dia; top domain youtube.com; unsupported claims none
Review spine: mattered [Machine Learning Pipeline | Nextdns | Starlink]; needs review 7; carryover [Nextdns (open-thread) | Starlink (recurring)]

Issues:
- over-split morning-network-setup: 09:18-10:07, 08:03-08:47, 08:47-09:17, 09:17-09:18, 08:47-08:47
- over-split midday-machine-learning-pipeline: 11:22-11:46, 12:03-12:22, 12:52-13:11, 11:46-12:03, 11:10-11:22, 11:09-11:10, 11:10-11:10
- over-split afternoon-starlink-debugging: 16:00-16:24, 14:51-15:09, 15:44-15:58, 16:31-16:44, 15:31-15:43, 15:19-15:29, 16:24-16:31, 15:11-15:17, 16:44-16:47, 15:17-15:19, 15:58-16:00, 15:29-15:31, 15:09-15:10, 15:43-15:44
- over-split evening-watching: 19:22-20:27, 20:30-20:43, 20:44-20:54, 18:36-18:41, 20:27-20:30, 20:43-20:44
- wrong label midday-machine-learning-pipeline: got "On X & YouTube", expected "Machine learning pipeline class"
- wrong intent role midday-machine-learning-pipeline: got ambient, expected coordination
- wrong intent role afternoon-starlink-debugging: got research, expected execution
- wrong intent subject midday-machine-learning-pipeline: got null
- day baseline: tracked 419m, expected 361m ±15m
- day baseline: block count 53, expected <= 8
- day baseline: material block 09:17-09:18 is 1m, expected >= 5m
- day baseline: material block 10:29-10:30 is 1m, expected >= 5m
- day baseline: material block 10:35-10:37 is 1m, expected >= 5m
- day baseline: material block 10:59-11:00 is 1m, expected >= 5m
- day baseline: material block 11:00-11:03 is 3m, expected >= 5m
- day baseline: material block 11:03-11:05 is 2m, expected >= 5m
- day baseline: material block 11:05-11:09 is 4m, expected >= 5m
- day baseline: material block 11:09-11:10 is 1m, expected >= 5m
- day baseline: material block 14:36-14:38 is 2m, expected >= 5m
- day baseline: material block 14:38-14:39 is 1m, expected >= 5m
- day baseline: material block 14:39-14:40 is 1m, expected >= 5m
- day baseline: material block 14:45-14:49 is 4m, expected >= 5m
- day baseline: material block 14:49-14:51 is 1m, expected >= 5m
- day baseline: material block 15:09-15:10 is 1m, expected >= 5m
- day baseline: material block 15:17-15:19 is 2m, expected >= 5m
- day baseline: material block 15:29-15:31 is 2m, expected >= 5m
- day baseline: material block 15:58-16:00 is 2m, expected >= 5m
- day baseline: material block 16:44-16:47 is 3m, expected >= 5m
- day baseline: material block 20:27-20:30 is 3m, expected >= 5m
- day baseline: material block 20:43-20:44 is 1m, expected >= 5m
- day baseline: forbidden label appears: Untitled block
- week baseline: week tracked 1525m, expected 1207m ±15m
- design: kind: midday-machine-learning-pipeline is leisure, expected work
- phase0 dogfood: kind: midday-machine-learning-pipeline is leisure, expected work
- phase0 dogfood: forbidden label appears: Untitled block
- phase0 segmentation: morning-network-setup: overlaps 5 blocks
- phase0 segmentation: morning-network-setup: boundary mismatch
- phase0 segmentation: midday-machine-learning-pipeline: overlaps 7 blocks
- phase0 segmentation: midday-machine-learning-pipeline: boundary mismatch
- phase0 segmentation: afternoon-starlink-debugging: overlaps 14 blocks
- phase0 segmentation: afternoon-starlink-debugging: boundary mismatch
- phase0 segmentation: evening-watching: overlaps 6 blocks
- phase0 segmentation: evening-watching: boundary mismatch
- phase0 segmentation: day has 53 blocks, expected <= 8
- phase0 segmentation: 26 material blocks are shorter than 5m
- phase0 duration: one-duration total 419m != observed truth 361m ±15m
- phase0 kind-tag: midday-machine-learning-pipeline: displayed leisure, expected work
- phase0 week-consistency: week chart 91484s != review source 114853s
- phase0 week-consistency: week chart 1525m != observed truth 1207m ±15m
- extra actual block: 10:07-10:16 Untitled block (uncategorized, ambiguous, apps: UniFi OS Server) ⟦category-shift → kind-shift⟧
- extra actual block: 10:17-10:29 Watching YouTube (entertainment, ambient, apps: Safari, Siri, System Settings) ⟦kind-shift → kind-shift⟧
- extra actual block: 10:29-10:30 Communication (communication, communication, apps: Messages) ⟦kind-shift → kind-shift⟧
- extra actual block: 10:30-10:35 Watching YouTube (entertainment, ambient, apps: Siri, Safari) ⟦kind-shift → kind-shift⟧
- extra actual block: 10:35-10:37 Development (development, execution, apps: Ghostty, Finder) ⟦kind-shift → kind-shift⟧
- extra actual block: 10:37-10:50 Watching YouTube & X (entertainment, ambient, apps: Safari) ⟦kind-shift → kind-shift⟧
- extra actual block: 10:50-10:51 Development (development, execution, apps: Ghostty) ⟦kind-shift → kind-shift⟧
- extra actual block: 10:51-10:59 Watching YouTube (entertainment, ambient, apps: Safari) ⟦kind-shift → kind-shift⟧
- extra actual block: 10:59-11:00 [redacted page on meet.google.com] (aiTools, coordination on [redacted page on meet.google.com], apps: Dia) ⟦kind-shift → kind-shift⟧
- extra actual block: 11:00-11:03 Watching YouTube (browsing, ambient, apps: Safari) ⟦kind-shift → kind-shift⟧
- extra actual block: 11:03-11:05 Development (development, execution, apps: Ghostty, Granola) ⟦kind-shift → kind-shift⟧
- extra actual block: 11:05-11:09 On X & YouTube (social, ambient, apps: Safari) ⟦kind-shift → kind-shift⟧
- extra actual block: 14:09-14:35 Watching YouTube & X (entertainment, ambient, apps: Dia, Safari, Siri) ⟦kind-shift → kind-shift⟧
- extra actual block: 14:35-14:36 Development (development, execution, apps: Ghostty) ⟦kind-shift → kind-shift⟧
- extra actual block: 14:36-14:38 Watching Netflix & YouTube (entertainment, ambient, apps: Safari, Dia, Finder) ⟦kind-shift → kind-shift⟧
- extra actual block: 14:38-14:38 Development (development, execution, apps: Ghostty) ⟦kind-shift → kind-shift⟧
- extra actual block: 14:38-14:39 Watching Netflix (entertainment, ambient, apps: Safari) ⟦kind-shift → kind-shift⟧
- extra actual block: 14:39-14:40 Development (development, execution, apps: Ghostty) ⟦kind-shift → kind-shift⟧
- extra actual block: 14:40-14:45 Watching Netflix & YouTube (entertainment, ambient, apps: Dia, Safari) ⟦kind-shift → kind-shift⟧
- extra actual block: 14:45-14:49 Starlink (browsing, research on Starlink, apps: Safari, Ghostty) ⟦kind-shift → kind-shift⟧
- extra actual block: 14:49-14:51 Watching Netflix (aiTools, ambient, apps: Dia) ⟦kind-shift → kind-shift⟧

## Pure leisure day (leisure-day)
A rest day: YouTube, Netflix, and some X scrolling, no work at all. Must read as leisure end-to-end — no work episodes, no focus scoring, no work intent, no raw video titles as labels.

Score: segmentation 2/2 | labels 2/2 | intent 0/0 | wraps 0/0 | day 0/0 | week 0/0

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

Score: segmentation 6/6 | labels 6/6 | intent 6/6 | wraps 1/1 | day 0/0 | week 0/0

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

Score: segmentation 1/1 | labels 1/1 | intent 1/1 | wraps 1/1 | day 0/0 | week 0/0

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

Score: segmentation 3/3 | labels 3/3 | intent 1/1 | wraps 0/0 | day 0/0 | week 0/0

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

## Phase 0 gap and system-noise witnesses (phase0-contract-witnesses)
Synthetic witnesses supplement the real founder export where a privacy-safe fixture must prove distinct gap reasons and exercise the system-noise denylist.
Expected-red baseline: this fixture should fail under `--strict` until the v2 truth packets fix the real-day defects.

Score: segmentation 7/7 | labels 7/7 | intent 0/0 | wraps 0/0 | day 0/0 | week 0/0
Phase 0: gap-reasons fail | system-noise fail

| Expected episode | Actual primary block | Result | Notes |
| --- | --- | --- | --- |
| morning-coding 08:00-09:00 "Daylens timeline tests" | 08:00-09:00 Daylens timeline tests (development, execution on Daylens timeline tests, apps: Cursor) ⟦day-start → idle-gap⟧ | pass | ok |
| late-morning-coding 10:00-11:00 "Daylens timeline tests" | 10:00-11:00 Daylens timeline tests (development, execution on Daylens timeline tests, apps: Cursor) ⟦idle-gap → idle-gap⟧ | pass | ok |
| midday-coding 12:00-13:00 "Daylens timeline tests" | 12:00-13:00 Daylens timeline tests (development, execution on Daylens timeline tests, apps: Cursor) ⟦idle-gap → idle-gap⟧ | pass | ok |
| afternoon-coding 14:00-15:00 "Daylens timeline tests" | 14:00-15:00 Daylens timeline tests (development, execution on Daylens timeline tests, apps: Cursor) ⟦idle-gap → idle-gap⟧ | pass | ok |
| late-afternoon-coding 16:00-17:00 "Daylens timeline tests" | 16:00-17:00 Daylens timeline tests (development, execution on Daylens timeline tests, apps: Cursor) ⟦idle-gap → idle-gap⟧ | pass | ok |
| evening-coding 18:00-19:00 "Daylens timeline tests" | 18:00-19:00 Daylens timeline tests (development, execution on Daylens timeline tests, apps: Cursor) ⟦idle-gap → idle-gap⟧ | pass | ok |
| late-evening-coding 20:00-21:00 "Daylens timeline tests" | 20:00-21:00 Daylens timeline tests (development, execution on Daylens timeline tests, apps: Cursor) ⟦idle-gap → day-end⟧ | pass | ok |

Actual blocks:
- 08:00-09:00 Daylens timeline tests (development, execution on Daylens timeline tests, apps: Cursor) ⟦day-start → idle-gap⟧; active 1h
- 10:00-11:00 Daylens timeline tests (development, execution on Daylens timeline tests, apps: Cursor) ⟦idle-gap → idle-gap⟧; active 1h
- 12:00-13:00 Daylens timeline tests (development, execution on Daylens timeline tests, apps: Cursor) ⟦idle-gap → idle-gap⟧; active 1h
- 14:00-15:00 Daylens timeline tests (development, execution on Daylens timeline tests, apps: Cursor) ⟦idle-gap → idle-gap⟧; active 1h
- 16:00-17:00 Daylens timeline tests (development, execution on Daylens timeline tests, apps: Cursor) ⟦idle-gap → idle-gap⟧; active 1h
- 18:00-19:00 Daylens timeline tests (development, execution on Daylens timeline tests, apps: Cursor) ⟦idle-gap → idle-gap⟧; active 1h
- 20:00-21:00 Daylens timeline tests (development, execution on Daylens timeline tests, apps: Cursor) ⟦idle-gap → day-end⟧; active 1h

Wrap check: quality full; dominant development; top app Cursor; top domain none; unsupported claims none
Review spine: mattered [Daylens timeline tests | Daylens timeline tests | Daylens timeline tests]; needs review 0; carryover [Daylens timeline tests (open-thread)]

Issues:
- phase0 gap-reasons: 13:00:00-14:00:00: idle, expected paused
- phase0 gap-reasons: 15:00:00-16:00:00: idle, expected permission_limited
- phase0 gap-reasons: 19:00:00-20:00:00: idle, expected no_samples
- phase0 system-noise: UserNotificationCenter survives into Apps summaries
- phase0 system-noise: Finder survives into Apps summaries

## Research day (research-day)
Competitive research across several sources, followed by synthesis in notes and a second evidence pass.

Score: segmentation 3/3 | labels 3/3 | intent 3/3 | wraps 1/1 | day 0/0 | week 0/0

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

Score: segmentation 3/3 | labels 3/3 | intent 3/3 | wraps 1/1 | day 0/0 | week 0/0

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

