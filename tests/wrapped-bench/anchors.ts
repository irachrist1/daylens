// Per-slide judge anchors (Stage 1 recalibration). The benchmark's LLM judge was
// scoring against an ABSTRACT rubric with no exemplars, so it graded weak lines
// high and swung run to run. These anchors give the judge concrete calibration:
// for the slide it is scoring, what an excellent (9-10) line reads like and what
// a failing (<7) line reads like. Distilled from docs/wrapped-slide-catalog.md
// (the human spec) and founder-approved examples — keep the two in sync.
//
// Anchors are ILLUSTRATIVE, never templates: they show the BAR (specific, real,
// voice-true) and the failure modes (vague, hype, restating the card, inventing).

export interface SlideAnchors {
  /** What a 9-10 line for THIS slide reads like. */
  perfect: string[]
  /** What a <7 line reads like, and why it fails. */
  bad: string[]
}

/** Story beats share one anchor set; their ids are dynamic (story-morning, …). */
function normalizeSlideId(slideId: string): string {
  if (slideId.startsWith('story')) return 'story'
  return slideId
}

const DAY_ANCHORS: Record<string, SlideAnchors> = {
  opening: {
    perfect: [
      'A maker\'s morning that set the whole tone, then the day opened up after the design review. The tracking engine quietly won the day.',
      'A split day: heads-down all morning, then it scattered after lunch into a dozen small things.',
      'Mostly off the clock today, and it reads like a choice, not a gap.',
    ],
    bad: [
      'Today was a productive and focused day with lots of great work in Cursor.',
      'You had a good day with some work and some breaks.',
    ],
  },
  headline: {
    perfect: [
      'Most of it stacked up before lunch, when the tracking engine took your two best hours in one sitting.',
      'Nearly all of it landed between 9am and 6pm. A clean, contained day.',
    ],
    bad: [
      'You tracked 6h 40m across the day.',
      'That is a lot of hours for one day of work.',
    ],
  },
  story: {
    perfect: [
      'You were on the tracking engine from the first coffee, fixing the midnight day-split that had been quietly wrong for weeks. By the standup at 9 you\'d already closed it.',
      'After the design review you gave the settings screen the rest of your attention, with a short YouTube break in the middle that read like a breath, not a detour.',
      'The morning went to the intercompany reconciliations, and by the time the team was online you\'d cleared three of the five entities.',
    ],
    bad: [
      'In the morning you worked in Cursor and Claude Code, then had a meeting, then worked more.',
      'You spent the morning being productive on various coding tasks.',
    ],
  },
  focus: {
    perfect: [
      'From 7:12am you stayed with the tracking engine for two and a half hours without surfacing, your longest unbroken run of the day. 🔥',
      'A little over two hours on the proposal without a single switch, the deepest you went all day.',
    ],
    bad: [
      'Your longest stretch was 2h 28m.',
      'You focused really hard for a long time today.',
    ],
  },
  timesink: {
    perfect: [
      'Google Colab was where the ML pipeline reading actually lived, so that 54m is the work, not a detour.',
      'Figma held the most of it, which tracks for a day that was really about the redesign.',
    ],
    bad: [
      'You spent the most time in Chrome today.',
      'Chrome was your top app at 1h 12m.',
    ],
  },
  apps: {
    perfect: [
      'Cursor and Claude Code traded off all morning, with Figma only really showing up for the design review.',
      'The day lived in a handful of tools: Excel for the reconciliations, Outlook for the back-and-forth, and the GL system underneath it all.',
    ],
    bad: [
      'Your top apps were Cursor, Figma, and Chrome.',
      'You used a lot of different apps today.',
    ],
  },
  split: {
    perfect: [
      'Nearly all of it was the build, with just enough off the clock to not fry. 88% to 12%.',
      'A fuller split than usual, 70% work to 30% off, and the day was better for it.',
    ],
    bad: [
      'You spent 88% of your day being productive.',
      'Work took up most of your time, which is good.',
    ],
  },
  forgotten: {
    perfect: [
      'Notion quietly ate 22 minutes you probably forgot about, notes you opened once and never closed.',
      'Slack took 18 minutes in the margins, never the main thing, always there.',
    ],
    bad: [
      'You also used Notion for 22 minutes.',
      'There were some other apps you used a little bit.',
    ],
  },
  wildcard: {
    perfect: [
      'Your day started earlier than any day in two weeks, and those first two hours were the cleanest work you did.',
      'You came back to the proposal 14 separate times before it was done. It is done.',
    ],
    bad: [
      'You had an interesting day with some surprising moments.',
      'Your longest stretch was in the morning.',
    ],
  },
  meetings: {
    perfect: [
      'The standup ran 30 minutes and you built straight through the rest of the morning around it.',
      'Two reviews back to back after lunch, and both the AP and revenue schedules came out approved.',
    ],
    bad: [
      'You spent 1h 13m in meetings today.',
      'You had several meetings that took up your time.',
    ],
  },
  question: {
    perfect: [
      'The tracking engine has clearly been the main character lately. Are you near the end of it, or does it keep opening new doors?',
      'You gave the morning your sharpest hours again. Is that on purpose, or just how the day falls?',
    ],
    bad: [
      'What did you work on today?',
      'Should you try to be more focused tomorrow?',
    ],
  },
  reflection: {
    perfect: [
      'Tuesday was a maker\'s day. You gave the tracking engine your first and best hours, closed the midnight bug that had been wrong for weeks, and still made room for the design review and the settings work after lunch. The eleven commits tell the same story the timeline does: early, heads-down, mostly on one thing. A good one to have behind you.',
    ],
    bad: [
      'Today you were productive and got a lot done. You worked on several things and had some meetings. Great job, keep it up tomorrow.',
    ],
  },
}

const WEEK_ANCHORS: Record<string, SlideAnchors> = {
  opening: {
    perfect: [
      'A week with one clear spine: the timeline rework, four days of it, everything else orbiting around.',
      'Two halves. The first three days were all launch, then it eased into cleanup and catch-up.',
    ],
    bad: ['A productive week with lots of good work across several projects.'],
  },
  headline: {
    perfect: [
      'About 31 hours in, and Tuesday carried more of it than any other day by a stretch.',
      'A lighter week than most, close to 18 hours, and most of it landed in two focused days.',
    ],
    bad: ['You tracked 31 hours this week.'],
  },
  shape: {
    perfect: [
      'It built to a Wednesday peak and coasted down from there, with Friday the quietest by far.',
      'Front-loaded and honest about it: Monday and Tuesday did the heavy lifting, the rest was follow-through.',
    ],
    bad: ['Some days were busier than others this week.'],
  },
  threads: {
    perfect: [
      'The timeline rework took the week, 12 hours across four days, more than everything else combined.',
      'Two threads split it evenly: the proposal early, the network build late, about nine hours each.',
    ],
    bad: ['You worked on several different projects this week.'],
  },
  reflection: {
    perfect: [
      'Good week. The launch and the proposal both crossed the line, and the timeline rework you\'ve been circling finally got four real days in a row. Tuesday was the engine of it. Friday you eased off, and that reads earned, not slack. A week that knew what it was about.',
    ],
    bad: ['A solid and productive week where you accomplished a lot. Nice work, and keep the momentum going next week.'],
  },
}

/** Anchors for a slide, or null when we don't have a calibrated set yet (the
 *  judge then falls back to the rubric alone for that slide). */
export function anchorsFor(cadence: 'day' | 'week', slideId: string): SlideAnchors | null {
  const table = cadence === 'week' ? WEEK_ANCHORS : DAY_ANCHORS
  return table[normalizeSlideId(slideId)] ?? null
}
