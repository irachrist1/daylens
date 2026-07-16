// DEV-179 — choose the local semantic search engine.
//
// Benchmarks small local sentence-embedding models (MiniLM/bge-small class,
// running on the ONNX runtime via transformers.js — plain Node, no Python,
// Electron-compatible) and a local vector index (sqlite-vec vs a brute-force
// Float32 scan) over a synthetic year of memory records.
//
// Evidence collected, per docs/TO-DO.md:
//   - index build time for a representative year of memory records
//   - query latency against the memory spec's 1-second budget
//   - resident memory
//   - CPU cost
// Plus a small vague-memory recall probe so the model choice is grounded in
// retrieval quality, not just speed.
//
// The dataset is generated deterministically (seeded PRNG); model weights are
// fetched once into ./.cache and every later run is fully offline.
//
// Usage:  npm run bench          (embeds a subset, extrapolates build time)
//         npm run bench:full     (embeds the entire synthetic year)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import * as sqliteVec from 'sqlite-vec'
import { env, pipeline } from '@huggingface/transformers'

const HERE = path.dirname(fileURLToPath(import.meta.url))
env.cacheDir = path.join(HERE, '.cache')

const FULL = process.argv.includes('--full')
const DIMS = 384
const YEAR_RECORDS = 109_500 // 300 memory records/day × 365 days
const EMBED_SUBSET = FULL ? YEAR_RECORDS : 8_192
const QUERY_RUNS = 50
const TOP_K = 10

const MODELS = [
  { id: 'Xenova/all-MiniLM-L6-v2', label: 'all-MiniLM-L6-v2 (q8)' },
  { id: 'Xenova/bge-small-en-v1.5', label: 'bge-small-en-v1.5 (q8)' },
]

// ── Deterministic synthetic memory records ──────────────────────────────────

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const TOPICS = [
  'quarterly budget review', 'kitchen renovation ideas', 'flight to Kigali',
  'React server components', 'standing desk comparison', 'tax filing deadline',
  'client onboarding checklist', 'marathon training plan', 'SQLite performance tuning',
  'team retrospective notes', 'apartment lease renewal', 'conference talk outline',
  'espresso machine descaling', 'invoice template', 'GraphQL pagination',
  'noise cancelling headphones', 'salary negotiation tips', 'docker compose networking',
  'birthday gift ideas', 'home insurance quote', 'typescript generics tutorial',
  'weekend hiking trails', 'password manager migration', 'company all hands recording',
]
const APPS = ['Google Chrome', 'Code', 'Slack', 'Notion', 'Figma', 'Terminal', 'Obsidian', 'Preview', 'Mail', 'zoom.us']
const DOMAINS = ['github.com', 'stackoverflow.com', 'nytimes.com', 'amazon.com', 'youtube.com', 'docs.google.com', 'linear.app', 'bestbuy.com', 'airbnb.com', 'wikipedia.org']
const KINDS = ['page', 'file', 'meeting', 'block']

function syntheticRecord(rng, index) {
  const kind = KINDS[Math.floor(rng() * KINDS.length)]
  const topic = TOPICS[Math.floor(rng() * TOPICS.length)]
  const day = 1 + Math.floor(index / 300)
  switch (kind) {
    case 'page':
      return `Visited page: ${topic} — ${DOMAINS[Math.floor(rng() * DOMAINS.length)]}, day ${day}`
    case 'file':
      return `Edited file: ${topic.replaceAll(' ', '-')}-v${1 + Math.floor(rng() * 9)}.md in ${APPS[Math.floor(rng() * APPS.length)]}, day ${day}`
    case 'meeting':
      return `Meeting: ${topic} sync with ${['Ana', 'Bo', 'Chris', 'Dee'][Math.floor(rng() * 4)]}, day ${day}`
    default:
      return `Work block: ${topic} in ${APPS[Math.floor(rng() * APPS.length)]}, day ${day}`
  }
}

