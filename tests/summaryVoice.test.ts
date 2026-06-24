import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SUMMARY_VOICE,
  SUMMARY_VOICES,
  VOICE_SAMPLES,
  normalizeSummaryVoice,
  voiceDirective,
} from '../src/shared/summaryVoice.ts'

test('each voice yields a distinct, non-empty directive', () => {
  const directives = SUMMARY_VOICES.map((v) => voiceDirective(v))
  for (const d of directives) assert.ok(d.trim().length > 0, 'directive must not be empty')
  assert.equal(new Set(directives).size, SUMMARY_VOICES.length, 'each voice must read differently')
})

test('the directive names the chosen tone so the model actually shifts voice', () => {
  assert.match(voiceDirective('straight').toLowerCase(), /factual|plain|neutral/)
  assert.match(voiceDirective('warm').toLowerCase(), /warm|encouraging|friend/)
  assert.match(voiceDirective('witty').toLowerCase(), /witty|playful/)
})

test('unknown / undefined voice falls back to the default', () => {
  assert.equal(normalizeSummaryVoice(undefined), DEFAULT_SUMMARY_VOICE)
  assert.equal(normalizeSummaryVoice('nonsense'), DEFAULT_SUMMARY_VOICE)
  assert.equal(voiceDirective(undefined), voiceDirective(DEFAULT_SUMMARY_VOICE))
})

test('the picker samples cover exactly the offered voices', () => {
  const sampleVoices = VOICE_SAMPLES.map((s) => s.voice)
  assert.deepEqual([...sampleVoices].sort(), [...SUMMARY_VOICES].sort())
  for (const s of VOICE_SAMPLES) {
    assert.ok(s.sample.trim().length > 0)
    assert.ok(s.label.trim().length > 0)
  }
})
