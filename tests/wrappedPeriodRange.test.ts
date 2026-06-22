// Pure date math for the period wraps — ranges, labels, buckets.
import test from 'node:test'
import assert from 'node:assert/strict'
import { computePeriodRange } from '../src/main/lib/wrappedPeriodRange.ts'

test('week: rolling 7-day window ending on the anchor', () => {
  const r = computePeriodRange('week', '2026-06-22') // Monday
  assert.equal(r.startDate, '2026-06-16')
  assert.equal(r.endDate, '2026-06-22')
  assert.equal(r.buckets.length, 7)
  // Previous week is the seven days immediately before.
  assert.equal(r.prevEndDate, '2026-06-15')
  assert.equal(r.prevStartDate, '2026-06-09')
})

test('week: dayLabel returns weekday names', () => {
  const r = computePeriodRange('week', '2026-06-22')
  assert.equal(r.dayLabel('2026-06-22'), 'Mon')
  assert.equal(r.dayLabel('2026-06-21'), 'Sun')
})

test('month: spans the calendar month and labels it', () => {
  const r = computePeriodRange('month', '2026-06-14')
  assert.equal(r.startDate, '2026-06-01')
  assert.equal(r.endDate, '2026-06-30')
  assert.equal(r.prevStartDate, '2026-05-01')
  assert.equal(r.prevEndDate, '2026-05-31')
  assert.equal(r.rangeLabel, 'June 2026')
  // Weeks within the month, in order.
  assert.ok(r.buckets.length >= 4 && r.buckets.length <= 6)
  assert.ok(r.buckets[0].label.startsWith('Week of'))
})

test('year: 12 month buckets and a year label', () => {
  const r = computePeriodRange('year', '2026-06-14')
  assert.equal(r.startDate, '2026-01-01')
  assert.equal(r.endDate, '2026-12-31')
  assert.equal(r.prevStartDate, '2025-01-01')
  assert.equal(r.prevEndDate, '2025-12-31')
  assert.equal(r.rangeLabel, '2026')
  assert.equal(r.buckets.length, 12)
  assert.equal(r.buckets[0].label, 'Jan')
  assert.equal(r.buckets[11].label, 'Dec')
})

test('month buckets never spill past the month end', () => {
  const r = computePeriodRange('month', '2026-02-10') // Feb 2026, 28 days
  assert.equal(r.endDate, '2026-02-28')
  for (const b of r.buckets) {
    assert.ok(b.endDate <= '2026-02-28', `bucket ${b.label} ends ${b.endDate}`)
    assert.ok(b.startDate >= '2026-02-01', `bucket ${b.label} starts ${b.startDate}`)
  }
})
