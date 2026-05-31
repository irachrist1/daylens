// Regression guard for F58: GET_ARTIFACT reads only a capped preview so a large
// artifact is not cloned in full over IPC. readArtifactPreview caps inline
// content and flags truncation; open/export still read the whole thing.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import { readArtifactPreview } from '../src/main/services/artifacts.ts'
import { clearTestDb, setTestDb } from './support/database-stub.mjs'

function insertInlineArtifact(db: Database.Database, content: string): number {
  const res = db.prepare(`
    INSERT INTO ai_artifacts (kind, title, summary, file_path, inline_content, mime_type, byte_size, meta_json, created_at)
    VALUES ('report', 'Big report', NULL, NULL, ?, 'text/markdown', ?, '{}', ?)
  `).run(content, Buffer.byteLength(content, 'utf8'), Date.now())
  return res.lastInsertRowid as number
}

function insertFileArtifact(db: Database.Database, filePath: string, byteSize: number): number {
  const res = db.prepare(`
    INSERT INTO ai_artifacts (kind, title, summary, file_path, inline_content, mime_type, byte_size, meta_json, created_at)
    VALUES ('report', 'File report', NULL, ?, NULL, 'text/markdown', ?, '{}', ?)
  `).run(filePath, byteSize, Date.now())
  return res.lastInsertRowid as number
}

test('readArtifactPreview caps inline content and flags truncation', async () => {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  setTestDb(db)
  try {
    const big = 'x'.repeat(10_000)
    const id = insertInlineArtifact(db, big)

    const preview = await readArtifactPreview(id, 1_000)
    assert.ok(preview, 'expected a preview')
    assert.equal(preview.content?.length, 1_000, 'content capped to maxBytes')
    assert.equal(preview.truncated, true, 'truncated flag set when content exceeds cap')
  } finally {
    clearTestDb()
    db.close()
  }
})

test('readArtifactPreview caps multibyte content by bytes, not characters', async () => {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  setTestDb(db)
  try {
    // 500 emoji = 500 chars but 2000 UTF-8 bytes. A char-based substr(1, 1000)
    // would return all 2000 bytes; the byte-accurate cap must stay <= 1000.
    const emoji = '\u{1F600}'.repeat(500)
    const id = insertInlineArtifact(db, emoji)

    const preview = await readArtifactPreview(id, 1_000)
    assert.ok(preview)
    assert.ok(
      Buffer.byteLength(preview.content ?? '', 'utf8') <= 1_000,
      `expected <=1000 bytes, got ${Buffer.byteLength(preview.content ?? '', 'utf8')}`,
    )
    assert.equal(preview.truncated, true)
  } finally {
    clearTestDb()
    db.close()
  }
})

test('readArtifactPreview returns full small content untruncated', async () => {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  setTestDb(db)
  try {
    const small = 'short content'
    const id = insertInlineArtifact(db, small)

    const preview = await readArtifactPreview(id, 1_000)
    assert.ok(preview)
    assert.equal(preview.content, small)
    assert.equal(preview.truncated, false)
  } finally {
    clearTestDb()
    db.close()
  }
})

test('readArtifactPreview returns null for a missing artifact', async () => {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  setTestDb(db)
  try {
    assert.equal(await readArtifactPreview(999, 1_000), null)
  } finally {
    clearTestDb()
    db.close()
  }
})

test('readArtifactPreview flags file-backed artifacts truncated from actual file size', async () => {
  const db = new Database(':memory:')
  db.exec(SCHEMA_SQL)
  setTestDb(db)
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'daylens-artifact-preview-'))
  try {
    const filePath = path.join(tempDir, 'large-report.md')
    await fs.writeFile(filePath, 'x'.repeat(10_000), 'utf8')
    const id = insertFileArtifact(db, filePath, 0)

    const preview = await readArtifactPreview(id, 1_000)
    assert.ok(preview)
    assert.equal(preview.content?.length, 1_000)
    assert.equal(preview.truncated, true, 'file preview must use actual file size, not stale db byte_size')
  } finally {
    clearTestDb()
    db.close()
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})
