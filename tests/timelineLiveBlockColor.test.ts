import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

// timeline.md §3.4 rule 4: color coding is universal, live or finalized —
// only the block NAME stays neutral while live (§4). CalendarBlockCard used
// to override every provisional block to a hardcoded grey (#8b93a7)
// regardless of its computed dominantCategory, so "Active now" / "Earlier
// today" blocks never showed their real category color until Analyze ran.
// This pins that the accent always resolves through the shared,
// Settings-aware color function instead of special-casing provisional
// blocks to a fixed hex.
test('CalendarBlockCard does not special-case provisional blocks to a hardcoded grey accent', () => {
  const source = readSource('src/renderer/views/Timeline.tsx')

  assert.doesNotMatch(source, /block\.provisional \? ['"]#[0-9a-fA-F]{6}['"]/)
  assert.match(
    source,
    /const accent = activityColorForCategory\(block\.dominantCategory\)/,
  )
})

// Day, Week, and Month are not three independent implementations — they are
// three renderers over the same block facts (invariant 7, "one truth, three
// views"). This is *why* the CalendarBlockCard fix above was enough on its
// own: Week reuses that exact component (no week-only color branch to drift
// out of sync), and Month's live-day dots read dominantCategory directly
// with no provisional branch at all. These pins make sure neither surface
// grows its own copy of the grey-override bug later.
test('week view renders blocks through the same CalendarBlockCard as day view, not a parallel color path', () => {
  const source = readSource('src/renderer/views/Timeline.tsx')

  const cardCallSites = source.match(/<CalendarBlockCard/g) ?? []
  assert.equal(cardCallSites.length, 1, 'day and week must share one CalendarBlockCard call site')
})

test('month view live-day dots do not special-case provisional blocks either', () => {
  const source = readSource('src/renderer/views/Timeline.tsx')
  const monthViewStart = source.indexOf('function CalendarMonthView')
  assert.notEqual(monthViewStart, -1, 'CalendarMonthView must exist')
  const monthViewSource = source.slice(monthViewStart)

  assert.doesNotMatch(monthViewSource, /block\.provisional \? ['"]#[0-9a-fA-F]{6}['"]/)
  assert.match(monthViewSource, /activityColorForCategory\(block\.dominantCategory\)/)
})
