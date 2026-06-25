import type { SummaryVoice } from './types'

// How Daylens's written summaries sound. The user picks one during onboarding;
// it is applied to every recap / wrap / brief prompt so the choice actually
// changes the words instead of being a dead toggle. This module is the single
// source of truth for both the onboarding picker preview and the real prompts.

export const DEFAULT_SUMMARY_VOICE: SummaryVoice = 'warm'

export const SUMMARY_VOICES: readonly SummaryVoice[] = ['straight', 'warm', 'witty']

export function normalizeSummaryVoice(value: unknown): SummaryVoice {
  return value === 'straight' || value === 'warm' || value === 'witty'
    ? value
    : DEFAULT_SUMMARY_VOICE
}

/**
 * One tone-instruction line appended to a summary/recap/wrap/brief system prompt.
 * Kept short and concrete so it nudges the voice without fighting the facts.
 */
export function voiceDirective(voice: SummaryVoice | undefined): string {
  switch (normalizeSummaryVoice(voice)) {
    case 'straight':
      return 'Voice: Straight. No narrator and no "I", just the facts stated plainly. Economical, never cold: use contractions and compact durations inline ("5h 20m of work"), and lead with the answer. No humor, no emoji, no warmth cue, no scores or percentages. Never use em dashes; use a comma, a period, or "and".'
    case 'witty':
      return 'Voice: Witty. First person and playful, with observational humor that comes from the real day, never snark and never at the reader\'s expense. A light turn or wink is welcome, and at most one emoji when a real moment earns it. Never invent a fact to land a joke. Never use em dashes; use a comma, a period, or "and".'
    case 'warm':
    default:
      return 'Voice: Warm. First person and light, like a sharp friend who was in the room, glad to see you but never fawning. Open at most once with a light "good to see you", connect the day naturally, and let dry humor land when it earns it. Not therapy: no "supportive", no "you\'ve got this", no hype, no flattery. At most one emoji, only when a real moment earns it, usually none. Never use em dashes; use a comma, a period, or "and".'
  }
}

// Sample copy for the onboarding voice picker: the SAME everyday day told in each
// voice. Deliberately not developer-focused (a proposal, a call, an inbox) so it
// reads for anyone with a laptop.
export interface VoiceSample {
  voice: SummaryVoice
  label: string
  tagline: string
  sample: string
}

export const VOICE_SAMPLES: readonly VoiceSample[] = [
  {
    voice: 'straight',
    label: 'Straight',
    tagline: 'Just the facts',
    sample: '5h 20m of work. Morning on the work network, afternoon on the Q3 proposal, which is done. Made the 2pm call and cleared your inbox.',
  },
  {
    voice: 'warm',
    label: 'Warm',
    tagline: 'A sharp friend who was there',
    sample: 'Good to see you. About five hours in. You got the work network up in the morning, then stayed with the Q3 proposal until it was done. The 2pm call happened and your inbox is clear. Solid day.',
  },
  {
    voice: 'witty',
    label: 'Witty',
    tagline: 'A little playful',
    sample: 'Five-ish hours, mostly heads-down. The work network is alive, the Q3 proposal finally crossed the line, and your inbox is (briefly) at zero. The 2pm call also happened, as calls do.',
  },
]