// Vague-memory probes: the query deliberately avoids the record's wording so
// lexical overlap cannot answer it — this is exactly the gap semantic search
// exists to close ("the TV page with the best discount").
const PROBES = [
  { query: 'the TV page with the best discount', target: 'Visited page: 55-inch OLED television deals and markdowns — bestbuy.com, day 12' },
  { query: 'that article about sleeping better', target: 'Visited page: improving rest quality and nighttime routines — nytimes.com, day 40' },
  { query: 'the doc where we planned the offsite', target: 'Edited file: team-retreat-agenda-v2.md in Notion, day 55' },
  { query: 'call about the money we owe the vendor', target: 'Meeting: outstanding supplier payment discussion with Dee, day 71' },
  { query: 'the site for renting a holiday home', target: 'Visited page: vacation cottage bookings by the lake — airbnb.com, day 89' },
  { query: 'when I compared laptops to buy', target: 'Visited page: notebook computer model comparison and prices — amazon.com, day 102' },
  { query: 'the video about making pasta from scratch', target: 'Visited page: homemade noodle dough technique tutorial — youtube.com, day 118' },
  { query: 'notes from the interview with the designer', target: 'Edited file: candidate-conversation-summary-ux-v1.md in Obsidian, day 133' },
  { query: 'the page explaining how memory works in browsers', target: 'Visited page: how web engines allocate and free heap — wikipedia.org, day 150' },
  { query: 'that spreadsheet with our runway numbers', target: 'Edited file: cash-remaining-forecast-v3.md in Code, day 164' },
  { query: 'the chat where legal approved the contract', target: 'Work block: agreement sign-off from counsel in Slack, day 178' },
  { query: 'the recipe with the chickpea stew', target: 'Visited page: garbanzo bean one-pot dinner instructions — nytimes.com, day 192' },
  { query: 'the ticket about the login bug', target: 'Visited page: session sign-in failure report — linear.app, day 205' },
  { query: 'the mockup with the dark sidebar', target: 'Edited file: night-theme-navigation-panel-v4.md in Figma, day 219' },
  { query: 'the talk recording about pricing experiments', target: 'Visited page: monetization test results presentation — youtube.com, day 233' },
  { query: 'where I checked train times to the airport', target: 'Visited page: rail schedule to the terminal — wikipedia.org, day 247' },
  { query: 'the thread about hiring a contractor', target: 'Work block: freelance engineer recruitment discussion in Slack, day 261' },
  { query: 'the guide for setting up the VPN', target: 'Visited page: private network client configuration steps — github.com, day 275' },
  { query: 'that post comparing coffee grinders', target: 'Visited page: burr mill face-off for espresso — youtube.com, day 289' },
  { query: 'the form for renewing my passport', target: 'Visited page: travel document replacement application — wikipedia.org, day 303' },
  { query: 'the plan for migrating the database', target: 'Edited file: storage-engine-cutover-steps-v2.md in Code, day 317' },
  { query: 'the email about the conference refund', target: 'Work block: event ticket reimbursement follow-up in Mail, day 331' },
  { query: 'the page where I sized the picture frames', target: 'Visited page: wall art dimensions and matting options — amazon.com, day 345' },
  { query: 'the call where we picked the launch date', target: 'Meeting: release timing decision with Ana, day 359' },
]

function buildCorpus() {
  const rng = mulberry32(0xdaa11e5)
  const records = Array.from({ length: YEAR_RECORDS }, (_, i) => syntheticRecord(rng, i))
  // Plant the probe targets at deterministic positions inside the embedded subset.
  const step = Math.floor(EMBED_SUBSET / (PROBES.length + 1))
  PROBES.forEach((probe, i) => {
    records[(i + 1) * step] = probe.target
  })
  return records
}

// ── Measurement helpers ─────────────────────────────────────────────────────

function nowMs() {
  return performance.now()
}

function cpuSeconds(since) {
  const u = process.cpuUsage(since)
  return (u.user + u.system) / 1e6
}

function mb(bytes) {
  return Math.round(bytes / 1024 / 1024)
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}

function summarize(latencies) {
  const sorted = [...latencies].sort((a, b) => a - b)
  return { p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), max: sorted[sorted.length - 1] }
}

// ── Embedding ───────────────────────────────────────────────────────────────

async function embedBatched(extractor, texts, batchSize = 32) {
  const out = new Float32Array(texts.length * DIMS)
  for (let start = 0; start < texts.length; start += batchSize) {
    const batch = texts.slice(start, start + batchSize)
    const tensor = await extractor(batch, { pooling: 'mean', normalize: true })
    out.set(tensor.data, start * DIMS)
    tensor.dispose?.()
  }
  return out
}

