import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { cleanupRealDbCopy, stageReadOnlyCopyOfRealDb } from './ai-behaviour/realDb.ts'

test('real DB staging uses an online backup that includes committed WAL pages', async () => {
  const liveUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-live-source-'))
  const liveDbPath = path.join(liveUserData, 'daylens.sqlite')
  const previousSource = process.env.DAYLENS_REAL_USER_DATA
  const writer = new Database(liveDbPath)
  let staged: Awaited<ReturnType<typeof stageReadOnlyCopyOfRealDb>> | null = null

  try {
    writer.pragma('journal_mode = WAL')
    writer.exec('CREATE TABLE evidence (id INTEGER PRIMARY KEY, value TEXT NOT NULL)')
    writer.prepare('INSERT INTO evidence (value) VALUES (?)').run('checkpointed')
    writer.pragma('wal_checkpoint(TRUNCATE)')
    writer.prepare('INSERT INTO evidence (value) VALUES (?)').run('committed-in-wal')
    fs.writeFileSync(
      path.join(liveUserData, 'config.json'),
      JSON.stringify({ onboardingComplete: true }),
    )
    assert.ok(fs.statSync(`${liveDbPath}-wal`).size > 0)

    process.env.DAYLENS_REAL_USER_DATA = liveUserData
    staged = await stageReadOnlyCopyOfRealDb({ settingsOverride: { trackingPaused: true } })

    const copy = new Database(staged.copiedDbPath, { readonly: true })
    try {
      const values = copy.prepare('SELECT value FROM evidence ORDER BY id').pluck().all()
      assert.deepEqual(values, ['checkpointed', 'committed-in-wal'])
    } finally {
      copy.close()
    }
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(staged.tempUserData, 'config.json'), 'utf8')),
      { onboardingComplete: true, trackingPaused: true },
    )
    assert.deepEqual(writer.prepare('SELECT value FROM evidence ORDER BY id').pluck().all(), [
      'checkpointed',
      'committed-in-wal',
    ])
  } finally {
    if (staged) cleanupRealDbCopy(staged)
    writer.close()
    fs.rmSync(liveUserData, { recursive: true, force: true })
    if (previousSource === undefined) delete process.env.DAYLENS_REAL_USER_DATA
    else process.env.DAYLENS_REAL_USER_DATA = previousSource
  }
})
