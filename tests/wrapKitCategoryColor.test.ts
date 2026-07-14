import test from 'node:test'
import assert from 'node:assert/strict'
import { categoryColor } from '../src/renderer/components/wrap/wrapKit.tsx'
import { ACTIVITY_COLORS, activityColorForCategory, setActivityColorOverrides } from '../src/shared/activityColors.ts'
import type { AppCategory } from '../src/shared/types.ts'

// wrapKit's categoryColor used to carry its own hardcoded CAT_COLOR palette,
// completely disconnected from Settings → General → Activity colors. Week/
// month/year Wrapped's peak-hours bar chart (PeriodWrapped.tsx) reads this
// function, so a custom color override there never showed up — the one
// confirmed render-layer divergence in the "Week view ignores configured
// colors" bug. This pins that categoryColor now delegates to the same
// Settings-aware resolver everywhere else (Day view, Week calendar tab)
// already uses.

const CATEGORIES = Object.keys(ACTIVITY_COLORS) as AppCategory[]

test('categoryColor reflects a Settings override for every category, not a hardcoded default', () => {
  const override = '#123456' // not equal to any category's default hex
  const overrides = Object.fromEntries(CATEGORIES.map((category) => [category, override]))
  setActivityColorOverrides(overrides)
  try {
    for (const category of CATEGORIES) {
      assert.equal(
        categoryColor(category),
        activityColorForCategory(category),
        `categoryColor('${category}') must agree with the shared resolver`,
      )
      assert.equal(
        categoryColor(category),
        override,
        `categoryColor('${category}') must reflect the Settings override, not a built-in default`,
      )
    }
  } finally {
    setActivityColorOverrides({})
  }
})

test('categoryColor still special-cases leisure/personal work-kind and the unknown sentinel', () => {
  setActivityColorOverrides({ entertainment: '#123456' })
  try {
    // Kind overrides win regardless of category or Settings.
    assert.equal(categoryColor('development', 'leisure'), '#ff6b6b')
    assert.equal(categoryColor('development', 'personal'), '#9aa6c2')
    // The 'unknown' sentinel (not a real AppCategory) resolves through the
    // shared neutral default rather than its own hardcoded hex.
    assert.equal(categoryColor('unknown'), activityColorForCategory('uncategorized'))
  } finally {
    setActivityColorOverrides({})
  }
})