function randomUnitVector(rng, target, offset) {
  let norm = 0
  for (let d = 0; d < DIMS; d += 1) {
    const v = rng() * 2 - 1
    target[offset + d] = v
    norm += v * v
  }
  norm = Math.sqrt(norm) || 1
  for (let d = 0; d < DIMS; d += 1) target[offset + d] /= norm
}

// ── Indexes ─────────────────────────────────────────────────────────────────

function bruteForceTopK(matrix, count, query, k) {
  const hits = []
  for (let row = 0; row < count; row += 1) {
    let dot = 0
    const base = row * DIMS
    for (let d = 0; d < DIMS; d += 1) dot += matrix[base + d] * query[d]
    if (hits.length < k) {
      hits.push({ row, score: dot })
      if (hits.length === k) hits.sort((a, b) => a.score - b.score)
    } else if (dot > hits[0].score) {
      hits[0] = { row, score: dot }
      hits.sort((a, b) => a.score - b.score)
    }
  }
  return hits.sort((a, b) => b.score - a.score)
}

function buildSqliteVecIndex(matrix, count) {
  const db = new DatabaseSync(':memory:', { allowExtension: true })
  db.enableLoadExtension(true)
  db.loadExtension(sqliteVec.getLoadablePath())
  db.enableLoadExtension(false)
  db.exec(`CREATE VIRTUAL TABLE vec_memory USING vec0(embedding float[${DIMS}] distance_metric=cosine)`)

  const insert = db.prepare('INSERT INTO vec_memory(rowid, embedding) VALUES (?, ?)')
  const startCpu = process.cpuUsage()
  const start = nowMs()
  db.exec('BEGIN')
  for (let row = 0; row < count; row += 1) {
    const vector = matrix.subarray(row * DIMS, (row + 1) * DIMS)
    // node:sqlite binds plain numbers as REAL, which vec0 rejects for rowid.
    insert.run(BigInt(row), new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength))
  }
  db.exec('COMMIT')
  return { db, buildMs: nowMs() - start, buildCpuSec: cpuSeconds(startCpu) }
}

function sqliteVecTopK(db, query, k) {
  const stmt = db.prepare('SELECT rowid, distance FROM vec_memory WHERE embedding MATCH ? AND k = ? ORDER BY distance')
  return stmt.all(new Uint8Array(query.buffer, query.byteOffset, query.byteLength), k)
}

// ── Benchmark ───────────────────────────────────────────────────────────────

