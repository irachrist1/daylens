// DEV-180 network boundary: NO remote embedding calls, ever, without an
// explicit opt-in (which does not exist yet — remote providers are out of
// scope). Every process-level network entry point is replaced with a probe
// that records and refuses, then the whole semantic lifecycle runs on top:
// the REAL model loader with the artifact absent (the path a fresh install
// without the download step exercises), indexing, querying, status, and the
// agent's search. Zero recorded attempts is the invariant; the run also
// proves the missing-model path degrades without ever reaching for the
// network. Runs in its own process (per-file isolation), so patching globals
// cannot leak into other suites.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { indexMemoryForDay } from '../src/main/services/memoryIndex.ts'
import {
  getSemanticSearchStatus,
  searchByMeaning,
  semanticIndexStep,
} from '../src/main/services/semanticIndex.ts'
import {
  loadSemanticEmbedder,
  setSemanticEmbedderFactoryForTests,
  SEMANTIC_EMBEDDING_DIMS,
  type SemanticEmbedder,
} from '../src/main/services/semanticEmbedder.ts'
import { execSearchSessionsWithMeaning } from '../src/main/services/aiTools.ts'

const attempts: string[] = []

function refuse(kind: string): never {
  attempts.push(kind)
  throw new Error(`network disabled by semanticNetworkBoundary test: ${kind}`)
}

// Patch every entry point node code can reach the network through: fetch
// (undici — what transformers.js uses), and the http/https module functions.
const realFetch = globalThis.fetch
globalThis.fetch = ((input: unknown) => refuse(`fetch ${String(input)}`)) as typeof fetch
const realHttpRequest = http.request
const realHttpGet = http.get
const realHttpsRequest = https.request
const realHttpsGet = https.get
http.request = ((...args: unknown[]) => refuse(`http.request ${String(args[0])}`)) as typeof http.request
http.get = ((...args: unknown[]) => refuse(`http.get ${String(args[0])}`)) as typeof http.get
https.request = ((...args: unknown[]) => refuse(`https.request ${String(args[0])}`)) as typeof https.request
https.get = ((...args: unknown[]) => refuse(`https.get ${String(args[0])}`)) as typeof https.get

test.after(() => {
  globalThis.fetch = realFetch
  http.request = realHttpRequest
  http.get = realHttpGet
  https.request = realHttpsRequest
  https.get = realHttpsGet
})

function fixtureEmbedder(): SemanticEmbedder {
  return {
    model: 'fixture-embedder',
    version: 1,
    dims: SEMANTIC_EMBEDDING_DIMS,
    embed: (texts) =>
      Promise.resolve(
        texts.map((text) => {
          const vector = new Float32Array(SEMANTIC_EMBEDDING_DIMS)
          const norm = Math.SQRT1_2
          vector[0] = norm
          vector[1 + (text.length % 32)] = norm
          return vector
        }),
      ),
  }
}

test('the missing-model path never touches the network: the real loader refuses remote fetches', async () => {
  // Point the loader at an empty directory so the pinned artifact is
  // definitively absent — the state of a build without the download step.
  process.env.DAYLENS_SEMANTIC_MODEL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-no-model-'))
  setSemanticEmbedderFactoryForTests(null) // the REAL loader, not a fixture

  const result = await loadSemanticEmbedder()
  assert.equal(result.ok, false)
  assert.equal(result.ok ? null : result.reason, 'model-missing')
  assert.equal(attempts.length, 0, `no network attempts, got: ${attempts.join(', ')}`)

  const db = createProductionTestDatabase()
  assert.deepEqual(await searchByMeaning(db, 'the pricing doc from tuesday'), [])
  const status = await getSemanticSearchStatus(db)
  assert.equal(status.available, false)
  assert.equal(attempts.length, 0, `status/query made network attempts: ${attempts.join(', ')}`)
})

test('the full semantic lifecycle — embed, query, status, agent search — makes zero network calls', async () => {
  setSemanticEmbedderFactoryForTests(() => ({ ok: true, embedder: fixtureEmbedder() }))
  const db = createProductionTestDatabase()
  const startTime = new Date(2026, 3, 22, 9, 0, 0, 0).getTime()
  db.prepare(`
    INSERT INTO app_sessions (
      bundle_id, app_name, start_time, end_time, duration_sec,
      category, is_focused, window_title, raw_app_name, capture_source, capture_version
    ) VALUES ('com.mitchellh.ghostty', 'Ghostty', ?, ?, 1800, 'development', 1, 'Quarterly pricing draft', 'Ghostty', 'test', 1)
  `).run(startTime, startTime + 1_800_000)
  indexMemoryForDay(db, '2026-04-22')

  const progress = await semanticIndexStep(db, fixtureEmbedder())
  assert.ok(progress.embedded >= 1, 'the record embedded locally')
  await searchByMeaning(db, 'that pricing document', { limit: 5 })
  await getSemanticSearchStatus(db)
  await execSearchSessionsWithMeaning({ query: 'that pricing document' }, db)

  assert.equal(
    attempts.length,
    0,
    `embedding and retrieval must be device-local; recorded attempts: ${attempts.join(', ')}`,
  )
  setSemanticEmbedderFactoryForTests(null)
})
