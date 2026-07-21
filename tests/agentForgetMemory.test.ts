// Forgetting a saved memory through the agent (DEV-199; ai-agent.md
// §Daylens actions — "forget a saved conversational memory"). What must hold:
//   - the saved fact resolves by text (exact or unique partial match);
//   - the confirmation card shows the EXACT statement; only an explicit
//     confirmation deletes it — keep, silence, and free text leave it saved;
//   - deletion is Settings-parity: the fact leaves supplied memory and the
//     audit records a chat-sourced 'forgot';
//   - misses are explicit and name the real roster, never a throw.
import test from 'node:test'
import assert from 'node:assert/strict'
import type Database from 'better-sqlite3'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { runForgetMemory, type MemoryToolDeps } from '../src/main/agent/memoryTools.ts'
import { confirmSuppliedFact, listSuppliedFacts } from '../src/main/services/suppliedMemory.ts'
import type { AgentQuestion } from '../src/main/agent/interactionTools.ts'

function seed(db: Database.Database, statements: string[]): void {
  for (const statement of statements) {
    const fact = confirmSuppliedFact(db, { statement, source: 'chat', context: 'test', threadId: null })
    assert.ok(fact, `fixture fact failed to save: ${statement}`)
  }
}

function deps(db: Database.Database, answer: string, questions: AgentQuestion[] = []): MemoryToolDeps {
  return {
    db,
    askUser: async (question) => {
      questions.push(question)
      return answer
    },
  }
}

function auditActions(db: Database.Database): Array<{ action: string; source: string }> {
  return db.prepare(`SELECT action, source FROM memory_audit ORDER BY created_at ASC`)
    .all() as Array<{ action: string; source: string }>
}

test('confirming forgets the fact, removes it from memory, and audits a chat-sourced forgot', async () => {
  const db = createProductionTestDatabase()
  seed(db, ['You lead the pricing project.', 'Fridays are focus days.'])
  const questions: AgentQuestion[] = []

  const outcome = await runForgetMemory(deps(db, 'Forget it', questions), { statement: 'pricing project' })
  assert.equal(outcome.forgotten, true)
  assert.equal((outcome as { statement: string }).statement, 'You lead the pricing project.')

  assert.equal(questions.length, 1)
  assert.match(questions[0].question, /You lead the pricing project\./, 'the card shows the exact statement')
  assert.deepEqual(questions[0].options, ['Forget it', 'Keep it'])

  const remaining = listSuppliedFacts(db).map((fact) => fact.statement)
  assert.deepEqual(remaining, ['Fridays are focus days.'])
  assert.ok(auditActions(db).some((row) => row.action === 'forgot' && row.source === 'chat'))
  db.close()
})

test('keep, silence, and free text all leave the memory saved', async () => {
  const db = createProductionTestDatabase()
  seed(db, ['You lead the pricing project.'])
  for (const answer of ['Keep it', '(No answer is available right now.)', 'actually it is the platform project']) {
    const outcome = await runForgetMemory(deps(db, answer), { statement: 'pricing project' })
    assert.equal(outcome.forgotten, false, `answer "${answer}" must not forget`)
    assert.equal(listSuppliedFacts(db).length, 1)
  }
  assert.ok(!auditActions(db).some((row) => row.action === 'forgot'))
  db.close()
})

test('misses are explicit: nothing saved, no match (naming the roster), and ambiguity (naming candidates)', async () => {
  const db = createProductionTestDatabase()
  const empty = await runForgetMemory(deps(db, 'Forget it'), { statement: 'anything' })
  assert.equal(empty.forgotten, false)
  assert.match(String((empty as { reason: string }).reason), /nothing to forget/i)

  seed(db, ['You lead the pricing project.', 'Your pricing reviews happen on Mondays.'])
  const questions: AgentQuestion[] = []

  const noMatch = await runForgetMemory(deps(db, 'Forget it', questions), { statement: 'the design system' })
  assert.equal(noMatch.forgotten, false)
  assert.match(String((noMatch as { reason: string }).reason), /You lead the pricing project\./, 'the miss names the real roster')

  const ambiguous = await runForgetMemory(deps(db, 'Forget it', questions), { statement: 'pricing' })
  assert.equal(ambiguous.forgotten, false)
  assert.match(String((ambiguous as { reason: string }).reason), /Several saved facts match/)

  assert.equal(questions.length, 0, 'no card is ever shown for a miss')
  assert.equal(listSuppliedFacts(db).length, 2)
  db.close()
})
