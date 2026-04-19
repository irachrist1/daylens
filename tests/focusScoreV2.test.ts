import test from 'node:test'
import assert from 'node:assert/strict'
import { computeFocusScoreV2 } from '../src/main/lib/focusScore.ts'

test('computeFocusScoreV2 returns bounded zero-ish score for empty input', () => {
  const breakdown = computeFocusScoreV2({
    blocks: [],
    totalActiveSeconds: 0,
    switchesPerHour: 0,
  })
  assert.equal(breakdown.coherence, 0)
  assert.equal(breakdown.deepWork, 0)
  assert.equal(breakdown.artifactProgress, 0)
  assert.equal(breakdown.switchPenalty, 0)
  // With no evidence and no switches the (1 - switchPenalty) term still
  // contributes 0.20, so thin data never silently produces a misleading
  // high score but also never NaNs out.
  assert.ok(breakdown.score >= 0 && breakdown.score <= 100)
  assert.equal(breakdown.score, 20)
})

test('computeFocusScoreV2 rewards coherent deep-work blocks with artifact evidence', () => {
  const breakdown = computeFocusScoreV2({
    blocks: [
      { durationSeconds: 45 * 60, activeSeconds: 45 * 60 },
      { durationSeconds: 60 * 60, activeSeconds: 60 * 60 },
    ],
    totalActiveSeconds: 105 * 60,
    switchesPerHour: 4,
    uniqueArtifactCount: 8,
  })
  assert.ok(breakdown.coherence >= 0.9, `coherence was ${breakdown.coherence}`)
  assert.equal(breakdown.deepWork, 1)
  assert.ok(breakdown.artifactProgress > 0.6)
  assert.ok(breakdown.switchPenalty < 0.3)
  assert.ok(breakdown.score >= 80, `score was ${breakdown.score}`)
})

test('computeFocusScoreV2 penalizes rapid context switching even with long blocks', () => {
  const calm = computeFocusScoreV2({
    blocks: [{ durationSeconds: 45 * 60, activeSeconds: 45 * 60 }],
    totalActiveSeconds: 45 * 60,
    switchesPerHour: 0,
    uniqueArtifactCount: 4,
  })
  const chaotic = computeFocusScoreV2({
    blocks: [{ durationSeconds: 45 * 60, activeSeconds: 45 * 60 }],
    totalActiveSeconds: 45 * 60,
    switchesPerHour: 40,
    uniqueArtifactCount: 4,
  })
  assert.ok(chaotic.score < calm.score)
  assert.equal(chaotic.switchPenalty, 1)
})

test('computeFocusScoreV2 falls back to window-title diversity when artifacts are missing', () => {
  const noSignal = computeFocusScoreV2({
    blocks: [{ durationSeconds: 30 * 60, activeSeconds: 30 * 60 }],
    totalActiveSeconds: 30 * 60,
    switchesPerHour: 2,
  })
  const titleSignal = computeFocusScoreV2({
    blocks: [{ durationSeconds: 30 * 60, activeSeconds: 30 * 60 }],
    totalActiveSeconds: 30 * 60,
    switchesPerHour: 2,
    uniqueWindowTitleCount: 8,
  })
  assert.equal(noSignal.artifactProgress, 0)
  assert.ok(titleSignal.artifactProgress > 0.7)
  assert.ok(titleSignal.score > noSignal.score)
})

test('computeFocusScoreV2 clamps artifact_progress and handles huge counts', () => {
  const huge = computeFocusScoreV2({
    blocks: [{ durationSeconds: 60 * 60, activeSeconds: 60 * 60 }],
    totalActiveSeconds: 60 * 60,
    switchesPerHour: 0,
    uniqueArtifactCount: 100_000,
  })
  assert.equal(huge.artifactProgress, 1)
  assert.ok(huge.score <= 100)
})
