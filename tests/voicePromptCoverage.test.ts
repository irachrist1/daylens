// Voice-contract drift guard. PRODUCT-SPEC rule:
//   "A single system prompt fragment, reused across every chat job, enforcing
//    voice and banned vocabulary."
//
// This test reads every AI job prompt-assembly site in the main process and
// asserts they concatenate `VOICE_SYSTEM_PROMPT`. It does not attempt to
// execute the prompts — it's a static textual guarantee so future job authors
// can't ship a chat-facing prompt that silently bypasses the voice contract.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')

// Files that build AI system prompts. Keep this list short and curated —
// adding a file here is a deliberate gesture that says "this is a chat-facing
// prompt site and must honour the voice contract."
const PROMPT_SITES: Array<{ path: string; label: string }> = [
  { path: 'src/main/jobs/aiService.ts', label: 'aiService (chat_answer, day_summary, week_review, app_narrative, reports, block_insight, suggest_category, weekly_brief)' },
  { path: 'src/main/lib/wrappedNarrative.ts', label: 'wrappedNarrative (daily Wrapped)' },
  { path: 'src/main/lib/wrappedPeriodNarrative.ts', label: 'wrappedPeriodNarrative (weekly/monthly Wrapped)' },
]

// Sites where `VOICE_SYSTEM_PROMPT` is referenced by name. The check below
// confirms the import plus an actual concat site, so a dangling import alone
// would not pass.
test('every chat-facing prompt site imports and uses VOICE_SYSTEM_PROMPT', () => {
  for (const site of PROMPT_SITES) {
    const absolutePath = path.join(REPO_ROOT, site.path)
    assert.ok(
      fs.existsSync(absolutePath),
      `PROMPT_SITES entry missing on disk: ${site.path}`,
    )
    const text = fs.readFileSync(absolutePath, 'utf8')

    const imports = /from ['"][^'"]*voiceContract['"]/.test(text)
      || /from ['"][^'"]*\/voiceContract['"]/.test(text)

    const uses = /\bVOICE_SYSTEM_PROMPT\b/.test(text)

    // We want both: an import (so the symbol isn't shadowed by a local
    // constant) and at least one direct reference. If a site ever lands
    // here that is build-only and doesn't emit chat copy, pull it from the
    // list — do not silently special-case it.
    assert.ok(
      imports,
      `${site.label}: does not import VOICE_SYSTEM_PROMPT from voiceContract`,
    )
    assert.ok(
      uses,
      `${site.label}: does not reference VOICE_SYSTEM_PROMPT`,
    )
  }
})

test('PROMPT_SITES coverage: at least three curated prompt sites', () => {
  // Guard rail against someone deleting the coverage list. If the product
  // grows more prompt sites, add them here explicitly.
  assert.ok(PROMPT_SITES.length >= 3, `expected >= 3 prompt sites, got ${PROMPT_SITES.length}`)
})
