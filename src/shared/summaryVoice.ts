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
      return 'Voice: straight and factual. Plain, neutral sentences that state what happened and the numbers, no flourish, no emoji. Never use em dashes; use commas or periods.'
    case 'witty':
      return "Voice: lightly witty and playful. A human, good-humored line or two and at most one tasteful emoji. Never snarky, never at the reader's expense, never fabricate to be funny. Never use em dashes; use commas or periods."
    case 'warm':
    default:
      return 'Voice: warm and encouraging, like a thoughtful friend. Kind, supportive, plain language, no flattery, no hype, no emoji unless it genuinely fits. Never use em dashes; use commas or periods.'
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
    sample: '5h 20m of focused work. Finished the Q3 proposal, had the 2pm team call, cleared your inbox.',
  },
  {
    voice: 'warm',
    label: 'Warm',
    tagline: 'Like a thoughtful friend',
    sample: 'A solid day, about 5 hours in. You stayed with the Q3 proposal and got it finished, made your team call, and cleared the inbox. Nice work.',
  },
  {
    voice: 'witty',
    label: 'Witty',
    tagline: 'A little playful',
    sample: '5-ish hours, mostly heads-down. The Q3 proposal finally crossed the line, the 2pm call happened, and your inbox is (briefly) at zero. ✨',
  },
]
