import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildCorpus, MODELS, openVectorDatabase, probeRows, PROBES } from './bench.mjs'

test('models use their intended pooling strategies', () => {
  assert.deepEqual(
    MODELS.map(({ key, pooling }) => ({ key, pooling })),
    [
      { key: 'minilm', pooling: 'mean' },
      { key: 'bge', pooling: 'cls' },
    ],
  )
})

test('probe rows are deterministic, distinct, and contain their expected targets', () => {
  for (const recordCount of [8_192, 109_500]) {
    const expectedRows = probeRows(recordCount)
    const { records, probeRows: actualRows } = buildCorpus(recordCount)

    assert.deepEqual(actualRows, expectedRows)
    assert.equal(new Set(actualRows).size, PROBES.length)
    PROBES.forEach((probe, index) => {
      assert.ok(actualRows[index] >= 0 && actualRows[index] < recordCount)
      assert.equal(records[actualRows[index]], probe.target)
    })
  }
})

test('sqlite-vec returns stable ordered row IDs from a file-backed database', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-semantic-test-'))
  const databasePath = path.join(tempDir, 'vectors.sqlite')

  try {
    let db = openVectorDatabase(databasePath)
    db.exec('CREATE VIRTUAL TABLE vectors USING vec0(embedding float[2] distance_metric=cosine)')
    const insert = db.prepare('INSERT INTO vectors(rowid, embedding) VALUES (?, ?)')
    insert.run(10n, Buffer.from(new Float32Array([1, 0]).buffer))
    insert.run(20n, Buffer.from(new Float32Array([0.8, 0.2]).buffer))
    insert.run(30n, Buffer.from(new Float32Array([0, 1]).buffer))
    db.close()

    db = openVectorDatabase(databasePath)
    const query = Buffer.from(new Float32Array([1, 0]).buffer)
    const hits = db.prepare('SELECT rowid, distance FROM vectors WHERE embedding MATCH ? AND k = 3 ORDER BY distance').all(query)
    db.close()

    assert.deepEqual(hits.map((hit) => hit.rowid), [10, 20, 30])
    assert.ok(hits.every((hit, index) => index === 0 || hit.distance >= hits[index - 1].distance))
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})
