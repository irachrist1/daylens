// Pure helpers for the daily Wrapped narrative: facts hash, prompt building,
// AI-output validation, and the deterministic fallback. Kept out of the service
// module so tests can exercise it without the AI orchestration / settings chain.
//
// The wrap is a DECK: `planDayWrapSlides` (renderer/lib/wrapDeck.ts) computes
// the slides deterministically from `DayWrapFacts`, and the model writes one
// line per slide id, plus one curious question and a closing reflection. A line
// that invents a number, grades, or breaks the voice dies alone — its slide
// falls back to the deterministic line; the deck never collapses wholesale.

import { createHash } from 'node:crypto'
import { VOICE_SYSTEM_PROMPT } from '../ai/voiceContract'
import type { AIWrappedNarrative, DayEnrichment } from '@shared/types'
import {
  formatHm,
  workActionPhrase,
  type DayWrapFacts,
} from '../../renderer/lib/dayWrapScenes'
import { planDayWrapSlides, type WrapSlideSpec } from '../../renderer/lib/wrapDeck'
import {
  DECK_JSON_CONTRACT,
  EVIDENCE_HONESTY_DIRECTIVES,
  buildRepairUserMessage,
  deckPromptSection,
  guardContextPercents,
  guardContextTimes,
  stripCodeFence,
  validateDeckLinesDetailed,
  wrapQuestionViolation,
  wrapReflectionViolation,
  type LineGuardContext,
  type WrapLineRejection,
} from './wrapNarrativeShared'

// ─── Hashing & cache key ──────────────────────────────────────────────────────

/** A compact, order-stable fingerprint of the enrichment the model saw, so the
 *  stored factsHash honestly changes when what was shipped/met changes (a
 *  post-commit Regenerate yields a new hash). */
function enrichmentFingerprint(enrichment: DayEnrichment | null | undefined): unknown {
  if (!enrichment) return null
  return {
    shipped: enrichment.shipped && {
      commits: enrichment.shipped.commitsByProject.map((c) => [c.project, c.commits]),
      prs: enrichment.shipped.pullRequests.map((p) => [p.project, p.state, p.count]),
      highlights: enrichment.shipped.highlights.map((h) => h.toLowerCase()),
    },
    meetings: enrichment.meetings && {
      count: enrichment.meetings.count,
      items: enrichment.meetings.items.map((i) => [i.title?.toLowerCase() ?? '', i.scheduled]),
    },
    focus: enrichment.focusSessions && [enrichment.focusSessions.tool, enrichment.focusSessions.sessions, enrichment.focusSessions.focused],
    // notes connector: fingerprint the meeting notes so a changed note reflows the wrap.
    meetingNotes: enrichment.meetingNotes && {
      app: enrichment.meetingNotes.app,
      items: enrichment.meetingNotes.items.map((i) => [i.title.toLowerCase(), i.participants.map((p) => p.toLowerCase()), i.actionItems.map((a) => a.toLowerCase())]),
    },
  }
}

/** All counts the model may legitimately attach to an enrichment noun, keyed by
 *  category ("commits:9") so a real meeting count can't vouch for a commit count.
 *  A total commit count across projects is also allowed (the model may sum). */
export function enrichmentAllowedCounts(enrichment: DayEnrichment | null | undefined): Set<string> {
  const counts = new Set<string>()
  if (!enrichment) return counts
  let commitTotal = 0
  for (const c of enrichment.shipped?.commitsByProject ?? []) { counts.add(`commits:${c.commits}`); commitTotal += c.commits }
  if (commitTotal > 0) counts.add(`commits:${commitTotal}`)
  let prTotal = 0
  for (const p of enrichment.shipped?.pullRequests ?? []) { counts.add(`prs:${p.count}`); prTotal += p.count }
  if (prTotal > 0) counts.add(`prs:${prTotal}`)
  if (enrichment.meetings) counts.add(`meetings:${enrichment.meetings.count}`)
  if (enrichment.focusSessions) counts.add(`sessions:${enrichment.focusSessions.sessions}`)
  return counts
}

