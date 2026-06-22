// R1 gate: run the 4 AI-tab starter prompts
// back-to-back against the REAL Gemini key in keytar, each as the first message
// of a brand-new chat (threadId: null) — the worst case for the per-minute
// budget. Proves the reliability pass holds on a free/low-tier Gemini key:
//
//   - no surfaced rate-limit error (transient 429s must auto-recover), AC#1/#4
//   - median provider calls/turn <= 2,                                  AC#2
//   - the first message of a new chat returns a real answer.            AC#4
//
// This bills the live Gemini API (a few flash-lite calls). Run with:
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron \
//     --loader ./tests/support/ts-loader-real.mjs \
//     ./tests/ai-behaviour/r1-starter-check.ts

import fs from 'node:fs'
import path from 'node:path'
import { stageReadOnlyCopyOfRealDb, cleanupRealDbCopy } from './realDb'
import { isRateLimitError } from '../../src/main/services/aiRateLimiter'

// Mirror of AIWorkspace.tsx STARTER_PROMPTS — keep in sync.
const STARTER_PROMPTS = [
  'What did I work on today?',
  'Summarize my last 7 days by project.',
  'When was I most focused this week?',
  "Export today's work sessions as CSV.",
]

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

async function main(): Promise<void> {
  console.log('\n=== R1 starter-prompt gate (real Gemini) ===\n')

  const dbCtx = stageReadOnlyCopyOfRealDb()
  console.log(`[setup] real DB copy: ${dbCtx.copiedDbPath}`)

  const { initDb } = await import('../../src/main/services/database')
  initDb()

  const { getApiKey, setSettings } = await import('../../src/main/services/settings')
  const googleKey = await getApiKey('google')
  if (!googleKey) {
    console.error('[fatal] No Google/Gemini key in keytar. Open Daylens → Settings → AI and save your Gemini key, then re-run.')
    cleanupRealDbCopy(dbCtx)
    process.exit(2)
  }
  // Some provider paths also honor the env var; set it so nothing falls back to
  // another provider mid-run.
  process.env.GOOGLE_API_KEY = googleKey
  process.env.GEMINI_API_KEY = googleKey

  // Pin the selected provider to google. Every surface — the answer, the
  // executing provider, follow-ups, titles, report/export — now routes through
  // `aiProvider` (invariant #12), so one key covers them all.
  try {
    await setSettings({
      aiProvider: 'google',
      aiChatProvider: 'google',
    })
  } catch (e) {
    console.warn(`[setup] could not pin provider: ${e instanceof Error ? e.message : String(e)}`)
  }
  console.log('[setup] pinned provider → google; key loaded from keytar\n')

  const { sendMessage } = await import('../../src/main/jobs/aiService')

  // Diagnostic knobs: run only the first prompt, and/or wait for the
  // per-minute window to reset before sending so a SINGLE cold turn is
  // isolated from back-to-back saturation.
  const onlyFirst = process.env.R1_ONLY_FIRST === '1'
  const warmupWaitMs = Number(process.env.R1_WARMUP_WAIT_MS ?? 0)
  const prompts = onlyFirst ? STARTER_PROMPTS.slice(0, 1) : STARTER_PROMPTS
  if (warmupWaitMs > 0) {
    console.log(`[setup] waiting ${Math.round(warmupWaitMs / 1000)}s for the rate window to reset…\n`)
    await new Promise((r) => setTimeout(r, warmupWaitMs))
  }

  const rows: Array<{
    prompt: string
    ok: boolean
    rateLimited: boolean
    providerCalls: number | null
    answerKind: string | null
    durationMs: number
    preview: string
  }> = []

  // Back-to-back, no artificial gap — the throttle/retry must absorb the burst.
  for (let i = 0; i < prompts.length; i += 1) {
    const prompt = prompts[i]
    console.log(`[${i + 1}/${prompts.length}] new chat → ${prompt}`)
    const t0 = Date.now()
    try {
      const result = await sendMessage({ message: prompt, threadId: null })
      const durationMs = Date.now() - t0
      const text = result.assistantMessage.content ?? ''
      const providerError = Boolean((result.assistantMessage as { providerError?: boolean }).providerError)
      const preview = text.replace(/\s+/g, ' ').slice(0, 160)
      rows.push({
        prompt,
        ok: !providerError && text.trim().length > 0,
        rateLimited: providerError && /rate|limit|quota|requests per/i.test(text),
        providerCalls: result.providerCallCount ?? null,
        answerKind: result.assistantMessage.answerKind ?? null,
        durationMs,
        preview,
      })
      console.log(`     calls=${result.providerCallCount ?? '?'} kind=${result.assistantMessage.answerKind ?? '-'} ${durationMs}ms`)
      console.log(`     A: ${preview}${text.length > 160 ? '…' : ''}\n`)
    } catch (error) {
      const durationMs = Date.now() - t0
      const message = error instanceof Error ? error.message : String(error)
      const rateLimited = isRateLimitError(error) || /rate|limit|quota|requests per/i.test(message)
      rows.push({ prompt, ok: false, rateLimited, providerCalls: null, answerKind: null, durationMs, preview: message })
      console.log(`     ERROR (${rateLimited ? 'RATE LIMIT' : 'other'}): ${message}\n`)
    }
  }

  const callCounts = rows.map((r) => r.providerCalls).filter((n): n is number => typeof n === 'number')
  const med = median(callCounts)
  const surfacedRateLimits = rows.filter((r) => r.rateLimited).length
  const failures = rows.filter((r) => !r.ok).length

  console.log('=== R1 verdict ===')
  console.log(`  prompts run:            ${rows.length}`)
  console.log(`  answered successfully:  ${rows.length - failures}/${rows.length}`)
  console.log(`  surfaced rate limits:   ${surfacedRateLimits}  (AC#1/#4 require 0)`)
  console.log(`  provider calls/turn:    [${callCounts.join(', ')}]  median=${med}  (AC#2 requires <= 2)`)
  console.log(`  first-message ok:       ${rows[0]?.ok ? 'yes' : 'NO'}  (AC#4)`)

  const pass = surfacedRateLimits === 0 && failures === 0 && med <= 2 && Boolean(rows[0]?.ok)
  console.log(`\n  RESULT: ${pass ? 'PASS — R1 acceptance criteria met' : 'FAIL — see rows above'}\n`)

  const outDir = path.join(process.cwd(), '.ai-behaviour')
  fs.mkdirSync(outDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  fs.writeFileSync(
    path.join(outDir, `r1-starter-${stamp}.json`),
    JSON.stringify({ generatedAt: new Date().toISOString(), provider: 'google', pass, median: med, rows }, null, 2),
  )

  cleanupRealDbCopy(dbCtx)
  process.exit(pass ? 0 : 1)
}

main().catch((err) => {
  console.error(`[fatal] ${err instanceof Error ? err.stack : String(err)}`)
  process.exit(1)
})
