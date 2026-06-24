import assert from 'node:assert/strict'
import test from 'node:test'
import { userProfileDirective, appMatchesFocusList, categoryLabel } from '../src/shared/userProfile.ts'
import { isAppFocused } from '../src/main/lib/focusScore.ts'
import { workRhythmWindows } from '../src/main/lib/dailySummaryScheduler.ts'

test('userProfileDirective is empty for a blank profile (new users get clean prompts)', () => {
  assert.equal(userProfileDirective({}), '')
  assert.equal(userProfileDirective({ userName: '   ', userGoals: [], userClients: [''] }), '')
})

test('userProfileDirective folds in name, role, intent, interests, clients and rhythm', () => {
  const directive = userProfileDirective({
    userName: 'Sam',
    userRole: 'Designer, founder',
    userIntent: 'understand where my week goes',
    interestedCategories: ['design', 'development'],
    userClients: ['Acme', 'Globex'],
    workRhythm: 'night',
    focusApps: ['Figma'],
  })
  assert.match(directive, /Sam/)
  assert.match(directive, /Designer, founder/)
  assert.match(directive, /understand where my week goes/)
  assert.match(directive, /design/)
  assert.match(directive, /Acme/)
  assert.match(directive, /Globex/)
  assert.match(directive, /night owl/)
  assert.match(directive, /Figma/)
})

test('appMatchesFocusList matches by name or bundle id, case-insensitively and as a phrase', () => {
  assert.equal(appMatchesFocusList(['Figma'], 'com.figma.Desktop', 'Figma Desktop'), true)
  assert.equal(appMatchesFocusList(['com.figma.desktop'], 'com.figma.Desktop', 'Figma'), true)
  assert.equal(appMatchesFocusList(['Notion'], 'com.figma.Desktop', 'Figma Desktop'), false)
  assert.equal(appMatchesFocusList([], 'x', 'X'), false)
  assert.equal(appMatchesFocusList(undefined, 'x', 'X'), false)
})

test('isAppFocused: a focus-app makes an otherwise unfocused category count as real work', () => {
  // entertainment is not a focused category by default.
  assert.equal(isAppFocused('entertainment', 'tv.example', 'Example TV', undefined), false)
  assert.equal(isAppFocused('entertainment', 'tv.example', 'Example TV', ['Example TV']), true)
  // a focused category counts regardless of the focus-app list.
  assert.equal(isAppFocused('development', 'com.x', 'X', []), true)
})

test('workRhythmWindows shifts timing by rhythm, standard is unchanged', () => {
  assert.deepEqual(workRhythmWindows('standard'), { eveningWrapHour: 18, morningStartHour: 5, morningEndHour: 12, carryoverEndHour: 14 })
  assert.deepEqual(workRhythmWindows(undefined), workRhythmWindows('standard'))
  assert.ok(workRhythmWindows('early').eveningWrapHour < 18)
  assert.ok(workRhythmWindows('night').eveningWrapHour > 18)
})

test('categoryLabel gives human names', () => {
  assert.equal(categoryLabel('development'), 'coding')
  assert.equal(categoryLabel('design'), 'design')
})
