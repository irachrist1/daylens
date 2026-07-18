import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import { env, pipeline } from '@huggingface/transformers'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIMS = 384
const RECORDS_PER_DAY = 300
const YEAR_RECORDS = RECORDS_PER_DAY * 365
const SMOKE_RECORDS = 8_192
const EMBED_BATCH_SIZE = 32
const COMMIT_BATCH_SIZE = 512
const QUERY_RUNS = 50
const TOP_K = 10
const BGE_QUERY_PREFIX = 'Represent this sentence for searching relevant passages: '

export const MODELS = [
  {
    key: 'minilm',
    id: 'Xenova/all-MiniLM-L6-v2',
    revision: '751bff37182d3f1213fa05d7196b954e230abad9',
    label: 'all-MiniLM-L6-v2 (q8)',
    queryPrefix: '',
  },
  {
    key: 'bge',
    id: 'Xenova/bge-small-en-v1.5',
    revision: 'ea104dacec62c0de699686887e3f920caeb4f3e3',
    label: 'bge-small-en-v1.5 (q8, recommended query instruction)',
    queryPrefix: BGE_QUERY_PREFIX,
  },
]

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

export const PROBES = [
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

function syntheticRecord(rng, index) {
  const kind = KINDS[Math.floor(rng() * KINDS.length)]
  const topic = TOPICS[Math.floor(rng() * TOPICS.length)]
  const day = 1 + Math.floor(index / RECORDS_PER_DAY)
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

export function probeRows(recordCount) {
  const step = Math.floor(recordCount / (PROBES.length + 1))
  return PROBES.map((_, index) => (index + 1) * step)
}

export function buildCorpus(recordCount) {
  const rng = mulberry32(0xdaa11e5)
  const records = Array.from({ length: recordCount }, (_, index) => syntheticRecord(rng, index))
  const rows = probeRows(recordCount)
  PROBES.forEach((probe, index) => {
    records[rows[index]] = probe.target
  })
  return { records, probeRows: rows }
}

function nowMs() {
  return performance.now()
}

function cpuSeconds(since) {
  const usage = process.cpuUsage(since)
  return (usage.user + usage.system) / 1e6
}

function mb(bytes) {
  return Math.round(bytes / 1024 / 1024)
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}

function summarize(latencies) {
  const sorted = [...latencies].sort((a, b) => a - b)
  return {
    p50: Number(percentile(sorted, 0.5).toFixed(2)),
    p95: Number(percentile(sorted, 0.95).toFixed(2)),
    max: Number(sorted[sorted.length - 1].toFixed(2)),
  }
}

function rssTracker() {
  const baselineMb = mb(process.memoryUsage().rss)
  let peakMb = baselineMb
  return {
    sample() {
      peakMb = Math.max(peakMb, mb(process.memoryUsage().rss))
    },
    result() {
      this.sample()
      peakMb = Math.max(peakMb, Math.ceil(process.resourceUsage().maxRSS / 1024))
      return {
        baselineMb,
        peakMb,
        increaseMb: peakMb - baselineMb,
        peakMethod: 'process.resourceUsage().maxRSS',
      }
    },
  }
}

function vectorBlob(vector) {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength)
}

export function openVectorDatabase(filePath) {
  const db = new Database(filePath)
  db.loadExtension(sqliteVec.getLoadablePath())
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  db.pragma('cache_size = -65536')
  db.pragma('mmap_size = 536870912')
  db.pragma('synchronous = NORMAL')
  return db
}

function createIndex(db) {
  db.exec(`CREATE VIRTUAL TABLE vec_memory USING vec0(embedding float[${DIMS}] distance_metric=cosine)`)
}

function powerSnapshot() {
  if (process.platform !== 'darwin') return { source: 'unknown', percent: null }
  const result = spawnSync('pmset', ['-g', 'batt'], { encoding: 'utf8' })
  const output = result.stdout ?? ''
  const source = output.includes("'Battery Power'") ? 'battery' : output.includes("'AC Power'") ? 'ac' : 'unknown'
  const percent = Number(output.match(/(\d+)%/)?.[1] ?? NaN)
  return { source, percent: Number.isFinite(percent) ? percent : null }
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function modelFiles(model) {
  const root = path.join(env.cacheDir, ...model.id.split('/'), model.revision)
  const relativePaths = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx']
  return relativePaths.map((relativePath) => {
    const filePath = path.join(root, relativePath)
    return { path: relativePath, bytes: fs.statSync(filePath).size, sha256: sha256(filePath) }
  })
}

async function loadExtractor(model, allowDownload) {
  return pipeline('feature-extraction', model.id, {
    dtype: 'q8',
    revision: model.revision,
    local_files_only: !allowDownload,
  })
}

async function downloadModels() {
  env.allowRemoteModels = true
  for (const model of MODELS) {
    console.log(`Caching ${model.id}@${model.revision}`)
    const extractor = await loadExtractor(model, true)
    await extractor.dispose?.()
  }
}

async function indexCorpus(extractor, records, db, tracker) {
  const insert = db.prepare('INSERT INTO vec_memory(rowid, embedding) VALUES (?, ?)')
  const startedAt = nowMs()
  const cpuStart = process.cpuUsage()

  for (let commitStart = 0; commitStart < records.length; commitStart += COMMIT_BATCH_SIZE) {
    const commitEnd = Math.min(records.length, commitStart + COMMIT_BATCH_SIZE)
    db.exec('BEGIN')
    try {
      for (let start = commitStart; start < commitEnd; start += EMBED_BATCH_SIZE) {
        const end = Math.min(commitEnd, start + EMBED_BATCH_SIZE)
        const tensor = await extractor(records.slice(start, end), { pooling: 'mean', normalize: true })
        for (let row = start; row < end; row += 1) {
          const offset = (row - start) * DIMS
          insert.run(BigInt(row), vectorBlob(tensor.data.subarray(offset, offset + DIMS)))
        }
        tensor.dispose?.()
        tracker.sample()
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    tracker.sample()
  }

  const wallMs = nowMs() - startedAt
  const cpuSec = cpuSeconds(cpuStart)
  return {
    wallSec: Number((wallMs / 1000).toFixed(2)),
    recordsPerSec: Math.round(records.length / (wallMs / 1000)),
    cpuSec: Number(cpuSec.toFixed(2)),
    cpuSecPer1k: Number((cpuSec / (records.length / 1000)).toFixed(2)),
  }
}

async function queryIndex(extractor, model, db, targetRows, tracker) {
  const statement = db.prepare('SELECT rowid, distance FROM vec_memory WHERE embedding MATCH ? AND k = ? ORDER BY distance')
  const queryTexts = PROBES.map((probe) => probe.query)
  while (queryTexts.length < QUERY_RUNS) {
    queryTexts.push(`what was I doing about ${TOPICS[queryTexts.length % TOPICS.length]}`)
  }

  const embedLatencies = []
  const searchLatencies = []
  const endToEndLatencies = []
  let recallHits = 0
  let validResultSets = 0

  for (const [index, text] of queryTexts.entries()) {
    const startedAt = nowMs()
    const tensor = await extractor(`${model.queryPrefix}${text}`, { pooling: 'mean', normalize: true })
    const embeddedAt = nowMs()
    const hits = statement.all(vectorBlob(tensor.data), TOP_K)
    const completedAt = nowMs()
    tensor.dispose?.()
    tracker.sample()

    embedLatencies.push(embeddedAt - startedAt)
    searchLatencies.push(completedAt - embeddedAt)
    endToEndLatencies.push(completedAt - startedAt)

    const valid = hits.length === TOP_K
      && hits.every((hit, hitIndex) => Number.isInteger(hit.rowid)
        && Number.isFinite(hit.distance)
        && (hitIndex === 0 || hit.distance >= hits[hitIndex - 1].distance))
    if (valid) validResultSets += 1
    if (index < PROBES.length && hits.some((hit) => hit.rowid === targetRows[index])) recallHits += 1
  }

  if (validResultSets !== queryTexts.length) {
    throw new Error(`sqlite-vec returned ${validResultSets}/${queryTexts.length} valid ordered top-${TOP_K} result sets`)
  }

  return {
    queryRuns: queryTexts.length,
    queryEmbedMs: summarize(embedLatencies),
    sqliteVecSearchMs: summarize(searchLatencies),
    endToEndMs: summarize(endToEndLatencies),
    firstQueryAfterReopenMs: Number(endToEndLatencies[0].toFixed(2)),
    sqliteRecallAt10: `${recallHits}/${PROBES.length}`,
    validResultSets,
  }
}

async function benchModel(model, recordCount) {
  env.cacheDir = path.join(HERE, '.cache')
  env.allowRemoteModels = false
  const tracker = rssTracker()
  const overallCpuStart = process.cpuUsage()
  const powerStart = powerSnapshot()
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `daylens-semantic-${model.key}-`))
  const databasePath = path.join(tempDir, 'semantic.sqlite')
  const { records, probeRows: targetRows } = buildCorpus(recordCount)
  console.error(`\n━━ ${model.label} · ${recordCount.toLocaleString()} records ━━`)

  try {
    const loadStartedAt = nowMs()
    const extractor = await loadExtractor(model, false)
    const loadMs = Math.round(nowMs() - loadStartedAt)
    tracker.sample()

    let db = openVectorDatabase(databasePath)
    createIndex(db)
    const sqliteVersion = db.prepare('SELECT sqlite_version() AS version').get().version
    const sqliteVecVersion = db.prepare('SELECT vec_version() AS version').get().version
    const build = await indexCorpus(extractor, records, db, tracker)
    db.pragma('wal_checkpoint(TRUNCATE)')
    db.close()
    tracker.sample()

    const databaseMb = Number((fs.statSync(databasePath).size / 1024 / 1024).toFixed(2))
    db = openVectorDatabase(databasePath)
    const query = await queryIndex(extractor, model, db, targetRows, tracker)
    db.close()
    await extractor.dispose?.()
    tracker.sample()

    const result = {
      model: model.label,
      modelId: model.id,
      modelRevision: model.revision,
      queryInstruction: model.queryPrefix || null,
      modelFiles: modelFiles(model),
      loadMs,
      build,
      memory: tracker.result(),
      databaseMb,
      sqliteVersion,
      sqliteVecVersion,
      query,
      cpuSec: Number(cpuSeconds(overallCpuStart).toFixed(2)),
      powerStart,
      powerEnd: powerSnapshot(),
    }
    console.error(`  build ${build.wallSec}s · ${build.recordsPerSec} records/s · CPU ${build.cpuSecPer1k}s/1k`)
    console.error(`  RSS ${result.memory.peakMb} MB peak (${result.memory.increaseMb} MB over worker baseline) · DB ${databaseMb} MB`)
    console.error(`  query p95 ${query.endToEndMs.p95} ms · first after reopen ${query.firstQueryAfterReopenMs} ms · sqlite recall ${query.sqliteRecallAt10}`)
    return result
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

function packageVersion(name) {
  const packagePath = path.join(HERE, 'node_modules', ...name.split('/'), 'package.json')
  return JSON.parse(fs.readFileSync(packagePath, 'utf8')).version
}

function runtimeMetadata() {
  return {
    electron: process.versions.electron ?? null,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0]?.model ?? 'unknown',
    logicalCpus: os.cpus().length,
    memoryMb: mb(os.totalmem()),
    dependencies: {
      transformersJs: packageVersion('@huggingface/transformers'),
      betterSqlite3: packageVersion('better-sqlite3'),
      sqliteVec: packageVersion('sqlite-vec'),
    },
  }
}

async function runParent(full) {
  const recordCount = full ? YEAR_RECORDS : SMOKE_RECORDS
  const mode = full ? 'full' : 'smoke'
  const outputPath = path.join(HERE, full ? 'results.json' : 'smoke-results.json')
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-semantic-results-'))
  const powerStart = powerSnapshot()
  const results = []

  try {
    for (const model of MODELS) {
      const modelOutput = path.join(tempDir, `${model.key}.json`)
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker', model.key, `--records=${recordCount}`, `--worker-output=${modelOutput}`], {
        cwd: HERE,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: 'inherit',
      })
      if (child.status !== 0) throw new Error(`${model.label} worker exited with ${child.status}`)
      results.push(JSON.parse(fs.readFileSync(modelOutput, 'utf8')))
    }

    const powerEnd = powerSnapshot()
    const output = {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      mode,
      decisionEligible: full,
      offlineEnforced: true,
      corpus: {
        seed: '0x0daa11e5',
        records: recordCount,
        recordsPerDay: RECORDS_PER_DAY,
        days: full ? 365 : null,
        dims: DIMS,
        probes: PROBES.length,
        queryRuns: QUERY_RUNS,
        topK: TOP_K,
        basis: '300 records/day matches the existing heavy-year query fixture website-visit volume; record content is synthetic.',
      },
      runtime: runtimeMetadata(),
      powerStart,
      powerEnd,
      batteryRun: powerStart.source === 'battery' && powerEnd.source === 'battery',
      results,
    }
    fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`)
    console.log(`\nWrote ${outputPath}`)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

async function main() {
  const workerIndex = process.argv.indexOf('--worker')
  if (workerIndex !== -1) {
    const model = MODELS.find((candidate) => candidate.key === process.argv[workerIndex + 1])
    const recordCount = Number(process.argv.find((arg) => arg.startsWith('--records='))?.split('=')[1])
    const outputPath = process.argv.find((arg) => arg.startsWith('--worker-output='))?.slice('--worker-output='.length)
    if (!model || !Number.isInteger(recordCount) || recordCount < PROBES.length || !outputPath) {
      throw new Error('Invalid benchmark worker arguments')
    }
    const result = await benchModel(model, recordCount)
    fs.writeFileSync(outputPath, JSON.stringify(result))
    return
  }

  env.cacheDir = path.join(HERE, '.cache')
  if (process.argv.includes('--download-models')) {
    await downloadModels()
    return
  }
  await runParent(process.argv.includes('--full'))
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
