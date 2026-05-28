import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import {
  extractProjectHintFromEvidence,
  gatherConcurrentEvidence,
  learnFromBlockOverride,
  matchPromotedPatterns,
  type WorkMemoryBlockInput,
} from '../src/main/services/workMemory.ts'

const START = 1_800_000_000_000

function createDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA_SQL)
  return db
}

function ghosttyBlock(overrides: Partial<WorkMemoryBlockInput> = {}): WorkMemoryBlockInput {
  return {
    id: 'blk-dev',
    startTime: START,
    endTime: START + 30 * 60_000,
    dominantCategory: 'development',
    topApps: [{
      bundleId: 'com.mitchellh.ghostty',
      appName: 'Ghostty',
      category: 'development',
      totalSeconds: 1800,
      sessionCount: 1,
      isBrowser: false,
    }],
    ...overrides,
  }
}

function chromeBlock(overrides: Partial<WorkMemoryBlockInput> = {}): WorkMemoryBlockInput {
  return {
    id: 'blk-video',
    startTime: START,
    endTime: START + 20 * 60_000,
    dominantCategory: 'entertainment',
    topApps: [{
      bundleId: 'com.google.Chrome',
      appName: 'Google Chrome',
      category: 'browsing',
      totalSeconds: 1200,
      sessionCount: 1,
      isBrowser: true,
    }],
    ...overrides,
  }
}

function insertVisit(db: Database.Database, values: {
  domain: string
  title: string
  url: string
  visitTime?: number
  durationSec?: number
}): void {
  db.prepare(`
    INSERT INTO website_visits (
      domain,
      page_title,
      url,
      visit_time,
      visit_time_us,
      duration_sec,
      browser_bundle_id,
      source
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active_browser_context')
  `).run(
    values.domain,
    values.title,
    values.url,
    values.visitTime ?? START + 5 * 60_000,
    (values.visitTime ?? START + 5 * 60_000) * 1000,
    values.durationSec ?? 10 * 60,
    'com.apple.Safari',
  )
}

function insertTimelineBlock(db: Database.Database, block: WorkMemoryBlockInput): void {
  db.prepare(`
    INSERT INTO timeline_blocks (
      id,
      date,
      start_time,
      end_time,
      block_kind,
      dominant_category,
      category_distribution_json,
      switch_count,
      label_current,
      label_source,
      label_confidence,
      evidence_summary_json,
      is_live,
      heuristic_version,
      computed_at
    )
    VALUES (?, '2026-05-28', ?, ?, 'work', ?, '{}', 0, 'Terminal work', 'rule', 0.5, '{}', 0, 'test', ?)
  `).run(block.id, block.startTime, block.endTime, block.dominantCategory ?? 'development', START)
}

