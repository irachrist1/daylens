import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeIpcError } from '../src/renderer/lib/ipcError.ts'

// R4: no user-visible string may contain "remote method" or a channel name.

test('strips the Electron IPC remote-method prefix and nested Error: tokens', () => {
  const error = new Error("Error invoking remote method 'ai:send-message': Error: Your AI provider's rate limit was hit. Wait a moment and try again.")
  const result = sanitizeIpcError(error)
  assert.ok(!/remote method|ai:send-message/.test(result.message))
  assert.ok(result.message.startsWith("Your AI provider's rate limit"))
  assert.equal(result.isRateLimit, true)
})

test('strips the timeline rebuild channel name (T1)', () => {
  const error = new Error("Error invoking remote method 'db:rebuild-timeline-day': Error: AI re-analysis failed: Google Gemini quota exceeded.")
  const result = sanitizeIpcError(error, 'AI re-analysis failed. Try again.')
  assert.ok(!/remote method|db:rebuild-timeline-day/.test(result.message))
  assert.ok(result.message.includes('AI re-analysis failed'))
  assert.equal(result.isRateLimit, true) // "quota exceeded" classifies as rate limit
})

test('extracts retryAfterSeconds from "try again in about Ns"', () => {
  const error = new Error("Error invoking remote method 'ai:send-message': Error: Rate limit hit. Try again in about 18s.")
  const result = sanitizeIpcError(error)
  assert.equal(result.retryAfterSeconds, 18)
  assert.equal(result.isRateLimit, true)
})

test('falls back when the message is empty or only channel scaffolding', () => {
  assert.equal(sanitizeIpcError(new Error('')).message, 'Something went wrong. Please try again.')
  const result = sanitizeIpcError(new Error("Error invoking remote method 'x:y':"), 'custom fallback')
  assert.equal(result.message, 'custom fallback')
})

test('classifies a non-rate-limit error and preserves its message', () => {
  const error = new Error("Error invoking remote method 'ai:send-message': Error: The AI returned an empty response. Please try again.")
  const result = sanitizeIpcError(error)
  assert.equal(result.isRateLimit, false)
  assert.equal(result.message, 'The AI returned an empty response. Please try again.')
})
