import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import {
  appendConversationMessage,
  getConversationMessages,
  getOrCreateConversation,
  updateAIMessageFeedback,
} from '../src/main/db/queries.ts'
import {
  buildAIFeedbackUploadPayload,
  redactFeedbackText,
  uploadRatedAIMessageFeedback,
} from '../src/main/services/aiFeedbackUpload.ts'

function setupRatedTurn() {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  const conversationId = getOrCreateConversation(db)
  const user = appendConversationMessage(
    db,
    conversationId,
    'user',
    'Can you review /Users/tonny/secret/project.md and email tonny@example.com? My key is sk-ant-abc123456789012345678.',
    { createdAt: 1000 },
  )
  const assistant = appendConversationMessage(db, conversationId, 'assistant', 'From your app sessions: you had the planning doc open.', {
    createdAt: 1100,
    metadata: { answerKind: 'freeform_chat' },
  })
  updateAIMessageFeedback(db, assistant.id, 'down')
  return { db, conversationId, user, assistant }
}

test('redactFeedbackText removes sensitive strings and enforces excerpt length', () => {
  const result = redactFeedbackText(
    'Open https://example.com and /Users/tonny/file.txt with person@example.com and sk-test12345678901234567890',
    40,
  )

  assert.equal(result.redacted, true)
  assert.equal(result.truncated, true)
  assert.equal(result.text.includes('example.com'), false)
  assert.equal(result.text.includes('/Users/tonny'), false)
  assert.equal(result.text.includes('person@example.com'), false)
  assert.ok(result.text.length <= 40)
})

test('buildAIFeedbackUploadPayload pairs rated assistant turn with prior user prompt', async () => {
  const { db, user, assistant } = setupRatedTurn()

  const payload = await buildAIFeedbackUploadPayload(db, assistant.id, 'down', {
    getClientId: async () => 'client-1',
    getAppVersion: () => '1.0.0',
    getPlatform: () => 'darwin',
    now: () => 2000,
  })

  assert.ok(payload)
  assert.equal(payload.rating, 'down')
  assert.equal(payload.clientId, 'client-1')
  assert.equal(payload.userMessageId, user.id)
  assert.equal(payload.assistantMessageId, assistant.id)
  assert.equal(payload.answerKind, 'freeform_chat')
  assert.equal(payload.provider, null)
  assert.equal(payload.model, null)
  assert.equal(payload.redacted, true)
  assert.equal(payload.userPromptExcerpt?.includes('/Users/tonny'), false)
  assert.equal(payload.userPromptExcerpt?.includes('tonny@example.com'), false)
  assert.equal(payload.userPromptExcerpt?.includes('sk-ant'), false)

  db.close()
})

test('uploadRatedAIMessageFeedback skips when disabled or rating is cleared', async () => {
  const { db, assistant } = setupRatedTurn()
  const calls: string[] = []
  const fetch = async (url: string) => {
    calls.push(url)
    return new Response('{}', { status: 200 })
  }

  await uploadRatedAIMessageFeedback(db, assistant.id, 'down', {
    fetch,
    getSettings: () => ({ shareAIFeedbackExamples: false }),
    getClientId: async () => 'client-1',
    getSiteUrl: () => 'https://example.test',
  })
  await uploadRatedAIMessageFeedback(db, assistant.id, null, {
    fetch,
    getSettings: () => ({ shareAIFeedbackExamples: true }),
    getClientId: async () => 'client-1',
    getSiteUrl: () => 'https://example.test',
    warn: () => {},
  })

  assert.deepEqual(calls, [])
  db.close()
})

test('feedback upload failure does not undo local rating persistence', async () => {
  const { db, conversationId, assistant } = setupRatedTurn()

  await uploadRatedAIMessageFeedback(db, assistant.id, 'down', {
    fetch: async () => {
      throw new Error('offline')
    },
    getSettings: () => ({ shareAIFeedbackExamples: true }),
    getClientId: async () => 'client-1',
    getSiteUrl: () => 'https://example.test',
  })

  const history = getConversationMessages(db, conversationId)
  assert.equal(history.find((message) => message.id === assistant.id)?.rating, 'down')
  db.close()
})