function insertAppSessionForBlock(db: Database.Database, block: WorkMemoryBlockInput, sessionId: number): void {
  const app = block.topApps?.[0]
  assert.ok(app)
  db.prepare(`
    INSERT INTO app_sessions (
      id,
      bundle_id,
      app_name,
      start_time,
      end_time,
      duration_sec,
      category
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    app.bundleId,
    app.appName,
    block.startTime,
    block.endTime,
    Math.round((block.endTime - block.startTime) / 1000),
    app.category,
  )
  db.prepare(`
    INSERT INTO timeline_block_members (
      block_id,
      member_type,
      member_id,
      start_time,
      end_time,
      weight_seconds
    )
    VALUES (?, 'app_session', ?, ?, ?, ?)
  `).run(
    block.id,
    String(sessionId),
    block.startTime,
    block.endTime,
    Math.round((block.endTime - block.startTime) / 1000),
  )
}

test('a localhost dev server title provides a project development hint', () => {
  const db = createDb()
  try {
    const block = ghosttyBlock()
    insertVisit(db, {
      domain: 'localhost',
      title: 'Daylens - localhost:5173',
      url: 'http://localhost:5173/timeline',
    })

    const evidence = gatherConcurrentEvidence(db, block)
    const hint = extractProjectHintFromEvidence(block, evidence)

    assert.equal(hint?.project, 'Daylens')
    assert.equal(hint?.label, 'Daylens development')
  } finally {
    db.close()
  }
})

test('a web page title is never turned into a "<noun> development" project hint', () => {
  // The old behavior minted "YouTube development" / "Instagram development" from
  // any tab title. A non-localhost, non-code web page must yield no hint.
  for (const visit of [
    { domain: 'youtube.com', title: 'Some Documentary - YouTube', url: 'https://youtube.com/watch?v=abc' },
    { domain: 'instagram.com', title: 'Instagram', url: 'https://instagram.com/' },
    { domain: 'mail.google.com', title: 'Inbox (1)', url: 'https://mail.google.com/' },
  ]) {
    const db = createDb()
    try {
      const block = ghosttyBlock()
      insertVisit(db, visit)
      const evidence = gatherConcurrentEvidence(db, block)
      assert.equal(extractProjectHintFromEvidence(block, evidence), null, `${visit.domain} should not yield a project hint`)
    } finally {
      db.close()
    }
  }
})

test('a github repo URL yields the repo as the project, non-code hosts do not', () => {
  const db = createDb()
  try {
    const block = ghosttyBlock()
    insertVisit(db, { domain: 'github.com', title: 'irachrist1/daylens-v1', url: 'https://github.com/irachrist1/daylens-v1' })
    const evidence = gatherConcurrentEvidence(db, block)
    const hint = extractProjectHintFromEvidence(block, evidence)
    assert.equal(hint?.project?.toLowerCase().includes('daylens'), true)
  } finally {
    db.close()
  }
})

test('manual block label override creates a promoted context pattern at confidence 1.0', () => {
  const db = createDb()
  try {
    const block = ghosttyBlock({ id: 'blk-override' })
    insertTimelineBlock(db, block)
    insertAppSessionForBlock(db, block, 1)
    insertVisit(db, {
      domain: 'localhost',
      title: 'Daylens - localhost:5173',
      url: 'http://localhost:5173/timeline',
    })

    assert.equal(learnFromBlockOverride(db, block.id, 'Daylens development'), true)

    const row = db.prepare(`
      SELECT pattern_type AS patternType, label_suggestion AS labelSuggestion, confidence, status
      FROM context_patterns
      LIMIT 1
    `).get() as {
      patternType: string
      labelSuggestion: string
      confidence: number
      status: string
    }

    assert.equal(row.patternType, 'override')
    assert.equal(row.labelSuggestion, 'Daylens development')
    assert.equal(row.confidence, 1)
    assert.equal(row.status, 'promoted')
  } finally {
    db.close()
  }
})

test('promoted override pattern matches a later similar block', () => {
  const db = createDb()
  try {
    const firstBlock = ghosttyBlock({ id: 'blk-first' })
    insertTimelineBlock(db, firstBlock)
    insertAppSessionForBlock(db, firstBlock, 1)
    insertVisit(db, {
      domain: 'localhost',
      title: 'Daylens - localhost:5173',
      url: 'http://localhost:5173/timeline',
    })
    assert.equal(learnFromBlockOverride(db, firstBlock.id, 'Daylens development'), true)

    const laterBlock = ghosttyBlock({
      id: 'blk-later',
      startTime: START + 2 * 60 * 60_000,
      endTime: START + 2 * 60 * 60_000 + 25 * 60_000,
    })
    insertVisit(db, {
      domain: 'localhost',
      title: 'Daylens - localhost:5173',
      url: 'http://localhost:5173/settings',
      visitTime: laterBlock.startTime + 2 * 60_000,
    })

    const evidence = gatherConcurrentEvidence(db, laterBlock)
    const match = matchPromotedPatterns(db, laterBlock, evidence)

    assert.equal(match?.label, 'Daylens development')
    assert.ok((match?.score ?? 0) >= 0.65)
  } finally {
    db.close()
  }
})

test('youtube-only entertainment combinations are not learned as work memory', () => {
  const db = createDb()
  try {
    const block = chromeBlock()
    insertTimelineBlock(db, block)
    insertAppSessionForBlock(db, block, 1)
    insertVisit(db, {
      domain: 'youtube.com',
      title: 'Tiny Desk Concert - YouTube',
      url: 'https://www.youtube.com/watch?v=abc123',
    })

    assert.equal(learnFromBlockOverride(db, block.id, 'Music break'), false)

    const row = db.prepare(`SELECT COUNT(*) AS count FROM context_patterns`).get() as { count: number }
    assert.equal(row.count, 0)
  } finally {
    db.close()
  }
})
