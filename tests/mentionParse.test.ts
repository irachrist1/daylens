import test from 'node:test'
import assert from 'node:assert/strict'
import { splitMentionSegments } from '../src/renderer/views/insights/mentionParse.ts'

// FB11: @-mentions serialize app/client tags with a leading @ so the sent message
// can re-chip them; day phrases serialize plain. The parser drives those chips.

test('a single app mention splits into a chip and trailing text', () => {
  const segments = splitMentionSegments('How long in @Ghostty this week')
  assert.deepEqual(segments, [
    { type: 'text', value: 'How long in ' },
    { type: 'mention', name: 'Ghostty' },
    { type: 'text', value: ' this week' },
  ])
})

test('multiple mentions are each chipped', () => {
  const segments = splitMentionSegments('@Cursor vs @Slack today')
  const mentions = segments.filter((s) => s.type === 'mention').map((s) => (s as { name: string }).name)
  assert.deepEqual(mentions, ['Cursor', 'Slack'])
})

test('plain text with no mention is a single text segment', () => {
  assert.deepEqual(splitMentionSegments('What did I do today?'), [{ type: 'text', value: 'What did I do today?' }])
})

test('an @ inside a token (email) is not treated as a mention', () => {
  const segments = splitMentionSegments('mail me at john@example.com please')
  assert.ok(segments.every((s) => s.type === 'text'), 'no chip from a mid-token @')
})

test('a mention at the very start is chipped', () => {
  const segments = splitMentionSegments('@Notion pages')
  assert.equal(segments[0].type, 'mention')
  assert.equal((segments[0] as { name: string }).name, 'Notion')
})
