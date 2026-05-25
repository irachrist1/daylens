// Tests for C4: hard cap on context blobs feeding the CLI legacy system prompt.
// Tool-calling providers do not use this helper; CLI providers do, and heavy
// days can otherwise grow the prompt unboundedly.
import test from 'node:test'
import assert from 'node:assert/strict'
import { capContextBlock, CLI_CONTEXT_CHAR_CAP } from '../src/main/lib/contextCap'

test('capContextBlock returns short input unchanged', () => {
  assert.equal(capContextBlock(''), '')
  assert.equal(capContextBlock('hello'), 'hello')
  const short = 'a'.repeat(CLI_CONTEXT_CHAR_CAP - 1)
  assert.equal(capContextBlock(short), short)
})

test('capContextBlock returns input at the exact cap unchanged', () => {
  const exact = 'a'.repeat(CLI_CONTEXT_CHAR_CAP)
  assert.equal(capContextBlock(exact), exact)
})

test('capContextBlock truncates oversize input and appends a truncation note', () => {
  const oversize = 'x'.repeat(CLI_CONTEXT_CHAR_CAP + 5_000)
  const result = capContextBlock(oversize)
  assert.ok(result.length <= CLI_CONTEXT_CHAR_CAP, `result length ${result.length} > cap ${CLI_CONTEXT_CHAR_CAP}`)
  assert.match(result, /\[context truncated — \d+ chars dropped/)
})

test('capContextBlock reports the correct number of dropped chars', () => {
  const overBy = 3_456
  const oversize = 'y'.repeat(CLI_CONTEXT_CHAR_CAP + overBy)
  const result = capContextBlock(oversize)
  const match = result.match(/\[context truncated — (\d+) chars dropped/)
  assert.ok(match, `truncation note missing from output: ${result.slice(-200)}`)
  const dropped = Number(match[1])
  // Truncation reserves ~80 chars for the note itself, so the reported drop
  // includes those reserve chars plus the excess.
  assert.ok(dropped >= overBy, `dropped count ${dropped} should be >= raw excess ${overBy}`)
})

test('capContextBlock honors a custom cap override', () => {
  const result = capContextBlock('a'.repeat(500), 100)
  assert.ok(result.length <= 100, `expected length <= 100, got ${result.length}`)
  assert.match(result, /\[context truncated/)
})
