// DEV-185: the propose_memory chat-agent tool. The proposal pauses the turn
// through the same askUser card machinery as file access; only an explicit
// confirmation persists. Proves the acceptance behaviors with a scripted
// answerer, no model involved:
//   confirm → the fact persists as supplied memory and is searchable;
//   decline → nothing persists, and the rejection suppresses re-proposal
//     WITHOUT showing the card again;
//   typed correction → the edited text persists (typing is the confirmation);
//   sensitive facts and already-saved facts are refused before any card;
//   the no-answer timeout saves nothing and records no decision.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { runMemoryProposal } from '../src/main/agent/memoryTools.ts'
import type { AgentQuestion } from '../src/main/agent/interactionTools.ts'
import {
  listSuppliedFacts,
  listMemoryProposalRejections,
} from '../src/main/services/suppliedMemory.ts'
import { getMemoryAudit } from '../src/main/services/workMemoryProfile.ts'
import { searchExact } from '../src/main/services/exactSearch.ts'

function scriptedAsker(answers: string[]) {
  const asked: AgentQuestion[] = []
  return {
    asked,
    askUser: async (question: AgentQuestion) => {
      asked.push(question)
      const answer = answers.shift()
      if (answer === undefined) throw new Error('askUser called more times than scripted')
      return answer
    },
  }
}

test('confirm persists the fact as supplied memory, searchable, with an audit entry', async () => {
  const db = createProductionTestDatabase()
  try {
    const asker = scriptedAsker(['Save to memory'])
    const outcome = await runMemoryProposal(
      { db, askUser: asker.askUser, threadId: 3 },
      { statement: 'You lead the pricing project.', futureUse: 'label pricing work correctly' },
    )
    assert.ok(outcome.saved)
    assert.equal(outcome.edited, false)

    assert.equal(asker.asked.length, 1)
    assert.match(asker.asked[0].question, /You lead the pricing project\./)
    assert.match(asker.asked[0].question, /label pricing work correctly/)
    assert.deepEqual(asker.asked[0].options, ['Save to memory', "Don't save"])

    const facts = listSuppliedFacts(db)
    assert.equal(facts.length, 1)
    assert.equal(facts[0].statement, 'You lead the pricing project.')
    assert.equal(facts[0].thread_id, 3)
    assert.equal(facts[0].source, 'chat')

    const hits = searchExact(db, 'pricing project').filter((result) => result.type === 'session')
    assert.equal(hits.length, 1)
    assert.equal(hits[0].sourceType, 'supplied')

    const audit = getMemoryAudit(db)
    assert.ok(audit.some((entry) => entry.action === 'remembered' && entry.source === 'chat'))
  } finally {
    db.close()
  }
})

test('decline persists nothing and suppresses re-proposal without showing the card again', async () => {
  const db = createProductionTestDatabase()
  try {
    const asker = scriptedAsker(["Don't save"])
    const declined = await runMemoryProposal(
      { db, askUser: asker.askUser },
      { statement: 'Fridays are focus days.' },
    )
    assert.equal(declined.saved, false)
    assert.equal(listSuppliedFacts(db).length, 0)
    assert.equal(listMemoryProposalRejections(db).length, 1)

    // Same fact again (case/punctuation differ): no card, no save.
    const again = await runMemoryProposal(
      { db, askUser: asker.askUser },
      { statement: 'fridays are focus days' },
    )
    assert.equal(again.saved, false)
    assert.match(again.saved === false ? again.reason : '', /previously declined/)
    assert.equal(asker.asked.length, 1, 'the card must not appear for a declined fact')
    assert.equal(listSuppliedFacts(db).length, 0)
  } finally {
    db.close()
  }
})

test('a typed correction saves the edited text — typing it is the confirmation', async () => {
  const db = createProductionTestDatabase()
  try {
    const asker = scriptedAsker(['You lead pricing AND packaging.'])
    const outcome = await runMemoryProposal(
      { db, askUser: asker.askUser },
      { statement: 'You lead the pricing project.' },
    )
    assert.ok(outcome.saved)
    assert.equal(outcome.edited, true)
    const facts = listSuppliedFacts(db)
    assert.equal(facts.length, 1)
    assert.equal(facts[0].statement, 'You lead pricing AND packaging.')
  } finally {
    db.close()
  }
})

test('sensitive facts are refused before any card appears', async () => {
  const db = createProductionTestDatabase()
  try {
    const asker = scriptedAsker([])
    const outcome = await runMemoryProposal(
      { db, askUser: asker.askUser },
      { statement: 'Your bank account number ends in 4411.' },
    )
    assert.equal(outcome.saved, false)
    assert.equal(asker.asked.length, 0)
    assert.equal(listSuppliedFacts(db).length, 0)
    assert.equal(listMemoryProposalRejections(db).length, 0)
  } finally {
    db.close()
  }
})

test('an already-saved fact is not proposed again', async () => {
  const db = createProductionTestDatabase()
  try {
    const first = scriptedAsker(['Save to memory'])
    await runMemoryProposal({ db, askUser: first.askUser }, { statement: 'You lead the pricing project.' })

    const second = scriptedAsker([])
    const outcome = await runMemoryProposal(
      { db, askUser: second.askUser },
      { statement: 'you lead the pricing project' },
    )
    assert.equal(outcome.saved, false)
    assert.match(outcome.saved === false ? outcome.reason : '', /Already saved/)
    assert.equal(second.asked.length, 0)
    assert.equal(listSuppliedFacts(db).length, 1)
  } finally {
    db.close()
  }
})

test('the no-answer timeout saves nothing and records no decision', async () => {
  const db = createProductionTestDatabase()
  try {
    const asker = scriptedAsker(['(No answer arrived — pick the most defensible reading, answer it, and say in one clause what you assumed.)'])
    const outcome = await runMemoryProposal(
      { db, askUser: asker.askUser },
      { statement: 'You lead the pricing project.' },
    )
    assert.equal(outcome.saved, false)
    assert.equal(listSuppliedFacts(db).length, 0)
    assert.equal(listMemoryProposalRejections(db).length, 0)
  } finally {
    db.close()
  }
})
