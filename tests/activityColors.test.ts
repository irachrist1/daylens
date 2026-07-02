import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ACTIVITY_COLORS,
  ACTIVITY_COLOR_CHOICES,
  ACTIVITY_COLOR_GROUPS,
  activityColorForCategory,
  applyAppearanceSettings,
  leisureBlocksDimmed,
  sanitizeActivityColorOverrides,
  setActivityColorOverrides,
} from '../src/shared/activityColors.ts'
import type { AppCategory } from '../src/shared/types.ts'

test('sanitize keeps only known categories with well-formed hex values', () => {
  const clean = sanitizeActivityColorOverrides({
    development: '#22C55E',        // valid, normalized to lowercase
    entertainment: 'red',          // not a hex — dropped
    writing: '#12345',             // short hex — dropped
    notACategory: '#22c55e',       // unknown category — dropped
    meetings: ' #14b8a6 ',         // trims whitespace
  })
  assert.deepEqual(clean, { development: '#22c55e', meetings: '#14b8a6' })
})

test('sanitize returns empty for junk input', () => {
  assert.deepEqual(sanitizeActivityColorOverrides(null), {})
  assert.deepEqual(sanitizeActivityColorOverrides('nope'), {})
  assert.deepEqual(sanitizeActivityColorOverrides(['#22c55e']), {})
})

test('an override wins over the default, and clearing restores it', () => {
  setActivityColorOverrides({ development: '#22c55e' })
  assert.equal(activityColorForCategory('development'), '#22c55e')
  assert.equal(activityColorForCategory('writing'), ACTIVITY_COLORS.writing, 'other categories keep their defaults')
  setActivityColorOverrides({})
  assert.equal(activityColorForCategory('development'), ACTIVITY_COLORS.development)
})

test('applyAppearanceSettings applies colors and the leisure dim flag together', () => {
  applyAppearanceSettings({ activityColorOverrides: { entertainment: '#f97316' }, dimLeisureBlocks: false })
  assert.equal(activityColorForCategory('entertainment'), '#f97316')
  assert.equal(leisureBlocksDimmed(), false)
  applyAppearanceSettings({ activityColorOverrides: {}, dimLeisureBlocks: undefined })
  assert.equal(activityColorForCategory('entertainment'), ACTIVITY_COLORS.entertainment)
  assert.equal(leisureBlocksDimmed(), true, 'dimming defaults ON when the setting is unset')
})

test('the color groups cover every customizable category exactly once', () => {
  const seen = new Set<AppCategory>()
  for (const group of ACTIVITY_COLOR_GROUPS) {
    for (const category of group.categories) {
      assert.ok(!seen.has(category), `${category} appears in two groups`)
      seen.add(category)
    }
    assert.ok(
      ACTIVITY_COLOR_CHOICES.some((choice) => choice.hex.toLowerCase() === group.defaultColor.toLowerCase()),
      `${group.id} default ${group.defaultColor} must be offered in the palette so picking it equals reset`,
    )
    for (const category of group.categories) {
      assert.equal(ACTIVITY_COLORS[category], group.defaultColor, `${category} default must match its group`)
    }
  }
  // Every category except the deliberately-neutral pair is customizable.
  const neutral: AppCategory[] = ['system', 'uncategorized']
  for (const category of Object.keys(ACTIVITY_COLORS) as AppCategory[]) {
    if (neutral.includes(category)) {
      assert.ok(!seen.has(category), `${category} is neutral and must not be customizable`)
    } else {
      assert.ok(seen.has(category), `${category} is missing from the color groups`)
    }
  }
})