export function computeFactsHash(facts: DayWrapFacts, enrichment?: DayEnrichment | null): string {
  const bucket = (s: number) => Math.round(s / 60)
  const canonical = JSON.stringify({
    date: facts.date,
    quality: facts.quality,
    active: bucket(facts.activeSeconds),
    work: bucket(facts.workSeconds),
    leisure: bucket(facts.leisureSeconds),
    personal: bucket(facts.personalSeconds),
    isLeisure: facts.isLeisureDay,
    activities: facts.workActivities.map((a) => [a.name.toLowerCase(), bucket(a.seconds)]),
    appSites: facts.appSites.map((s) => [s.name.toLowerCase(), bucket(s.seconds)]),
    standout: facts.standout ? [facts.standout.name.toLowerCase(), bucket(facts.standout.seconds)] : null,
    wildcard: facts.wildcardHook ? [facts.wildcardHook.kind, facts.wildcardHook.value] : null,
    story: facts.dayStory.map((seg) => [seg.part, seg.items.map((i) => i.toLowerCase()), bucket(seg.seconds)]),
    enrichment: enrichmentFingerprint(enrichment),
  })
  return createHash('sha1').update(canonical).digest('hex').slice(0, 12)
}

export function wrappedNarrativeCacheKey(facts: DayWrapFacts, factsHash: string): string {
  return `${facts.date}|${factsHash}`
}

function guardContext(facts: DayWrapFacts, slides: WrapSlideSpec[], enrichment?: DayEnrichment | null): LineGuardContext {
  return {
    totalHours: facts.activeSeconds / 3600,
    hourTolerance: 1.05,
    allowedPercents: guardContextPercents(slides),
    allowedTimes: guardContextTimes(slides),
    allowedCounts: enrichmentAllowedCounts(enrichment),
  }
}

// ─── Prompt construction ──────────────────────────────────────────────────────

/** The compact, model-facing projection of the facts. Durations are
 *  pre-formatted so the model never does math. Exported so ask-anything
 *  answers ground themselves in exactly what the wrap narrated. `enrichment`
 *  (git / calendar / focus, already sanitized) rides along when present so the
 *  wrap can say what was PRODUCED, not only what was open. */
export function compactDayFacts(facts: DayWrapFacts, enrichment?: DayEnrichment | null) {
  const storyBeats = facts.dayStory.map((s) => ({
    when: `${s.clockStart} to ${s.clockEnd}`,
    partOfDay: s.label,
    did: s.items,
    alsoSawSomeOf: s.aside,
    ...(s.spillover ? { note: 'the tail of LAST night, before bed. Not the start of this day.' } : {}),
  }))
  return {
    date: facts.date,
    weekday: facts.weekday,
    quality: facts.quality,
    total: formatHm(facts.activeSeconds),
    dayBegan: facts.mainStartClock,
    split: {
      work: formatHm(facts.workSeconds),
      leisure: formatHm(facts.leisureSeconds),
      personal: formatHm(facts.personalSeconds),
      mostlyRest: facts.isLeisureDay,
    },
    workedOn: facts.workActivities.map((a) => ({ what: workActionPhrase(a.name, a.category), time: formatHm(a.seconds) })),
    whereTheTimeWent: facts.appSites.map((s) => ({ name: s.name, time: formatHm(s.seconds) })),
    story: storyBeats,
    longestStretch: facts.standout
      ? { time: formatHm(facts.standout.seconds), on: facts.standout.name, from: `${facts.standout.startClock} to ${facts.standout.endClock}` }
      : null,
    topLeisure: facts.topLeisure,
    // What the window titles say was actually being done in each app — the
    // semantic depth under "4 hours in Cursor" (Stage 0.1). Already humanized;
    // still subject to every naming rule (name the work, never the file).
    insideTheApps: facts.titleContext.map((app) => ({
      app: app.appName,
      workedOn: app.clusters.map((c) => `${c.label} (${c.sessions === 1 ? '1 session' : `${c.sessions} sessions`}, ${formatHm(c.seconds)})`),
    })),
    // Enrichment (git / calendar / focus). Each key present only when its
    // connector had something; already sanitized and pre-formatted. These carry
    // NO clock times on purpose (the per-slide clock guard would kill them).
    ...(enrichment?.shipped ? { shipped: enrichment.shipped } : {}),
    ...(enrichment?.meetings ? { meetings: enrichment.meetings } : {}),
    ...(enrichment?.focusSessions ? { focusSessions: enrichment.focusSessions } : {}),
    // notes connector: what actually happened IN meetings (title + first-name
    // participants + the user's recorded action items), already sanitized.
    ...(enrichment?.meetingNotes ? { meetingNotes: enrichment.meetingNotes } : {}),
  }
}