async function benchModel(model, records) {
  console.log(`\n━━ ${model.label} ━━`)
  const loadStart = nowMs()
  const extractor = await pipeline('feature-extraction', model.id, { dtype: 'q8' })
  const loadMs = nowMs() - loadStart
  console.log(`  model ready in ${Math.round(loadMs)} ms`)

  const subset = records.slice(0, EMBED_SUBSET)
  const embedCpuStart = process.cpuUsage()
  const embedStart = nowMs()
  const realVectors = await embedBatched(extractor, subset)
  const embedMs = nowMs() - embedStart
  const embedCpuSec = cpuSeconds(embedCpuStart)
  const textsPerSec = EMBED_SUBSET / (embedMs / 1000)
  const fullBuildMin = YEAR_RECORDS / textsPerSec / 60
  const rssAfterEmbed = process.memoryUsage().rss
  console.log(`  embedded ${EMBED_SUBSET.toLocaleString()} records in ${(embedMs / 1000).toFixed(1)} s → ${Math.round(textsPerSec)} records/s`)
  console.log(`  extrapolated full-year (${YEAR_RECORDS.toLocaleString()}) index build: ${fullBuildMin.toFixed(1)} min, CPU ${(embedCpuSec / (EMBED_SUBSET / 1000)).toFixed(2)} s per 1k records`)

  // Fill the remaining rows with seeded random unit vectors so index latency is
  // measured at true year scale. Latency depends on row count and dimensions,
  // not vector content; recall probes only ever score against real vectors.
  const matrix = new Float32Array(YEAR_RECORDS * DIMS)
  matrix.set(realVectors, 0)
  const fillerRng = mulberry32(0x5eed + MODELS.indexOf(model))
  for (let row = EMBED_SUBSET; row < YEAR_RECORDS; row += 1) randomUnitVector(fillerRng, matrix, row * DIMS)

  const sqlite = buildSqliteVecIndex(matrix, YEAR_RECORDS)
  console.log(`  sqlite-vec insert of ${YEAR_RECORDS.toLocaleString()} vectors: ${(sqlite.buildMs / 1000).toFixed(1)} s (CPU ${sqlite.buildCpuSec.toFixed(1)} s)`)

  const queryTexts = PROBES.map((p) => p.query)
  while (queryTexts.length < QUERY_RUNS) queryTexts.push(`what was I doing about ${TOPICS[queryTexts.length % TOPICS.length]}`)

  const embedLat = []
  const bruteLat = []
  const vecLat = []
  let recallHits = 0

  for (const [i, text] of queryTexts.entries()) {
    const t0 = nowMs()
    const tensor = await extractor(text, { pooling: 'mean', normalize: true })
    const queryVec = Float32Array.from(tensor.data)
    tensor.dispose?.()
    const t1 = nowMs()
    const bruteHits = bruteForceTopK(matrix, YEAR_RECORDS, queryVec, TOP_K)
    const t2 = nowMs()
    sqliteVecTopK(sqlite.db, queryVec, TOP_K)
    const t3 = nowMs()
    embedLat.push(t1 - t0)
    bruteLat.push(t2 - t1)
    vecLat.push(t3 - t2)

    if (i < PROBES.length) {
      const step = Math.floor(EMBED_SUBSET / (PROBES.length + 1))
      const targetRow = (i + 1) * step
      if (bruteHits.some((hit) => hit.row === targetRow)) recallHits += 1
    }
  }

  sqlite.db.close()
  const result = {
    model: model.label,
    loadMs: Math.round(loadMs),
    recordsPerSec: Math.round(textsPerSec),
    fullYearBuildMin: Number(fullBuildMin.toFixed(1)),
    embedCpuSecPer1k: Number((embedCpuSec / (EMBED_SUBSET / 1000)).toFixed(2)),
    rssAfterEmbedMb: mb(rssAfterEmbed),
    sqliteVecInsertSec: Number((sqlite.buildMs / 1000).toFixed(1)),
    queryEmbedMs: summarize(embedLat),
    bruteForceSearchMs: summarize(bruteLat),
    sqliteVecSearchMs: summarize(vecLat),
    endToEndP95Ms: Math.round(summarize(embedLat.map((v, i) => v + vecLat[i])).p95),
    recallAt10: `${recallHits}/${PROBES.length}`,
  }
  console.log(`  query embed p50/p95: ${result.queryEmbedMs.p50.toFixed(1)}/${result.queryEmbedMs.p95.toFixed(1)} ms`)
  console.log(`  search p50/p95 — brute: ${result.bruteForceSearchMs.p50.toFixed(1)}/${result.bruteForceSearchMs.p95.toFixed(1)} ms, sqlite-vec: ${result.sqliteVecSearchMs.p50.toFixed(1)}/${result.sqliteVecSearchMs.p95.toFixed(1)} ms`)
  console.log(`  end-to-end p95 (embed + sqlite-vec): ${result.endToEndP95Ms} ms — budget 1000 ms`)
  console.log(`  vague-memory recall@${TOP_K}: ${result.recallAt10}`)
  return result
}

const records = buildCorpus()
console.log(`Synthetic year: ${YEAR_RECORDS.toLocaleString()} memory records (embedding ${EMBED_SUBSET.toLocaleString()} for real${FULL ? '' : ', extrapolating the rest'}), ${PROBES.length} vague-memory probes, ${QUERY_RUNS} query runs, top-${TOP_K}.`)

const results = []
for (const model of MODELS) results.push(await benchModel(model, records))

const outPath = path.join(HERE, 'results.json')
fs.writeFileSync(outPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  yearRecords: YEAR_RECORDS,
  embeddedSubset: EMBED_SUBSET,
  dims: DIMS,
  results,
}, null, 2))
console.log(`\nWrote ${outPath}`)
