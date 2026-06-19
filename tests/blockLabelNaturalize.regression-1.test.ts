import test from 'node:test'
import assert from 'node:assert/strict'
import { naturalizeLabel } from '../src/shared/blockLabel.ts'

// Regression: ISSUE-QA-002 — hyphenated activity names were cut at the hyphen.
// Found by /qa on 2026-06-19.
// Report: artifacts/timeline-v2/qa-2026-06-19/
test('naturalizeLabel preserves hyphenated words in activity labels', () => {
  assert.equal(
    naturalizeLabel('Troubleshooting iPhone 12 Wi-Fi connectivity'),
    'Troubleshooting iPhone 12 Wi-Fi connectivity',
  )
  assert.equal(
    naturalizeLabel('Reviewing machine learning pipeline pre-read materials'),
    'Reviewing machine learning pipeline pre-read materials',
  )
})

test('naturalizeLabel still removes spaced browser-title suffixes', () => {
  assert.equal(
    naturalizeLabel('Timeline rework - Safari'),
    'Timeline rework',
  )
})