/** Rotating narrative angles: same day → same angle, adjacent days differ, so
 *  the wrap never reads like the same script re-run. The angle only steers
 *  emphasis; every claim still comes from the facts. */
const NARRATIVE_ANGLES = [
  'Today, lead with the rhythm: when the day found its groove and when it breathed.',
  'Today, lead with the craft: what was actually being made, and how the hours served it.',
  'Today, lead with the one moment worth remembering, and let the rest orbit it.',
  'Today, lead with the contrast: the heads-down stretches against the drift, plainly.',
  'Today, lead with the person: what this day says about how they work when nobody is watching.',
] as const

/** The time-literacy contract. The single worst historical failure was the
 *  model calling an 11:15am meeting "midnight"; this block plus the validator
 *  (which kills any clock time not present in the slide's facts) closes it. */
const TIME_LITERACY = [
  'HOW TO READ TIMES. Every time in the facts is a local 12-hour clock string.',
  '"12am" is midnight, the very start of the day. "12pm" is noon, the middle of the day.',
  '"12:27pm" is 27 minutes AFTER NOON, early afternoon. It is not midnight and not night.',
  'A time ending in "am" between 5am and 11:59am is morning. Between 12pm and 4:59pm is afternoon. 5pm to 8:59pm is evening. 9pm onward is night.',
  'CLOCK RULE, STRICT: You may write a clock time on a slide ONLY if that exact time appears in THAT slide\'s own facts, and you must copy it CHARACTER FOR CHARACTER. Never round it (write "10:26pm", never "10pm" or "past 10"), never turn it into a word ("noon", "midnight", "dinnertime", "after dinner"), never do clock arithmetic, never move a time onto a slide whose facts do not list it (the late-night slide uses only its own end clock; the headline uses only the day\'s start and end).',
  'If you want to place a beat in time without a grounded clock, name the PART OF DAY ("the morning", "after lunch", "the evening"), never a bare clock the facts did not give you.',
  '"5pm", "9am", "10pm" and the like ARE clock times, not parts of day. Never write "after 5pm" to mean "the evening"; write "the evening". A clock time is allowed ONLY when it is in that slide\'s own facts.',
].join(' ')

/** The enrichment directives, added only for the blocks that are present. They
 *  govern how the model may speak git / calendar / focus without inventing or
 *  leaking plumbing. Kept in the same terse imperative voice as the rest. */
