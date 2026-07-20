// The propose_memory tool (memory-and-entities.md §Conversational memory,
// DEV-185). When a conversation reveals a durable personal or work fact, the
// agent PROPOSES saving it: the proposed statement and its future use are
// shown through the same askUser card that gates file access, and nothing
// persists until the person confirms — "Save to memory" saves it, a typed
// correction saves the corrected text (typing it IS the confirmation), and a
// decline records a rejection so the same fact is not proposed again without
// new evidence. Secrets, credentials, health, and financial facts are refused
// before the card ever appears.
import { tool } from 'ai'
import { z } from 'zod'
import type Database from 'better-sqlite3'
import type { AgentQuestion } from './interactionTools'
import {
  confirmSuppliedFact,
  findMemoryProposalRejection,
  isSensitiveFactStatement,
  recordMemoryProposalRejection,
  recordSuppliedMemoryAudit,
  suppliedMemoryAvailable,
  normalizeStatementKey,
  listSuppliedFacts,
} from '../services/suppliedMemory'

export interface MemoryToolDeps {
  db: Database.Database
  askUser: (question: AgentQuestion) => Promise<string>
  threadId?: number | null
  signal?: AbortSignal
}

const SAVE_OPTION = 'Save to memory'
const DECLINE_OPTION = "Don't save"

const DECLINE_RE = /^(don'?t save|don'?t|no(pe|t now)?|no thanks?|never|deny|decline|cancel|skip|dismiss)\b/i

export type MemoryProposalOutcome =
  | { saved: true; factId: string; statement: string; edited: boolean; note: string }
  | { saved: false; reason: string }

export async function runMemoryProposal(
  deps: MemoryToolDeps,
  input: { statement: string; futureUse?: string },
): Promise<MemoryProposalOutcome> {
  const { db } = deps
  if (!suppliedMemoryAvailable(db)) {
    return { saved: false, reason: 'Memory storage is unavailable right now.' }
  }
  const statement = input.statement.trim().replace(/\s+/g, ' ')
  if (statement.length < 3) {
    return { saved: false, reason: 'The statement is too short to be a useful fact.' }
  }
  if (isSensitiveFactStatement(statement)) {
    return {
      saved: false,
      reason: 'This looks like a secret, credential, health, or financial detail. Daylens never saves those automatically — the user can add it by hand in Settings → Memory if they want it kept.',
    }
  }
  const key = normalizeStatementKey(statement)
  const alreadyKnown = listSuppliedFacts(db)
    .some((fact) => normalizeStatementKey(fact.statement) === key)
  if (alreadyKnown) {
    return { saved: false, reason: 'Already saved — this fact is in memory. Do not propose it again.' }
  }
  // A rejected proposal is not re-suggested without new evidence (spec
  // §Conversational memory) — the stored decision short-circuits BEFORE any
  // card interrupts the user again.
  if (findMemoryProposalRejection(db, statement)) {
    return {
      saved: false,
      reason: 'The user previously declined to save this. Do not propose it again unless they explicitly ask you to remember it.',
    }
  }

  if (deps.signal?.aborted) throw new Error('aborted')
  const futureUse = input.futureUse?.trim()
    || 'personalize answers and make it findable in search'
  const answer = await deps.askUser({
    question: `Want me to remember: “${statement}”? It would be used to ${futureUse}. You can also type a corrected version, and can edit or delete it any time in Settings → Memory.`,
    options: [SAVE_OPTION, DECLINE_OPTION],
    allowFreeText: true,
  })

  const normalized = answer.trim()
  // The no-answer timeout note arrives parenthesized — treat it as silence:
  // nothing saved, nothing recorded as declined.
  if (!normalized || normalized.startsWith('(')) {
    return { saved: false, reason: 'No answer — nothing was saved. Do not re-ask this turn.' }
  }
  const lower = normalized.toLowerCase()
  if (lower === SAVE_OPTION.toLowerCase() || /^(save( it)?|yes|remember( it| that)?)$/i.test(normalized)) {
    return persist(deps, statement, false)
  }
  if (lower === DECLINE_OPTION.toLowerCase() || DECLINE_RE.test(normalized)) {
    recordMemoryProposalRejection(db, { statement, threadId: deps.threadId ?? null })
    return {
      saved: false,
      reason: 'The user declined — nothing was saved, and this fact will not be proposed again. Acknowledge briefly and move on.',
    }
  }
  // Anything else the user typed is their corrected version of the fact —
  // typing it is the explicit confirmation.
  if (isSensitiveFactStatement(normalized)) {
    return {
      saved: false,
      reason: 'The edited version looks like a sensitive fact (secret, credential, health, or financial detail); it was not saved.',
    }
  }
  return persist(deps, normalized, true)
}

function persist(deps: MemoryToolDeps, statement: string, edited: boolean): MemoryProposalOutcome {
  const fact = confirmSuppliedFact(deps.db, {
    statement,
    source: 'chat',
    context: edited ? 'Confirmed in chat (edited before saving)' : 'Confirmed in chat',
    threadId: deps.threadId ?? null,
  })
  if (!fact) return { saved: false, reason: 'Nothing was saved.' }
  recordSuppliedMemoryAudit(deps.db, 'remembered', fact.statement, 'chat', fact.scope)
  return {
    saved: true,
    factId: fact.id,
    statement: fact.statement,
    edited,
    note: 'Saved. The user can see, edit, or delete this any time in Settings → Memory.',
  }
}

export function buildMemoryTools(deps: MemoryToolDeps) {
  return {
    propose_memory: tool({
      description: 'Offer to remember ONE durable personal or work fact the user just told you about themselves ("I lead the pricing project", "Fridays are focus days"). The user sees the exact statement plus how it would be used, and confirms, edits, or declines — nothing is saved without their confirmation (silence is not consent), so never claim to remember anything unless this tool returned saved: true. Use it sparingly: only when remembering the fact would clearly improve future answers, only for clearly durable facts the user stated about themselves or their work, never for questions, transient states, or anything you inferred. NEVER propose secrets, credentials, health, or financial details. Do not re-propose a fact this tool reported as declined or already saved.',
      inputSchema: z.object({
        statement: z.string().min(3).max(280)
          .describe('The fact as one short, plain sentence in second person, e.g. "You lead the pricing project."'),
        futureUse: z.string().max(160).optional()
          .describe('How Daylens would use it, in a few words, e.g. "label pricing work correctly"'),
      }),
      execute: async (input) => runMemoryProposal(deps, input),
    }),
  }
}
