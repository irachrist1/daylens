import test from 'node:test'
import assert from 'node:assert/strict'
import { looksLikeRawArtifactLabel } from '../src/shared/blockLabel.ts'

// Rejected: mangled machine identifiers that must never be a block name.
test('rejects SCREAMING and SCREAMING-KEBAB stems (the "AGENT" bug)', () => {
  assert.equal(looksLikeRawArtifactLabel('AGENT'), true)
  assert.equal(looksLikeRawArtifactLabel('AGENT-EXECUTION-PLAN'), true)
  assert.equal(looksLikeRawArtifactLabel('AGENT-EXECUTION-PLAN.md'), true)
  assert.equal(looksLikeRawArtifactLabel(''), true)
  assert.equal(looksLikeRawArtifactLabel(null), true)
})

// Allowed: the existing filename / path / repo label design (blockOwnership and
// workBlockSplitting tests) and real human titles. Humanizing these into clean
// "verb + object" names is the AI naming path, a separate decision.
test('keeps ordinary filenames, paths, repo names, and human titles', () => {
  assert.equal(looksLikeRawArtifactLabel('insightsQueryRouter.ts'), false)
  assert.equal(looksLikeRawArtifactLabel('src/main/services/workBlocks.ts'), false)
  assert.equal(looksLikeRawArtifactLabel('daylens'), false)
  assert.equal(looksLikeRawArtifactLabel('slides.md'), false)
  assert.equal(looksLikeRawArtifactLabel('Configuring the work network'), false)
  assert.equal(looksLikeRawArtifactLabel('Q3 Planning'), false)
})