function enrichmentDirectives(enrichment: DayEnrichment | null | undefined): string[] {
  if (!enrichment) return []
  const out: string[] = [
    'SOME FACTS COME FROM OUTSIDE THE SCREEN TIME. The facts may include "shipped" (real git commits and pull requests, by project), "meetings" (calendar events with titles and scheduled lengths), and "focusSessions" (focus-timer runs). They are real and specific; use them to say what was PRODUCED, not only what was open. They carry no clock times, so write none for them. Copy every duration exactly and never invent a count.',
  ]
  if (enrichment.shipped) {
    out.push('"shipped" names the work the day produced. Say what was committed and to which project using the humanized project names in shipped.commitsByProject (for example "wrote 9 commits to the billing service"), draw on shipped.highlights to describe what was actually built in plain words, and note a pull request opened, merged, closed, or left a draft from shipped.pullRequests. Use the EXACT commit and pull-request counts the facts give you, never a different number. A commit is a commit and a pull request is a pull request; do not upgrade it into a shipped feature or invent what the code did beyond what the facts say. Never print a filename, path, folder, or branch; the project name and the highlight phrasing are the only code identifiers you may write, and you must phrase highlights as human work, never paste them verbatim as a label.')
  }
  if (enrichment.meetings) {
    out.push('"meetings" tells you what the day\'s CALENDAR held, not what was attended. You may say how many events the calendar had (meetings.count) and name one by the title in meetings.items when it reads like a meeting, always anchored to the calendar ("your calendar had the design review"), never as attendance ("you attended", "you sat through", "you went to"). Never state an attendee count. The meetings slide\'s big number is time observed in meeting apps, the only evidence the person was actually IN a call; a meeting\'s "scheduled" length is a different fact. You may cite ONE meeting\'s scheduled length as color, copied exactly, but never add scheduled lengths together, never present their sum as the slide\'s number, and never claim a meeting total that disagrees with that card.')
    // event-type inference: each item carries a `type` + `confidence` (Daylens's
    // own read of what the event was). High confidence unlocks richer phrasing;
    // low confidence or 'generic' stays literal. Never invent a type, never
    // print the word "confidence" or the number, never hedge toward a type.
    out.push('Each item in meetings.items also carries a "type" (class, one_on_one, presentation, interview, workout, team_meeting, deep_work, or generic) and a "confidence" number, Daylens\'s own read of what that event actually was. When an item\'s confidence is 0.75 or higher AND its type is not "generic", you MAY name it by that type instead of the bare word "meeting": "your ML class" for a class, "the 1:1 with [whoever the title names]" for one_on_one, "the presentation" for presentation, "the interview" for interview, "the workout" for workout, "the team sync" for team_meeting, "a scheduled stretch of deep work" for deep_work. The type changes the NOUN, never the evidence: it is still a calendar entry, so never turn it into an attendance or performance claim ("you presented", "you pitched", "you worked out") on calendar evidence alone. Ground it in the real title when the title is present and reads naturally. When confidence is below 0.75 or type is "generic", say only "the meeting" or "a meeting" and do not guess or hedge toward a type ("looked like a class", "possibly a 1:1"); a plain literal noun beats a soft guess. Never print the word "confidence" or the number; it exists only to decide how you phrase this.')
  } else {
    out.push('Never state how MANY meetings there were; the facts only know the total meeting time.')
  }
  if (enrichment.focusSessions) {
    out.push('"focusSessions" records focus-timer runs. You may name the tool, how many sessions there were, and the total focused time copied exactly. Describe it plainly as time set aside to work; never turn it into a score, a percentage, or a grade.')
  }
  if (enrichment.meetingNotes) {
    out.push('"meetingNotes" comes from the notes taken IN the user\'s meetings. Each item has a title, the first names of who was there (meetingNotes.items[].participants), and the action items or decisions the user recorded (meetingNotes.items[].actionItems). Use them to say what actually happened in a meeting and what came out of it, in plain words, for example "in the Andersen AI training you agreed to revise the timeline." Ground every claim in the recorded action items; never invent an outcome, a decision, or a follow-up that is not written there, and never paste the notes verbatim or quote a transcript. You may use a participant\'s first name naturally when it fits; never write an email address or a full name. These carry no clock times, so write none for them.')
  }
  return out
}

