import test from 'node:test'
import assert from 'node:assert/strict'
import { renderTimeChunkAnswer } from '../src/main/agent/timeChunkAnswer.ts'

test('time chunk answers preserve every exact row without merging gaps', () => {
  const answer = renderTimeChunkAnswer({
    found: true,
    date: '2026-07-06',
    incrementMinutes: 30,
    chunks: [
      { startTime: '03:30', endTime: '04:00', durationMinutes: 30, activity: [], pages: [], gap: { label: 'machine asleep/locked' } },
      { startTime: '04:00', endTime: '04:30', durationMinutes: 30, activity: [], pages: [], gap: { label: 'machine asleep/locked' } },
      { startTime: '04:30', endTime: '05:00', durationMinutes: 30, activity: [{ appName: 'Editor', windowTitle: 'Project review', seconds: 1800 }], pages: [], gap: null },
    ],
  })
  assert.ok(answer)
  assert.match(answer!, /Monday, July 6/)
  assert.match(answer!, /03:30–04:00/)
  assert.match(answer!, /04:00–04:30/)
  assert.match(answer!, /04:30–05:00/)
  assert.doesNotMatch(answer!, /03:30–04:30/)
})

test('time chunk answers hide internal action syntax and deduplicate activity', () => {
  const answer = renderTimeChunkAnswer({
    found: true,
    date: '2026-07-06',
    incrementMinutes: 30,
    chunks: [{
      startTime: '09:00',
      endTime: '09:30',
      durationMinutes: 30,
      activity: [
        { appName: 'Terminal', windowTitle: 'Wants to run AskUserQuestion: {"questions":[]}', seconds: 900 },
        { appName: 'Editor', windowTitle: 'Project review', seconds: 600 },
        { appName: 'Editor', windowTitle: 'Project review', seconds: 300 },
      ],
      pages: [],
      gap: null,
    }],
  })
  assert.ok(answer)
  assert.doesNotMatch(answer!, /AskUserQuestion|Wants to run/)
  assert.equal(answer!.match(/Editor — Project review/g)?.length, 1)
})