export function buildWrappedPrompts(facts: DayWrapFacts, enrichment?: DayEnrichment | null): { systemPrompt: string; userMessage: string } {
  const slides = planDayWrapSlides(facts)
  const hasMeetingsEnrichment = Boolean(enrichment?.meetings)
  const systemPrompt = [
    VOICE_SYSTEM_PROMPT,
    'You are Daylens, writing a Spotify-Wrapped-style recap of one person\'s day, slide by slide, as if an AI who watched the whole day sat down to reflect on it with them. Every reveal should feel like it was written for THIS day, never a template.',
    'You will receive a compact JSON facts object derived deterministically from the user\'s local activity, plus the list of slides with the exact facts each slide shows. Phrase ONLY what is in them. Never invent a number, an app, a site, a project, a record, or a superlative.',
    DECK_JSON_CONTRACT,
    TIME_LITERACY,
    ...EVIDENCE_HONESTY_DIRECTIVES,
    'If a story beat is marked as spillover or "the tail of last night", it happened just after midnight BEFORE the person went to bed. Frame it as winding down the previous night. The day itself began at facts.dayBegan.',
    'Each slide line is one or two sentences, written to the person ("you"), specific, never generic. Stat/caption slides stay tight (under ~200 characters); the story beats may run to two full sentences. The curious question stays under ~200 characters.',
    'ADD A READ, DO NOT RESTATE. On every stat slide the slide\'s OWN big number is already printed huge on the card. Do not make that one number the subject of your sentence and do not merely repeat it ("meetings took 1h 13m", "59m on YouTube"). Lead with what it MEANS. BUT your line must still be concrete: anchor it in at least one real detail that is NOT that headline number, for example the real work being done, a real part of the day, or a real supporting time. Never go vague or generic to avoid the number; a line with no concrete anchor is worse than one that names it.',
    'THE REGISTER, by example (never copy these, match their honesty): "Tuesday morning you went straight into the code and stayed there for two and a half hours before your first break." / "The meeting ran through lunch and you built through it anyway." / "YouTube got 44 minutes and honestly, it sat in the middle of a heavy day, so it reads like a breather, not a leak." / "That proposal did not exist this morning. By evening it did."',
    'IN A STORY BEAT, CHOOSE, DO NOT ENUMERATE. Name at most the two biggest things from that part of the day, plus at most one leisure aside. Listing three or more activities in one line reads like a report and runs too long; pick the ones that mattered and let the rest go.',
    'If the user profile gives their first name, use it naturally on one or two slides at most, like a friend would, especially when giving earned credit.',
    'EARNED PRAISE IS ALLOWED and welcome when the facts back it: a long unbroken stretch, a full honest day, a thing shipped. Say it plainly, with their name if you have it. You may end AT MOST ONE line in the whole deck with a single celebratory emoji from this set: 🏆 🔥 🌙 🎯 ☕ ✨. Never more than one emoji total, never mid-sentence, never unearned.',
    'STATE ONLY WHAT THE FACTS GIVE YOU. Do not add comparative or consistency claims the facts do not contain ("more than the rest combined", "held even all day", "every afternoon", "back to back"); if a fact does not state it, do not imply it. A smaller true detail beats a bigger claim you cannot ground.',
    'NAME THE WORK, NEVER THE FILE. Use the humanized names in the facts. Never print a filename, folder, repo, branch, tab title, or video title.',
    'WORK IS AN ACTION, NOT A PLACE. Narrate the person DOING the work; never say they were "on" a project or inside an app, except on the slides that are explicitly about an app or site. A tool (Claude Code, Cursor, Warp, Canva) is the instrument, never the thing being made.',
    'Tools and sites may be named ONLY on the slides whose facts contain them (timesink, apps, forgotten, leisure). Everywhere else, say what was being made, not what it was made in.',
    'NEVER grade, NEVER mention focus percentages or scores, NEVER guilt a break. Write a percentage ONLY on the work-versus-leisure split slide, and only the exact percentages that slide hands you; never put a percentage on any other slide.',
    'BANNED WORDS, never write any of them, not even to negate them: "productive", "productivity", "distraction", "distracted", "drift", "focus score", "noon", "midnight", "dinnertime". For a time of day use the part-of-day words ("the morning", "midday", "the evening"); for what happened, just describe it.',
    'DO NOT DEFEND OR JUSTIFY REST OR LEISURE. Never argue that downtime was "not drift", "not a distraction", "deliberate", or "earned". Rest is allowed and needs no defense; just say plainly what the person did and move on.',
    'Copy every DURATION exactly as the facts pre-format it (if the facts say 42m, never write "45 minutes" or "about 45m"); never round or invent a duration.',
    'The curious question must contain NO clock time and NO percentage.',
    ...(hasMeetingsEnrichment ? [] : ['Never state how MANY meetings there were; the facts only know the total meeting time.']),
    ...enrichmentDirectives(enrichment),
    'NEVER predict tomorrow, NEVER assign homework, NEVER tell the user to pick something up.',
    'Never use an em dash anywhere. Use a comma, a period, or "and". Use "to" for ranges, never a dash.',
    'Any duration you write must appear pre-formatted in the facts. Never compute a new one.',
    'Never describe yourself as a model. You are the small, honest voice of the app.',
    'If facts.quality is "partial", keep every line modest and short.',
    NARRATIVE_ANGLES[facts.seed % NARRATIVE_ANGLES.length],
  ].filter(Boolean).join(' ')

  const userMessage = [
    `Date: ${facts.date}`,
    '',
    'Compact facts JSON:',
    JSON.stringify(compactDayFacts(facts, enrichment), null, 2),
    '',
    deckPromptSection(slides),
    '',
    'Return ONLY the JSON object.',
  ].join('\n')

  return { systemPrompt, userMessage }
}

// ─── Validation ───────────────────────────────────────────────────────────────

/** Parse the model's raw response into the deck JSON object, or null. */
export function parseWrapResponse(raw: string): Record<string, unknown> | null {
  const jsonText = stripCodeFence(raw).trim()
  if (!jsonText) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  return parsed as Record<string, unknown>
}

export interface WrappedNarrativeValidation {
  /** Null only when the OPENING died — the wrap has no lead to show. */
  narrative: AIWrappedNarrative | null
  /** Every rejected piece with its writer-facing reason (repair-round input). */
  rejections: WrapLineRejection[]
}

/** Validate a parsed deck response. Every guard death is returned with its
 *  reason so one repair round can rewrite exactly the failed pieces. */
export function validateWrappedNarrativeObject(
  obj: Record<string, unknown>,
  facts: DayWrapFacts,
  factsHash: string,
  enrichment?: DayEnrichment | null,
): WrappedNarrativeValidation {
  const slides = planDayWrapSlides(facts)
  const ctx = guardContext(facts, slides, enrichment)
  const linesRaw = (obj.lines && typeof obj.lines === 'object') ? obj.lines as Record<string, unknown> : null
  const { lines, rejections } = validateDeckLinesDetailed(linesRaw, slides, ctx)

  const question = wrapQuestionViolation(obj.question, ctx)
  if (question.reason) rejections.push({ id: 'question', candidate: typeof obj.question === 'string' ? obj.question : null, reason: question.reason })
  const reflection = wrapReflectionViolation(obj.reflection, ctx)
  if (reflection.reason) rejections.push({ id: 'reflection', candidate: typeof obj.reflection === 'string' ? obj.reflection : null, reason: reflection.reason })

  // The opening line is the wrap's lead (and the notification one-liner). A
  // response whose opening dies has failed the whole job.
  const lead = lines.opening
  if (!lead) return { narrative: null, rejections }

  return {
    narrative: {
      lead,
      lines,
      question: question.value,
      reflection: reflection.value,
      source: 'ai',
      factsHash,
    },
    rejections,
  }
}

export function validateWrappedNarrativeResponse(
  raw: string,
  facts: DayWrapFacts,
  factsHash: string,
  enrichment?: DayEnrichment | null,
): AIWrappedNarrative | null {
  const obj = parseWrapResponse(raw)
  if (!obj) return null
  return validateWrappedNarrativeObject(obj, facts, factsHash, enrichment).narrative
}

/** The repair-round user message for this day's rejections. */
export function buildWrappedRepairMessage(facts: DayWrapFacts, rejections: WrapLineRejection[]): string {
  return buildRepairUserMessage(planDayWrapSlides(facts), rejections)
}

/** Overlay the repair round's rewrites onto the original response object —
 *  ONLY for the pieces that were rejected; accepted lines are final and a
 *  repair may never overwrite one. Returns the merged object for revalidation. */
export function mergeWrapRepair(
  original: Record<string, unknown>,
  repairRaw: string,
  rejections: WrapLineRejection[],
): Record<string, unknown> {
  const repair = parseWrapResponse(repairRaw)
  if (!repair) return original
  const rejectedIds = new Set(rejections.map((r) => r.id))
  const originalLines = (original.lines && typeof original.lines === 'object') ? original.lines as Record<string, unknown> : {}
  const repairLines = (repair.lines && typeof repair.lines === 'object') ? repair.lines as Record<string, unknown> : {}
  const mergedLines: Record<string, unknown> = { ...originalLines }
  for (const [id, value] of Object.entries(repairLines)) {
    if (rejectedIds.has(id)) mergedLines[id] = value
  }
  return {
    ...original,
    lines: mergedLines,
    question: rejectedIds.has('question') && repair.question != null ? repair.question : original.question,
    reflection: rejectedIds.has('reflection') && repair.reflection != null ? repair.reflection : original.reflection,
  }
}

// ─── Fallback narrative (deterministic) ───────────────────────────────────────
// Never shown when no provider is connected (the UI shows the Settings message).
// This is the honest last resort when a CONNECTED provider returns unusable
// output: every slide renders its deterministic fallbackLine.

export function buildFallbackNarrative(facts: DayWrapFacts, factsHash: string): AIWrappedNarrative {
  if (facts.quality === 'empty') {
    return {
      lead: 'Not much tracked yet. Come back once the day has more in it.',
      lines: {}, question: null, reflection: null,
      source: 'fallback', factsHash,
    }
  }
  if (facts.quality === 'tooEarly') {
    return {
      lead: 'The day is still warming up. Give it a little more and check back.',
      lines: {}, question: null, reflection: null,
      source: 'fallback', factsHash,
    }
  }

  const slides = planDayWrapSlides(facts)
  const opening = slides.find((s) => s.id === 'opening')
  const question = slides.find((s) => s.id === 'question')
  const reflection = slides.find((s) => s.id === 'reflection')
  return {
    lead: opening?.fallbackLine ?? `${formatHm(facts.activeSeconds)} tracked.`,
    lines: {},
    question: question?.fallbackLine ?? null,
    reflection: reflection?.fallbackLine ?? null,
    source: 'fallback',
    factsHash,
  }
}
