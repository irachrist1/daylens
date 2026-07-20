// Safe agent file access (agent-runtime-and-context.md §File and document
// access, DEV-184): deny-by-default content reads above the visible-home
// floor, the in-chat Allow once / Allow this folder / Deny flow, disclosure
// recorded before content returns, revocation deleting derived text and
// blocking the next read, the symlink floor surviving any grant, git content
// gating, and indexed-never-escalates.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createProductionTestDatabase } from './support/testDatabase.ts'
import { buildSystemTools, type FileAccessAnswer } from '../src/main/agent/systemTools.ts'
import {
  addFileAccessGrant,
  classifyFileSensitivity,
  listFileAccessGrants,
  listFileDisclosures,
  resolveFileAccess,
  revokeFileAccessGrant,
  storeDerivedText,
} from '../src/main/services/fileAccess.ts'

function makeHome(): { home: string; documents: string } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-fa-home-'))
  const documents = path.join(home, 'Documents')
  fs.mkdirSync(documents, { recursive: true })
  return { home, documents }
}

function toolDeps(home: string, options: {
  answer?: FileAccessAnswer
  onAsk?: (request: { path: string; sizeBytes: number | null; reason: string }) => void
} = {}) {
  const db = createProductionTestDatabase()
  const asked: Array<{ path: string; sizeBytes: number | null; reason: string }> = []
  const tools = buildSystemTools({
    db,
    homeDir: home,
    fileAccess: {
      db,
      threadId: 7,
      destination: 'anthropic:claude-test',
      requestFileAccess: options.answer
        ? async (request) => {
            asked.push(request)
            options.onAsk?.(request)
            return options.answer!
          }
        : undefined,
    },
  })
  return { db, tools, asked }
}

test('read_file is deny-by-default: no grant and no asker → permissionRequired, metadata stays visible', async () => {
  const { home, documents } = makeHome()
  fs.writeFileSync(path.join(documents, 'plan.md'), 'launch plan contents')
  const { db, tools } = toolDeps(home)
  try {
    const result = await (tools.read_file as any).execute({ path: path.join(documents, 'plan.md') }, {} as any)
    assert.equal(result.found, false)
    assert.equal(result.permissionRequired, true)
    assert.equal(result.content, undefined)

    // Metadata-level operations still work with zero grants (Observed state).
    const listed = await (tools.list_dir as any).execute({ path: documents }, {} as any)
    assert.equal(listed.found, true)
    assert.ok(listed.entries.some((entry: { name: string }) => entry.name === 'plan.md'))

    // Nothing was disclosed.
    assert.equal(listFileDisclosures(db).length, 0)
  } finally {
    db.close()
  }
})

test('the in-chat card: Allow once reads exactly this turn; Deny answers gracefully; Allow this folder persists a chat grant', async () => {
  const { home, documents } = makeHome()
  const filePath = path.join(documents, 'notes.md')
  fs.writeFileSync(filePath, 'meeting notes body')

  // Deny.
  {
    const { db, tools, asked } = toolDeps(home, { answer: 'deny' })
    const result = await (tools.read_file as any).execute({ path: filePath }, {} as any)
    assert.equal(result.found, false)
    assert.match(result.reason, /declined/)
    assert.equal(asked.length, 1)
    assert.ok(asked[0].path.endsWith('notes.md'))
    assert.equal(listFileDisclosures(db).length, 0, 'a denied read discloses nothing')
    db.close()
  }

  // Allow once: content comes back, disclosure recorded, but NO durable grant.
  {
    const { db, tools } = toolDeps(home, { answer: 'allow_once' })
    const result = await (tools.read_file as any).execute({ path: filePath }, {} as any)
    assert.equal(result.found, true)
    assert.equal(result.content, 'meeting notes body')
    assert.equal(listFileAccessGrants(db).length, 0, 'Allow once persists no grant')
    const disclosures = listFileDisclosures(db)
    assert.equal(disclosures.length, 1)
    assert.equal(disclosures[0].thread_id, 7)
    assert.equal(disclosures[0].destination, 'anthropic:claude-test')
    assert.ok(disclosures[0].version_fingerprint.length > 0)
    db.close()
  }

  // Allow this folder: a durable chat-sourced model-readable folder grant.
  {
    const { db, tools, asked } = toolDeps(home, { answer: 'allow_folder' })
    const first = await (tools.read_file as any).execute({ path: filePath }, {} as any)
    assert.equal(first.found, true)
    const grants = listFileAccessGrants(db)
    assert.equal(grants.length, 1)
    assert.equal(grants[0].scope_kind, 'folder')
    assert.equal(grants[0].state, 'model_readable')
    assert.equal(grants[0].source, 'chat')

    // A sibling file in the same folder now reads without another prompt.
    const sibling = path.join(documents, 'other.md')
    fs.writeFileSync(sibling, 'second file')
    const second = await (tools.read_file as any).execute({ path: sibling }, {} as any)
    assert.equal(second.found, true)
    assert.equal(asked.length, 1, 'the folder grant covers the sibling — no second prompt')
    assert.equal(listFileDisclosures(db).length, 2, 'every content read records a disclosure')
    db.close()
  }
})

test('revocation blocks the next read and deletes derived text', async () => {
  const { home, documents } = makeHome()
  const filePath = path.join(documents, 'draft.md')
  fs.writeFileSync(filePath, 'draft body')
  const { db, tools } = toolDeps(home)
  try {
    const grant = addFileAccessGrant(db, { scopeKind: 'folder', path: documents, state: 'model_readable' })
    storeDerivedText(db, grant.id, 'extracted stub text')

    const before = await (tools.read_file as any).execute({ path: filePath }, {} as any)
    assert.equal(before.found, true)

    assert.equal(revokeFileAccessGrant(db, grant.id), true)
    const revoked = listFileAccessGrants(db, { includeRevoked: true })[0]
    assert.ok(revoked.revoked_at != null)
    assert.equal(revoked.derived_text, null, 'revocation deletes the derived text in the same statement')

    const after = await (tools.read_file as any).execute({ path: filePath }, {} as any)
    assert.equal(after.found, false, 'a revoked grant no longer reads')
    assert.equal(after.content, undefined)
  } finally {
    db.close()
  }
})

test('the visible-home floor survives any grant: a symlink escape is denied even inside a granted folder', async () => {
  const { home, documents } = makeHome()
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-fa-outside-'))
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside secret')
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(documents, 'innocent.md'))
  const { db, tools } = toolDeps(home, { answer: 'allow_once' })
  try {
    // Grant the WHOLE home, model-readable — the floor still wins.
    addFileAccessGrant(db, { scopeKind: 'folder', path: home, state: 'model_readable' })
    const result = await (tools.read_file as any).execute({ path: path.join(documents, 'innocent.md') }, {} as any)
    assert.equal(result.found, false)
    assert.equal(result.content, undefined)
    assert.equal(listFileDisclosures(db).length, 0)
  } finally {
    db.close()
  }
})

test('an indexed grant never escalates to model-readable', async () => {
  const { home, documents } = makeHome()
  const filePath = path.join(documents, 'indexed-only.md')
  fs.writeFileSync(filePath, 'locally indexed body')
  const { db, tools } = toolDeps(home)
  try {
    addFileAccessGrant(db, { scopeKind: 'folder', path: documents, state: 'indexed' })
    assert.equal(resolveFileAccess(db, filePath).access, 'indexed')
    const result = await (tools.read_file as any).execute({ path: filePath }, {} as any)
    assert.equal(result.found, false, 'indexed ≠ model-readable — the read still needs permission')
    assert.equal(result.permissionRequired, true)
  } finally {
    db.close()
  }
})

test('high-sensitivity files need the explicit extra permission even inside a model-readable grant', async () => {
  const { home, documents } = makeHome()
  const keyPath = path.join(documents, 'deploy-secret.pem')
  fs.writeFileSync(keyPath, 'PEM MATERIAL')
  assert.equal(classifyFileSensitivity(keyPath), 'high')
  const { db, tools } = toolDeps(home, { answer: 'allow_once' })
  try {
    addFileAccessGrant(db, { scopeKind: 'folder', path: documents, state: 'model_readable' })
    const denied = await (tools.read_file as any).execute({ path: keyPath }, {} as any)
    assert.equal(denied.found, false)
    assert.match(denied.reason, /high-sensitivity/i)

    // The explicit high-sensitivity permission (Settings-only) unlocks it.
    addFileAccessGrant(db, { scopeKind: 'file', path: keyPath, state: 'model_readable', allowHighSensitivity: true })
    const allowed = await (tools.read_file as any).execute({ path: keyPath }, {} as any)
    assert.equal(allowed.found, true)
    assert.equal(listFileDisclosures(db)[0].sensitivity, 'high')
  } finally {
    db.close()
  }
})

test('search_files matches names without grants but scans content only inside grants, disclosing previews', async () => {
  const { home, documents } = makeHome()
  const granted = path.join(documents, 'Granted')
  const ungranted = path.join(documents, 'Ungranted')
  fs.mkdirSync(granted, { recursive: true })
  fs.mkdirSync(ungranted, { recursive: true })
  fs.writeFileSync(path.join(granted, 'inside.md'), 'the launch plan overview lives here')
  fs.writeFileSync(path.join(ungranted, 'outside.md'), 'the launch plan overview also here')
  fs.writeFileSync(path.join(ungranted, 'launch-plan-notes.md'), 'unrelated body')
  const { db, tools } = toolDeps(home)
  try {
    addFileAccessGrant(db, { scopeKind: 'folder', path: granted, state: 'model_readable' })
    const result = await (tools.search_files as any).execute({ query: 'launch plan' }, {} as any)
    assert.equal(result.found, true)
    const byPath = new Map(result.matches.map((match: { path: string; matchedBy: string; preview: string | null }) => [match.path, match]))
    const inside = byPath.get(fs.realpathSync(path.join(granted, 'inside.md'))) as { matchedBy: string; preview: string | null } | undefined
    assert.ok(inside, 'granted content matches')
    assert.equal(inside!.matchedBy, 'content')
    assert.ok(inside!.preview)
    // The ungranted content-only file is NOT matched by content…
    assert.ok(!byPath.has(fs.realpathSync(path.join(ungranted, 'outside.md'))), 'ungranted content is never scanned into the model')
    // …but filename matches (metadata) still work without any grant.
    assert.ok(byPath.has(fs.realpathSync(path.join(ungranted, 'launch-plan-notes.md'))))
    // The one content preview recorded exactly one disclosure.
    const disclosures = listFileDisclosures(db)
    assert.equal(disclosures.length, 1)
    assert.ok(disclosures[0].file_path.endsWith('inside.md'))
  } finally {
    db.close()
  }
})

test('git: metadata subcommands stay open, content subcommands are gated and disclosed', async () => {
  const { home } = makeHome()
  const repo = path.join(home, 'Dev-Test', 'gated-project')
  fs.mkdirSync(repo, { recursive: true })
  execFileSync('git', ['init', '-q', repo])
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Test User'])
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'test@example.invalid'])
  fs.writeFileSync(path.join(repo, 'file.txt'), 'repository file contents')
  execFileSync('git', ['-C', repo, 'add', 'file.txt'])
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'Initial work'])

  const { db, tools } = toolDeps(home)
  try {
    const git = (input: { repoPath: string; subcommand: string; args?: string[] }) =>
      (tools.git as any).execute(input, {} as any)

    // Metadata git works with zero grants (Observed level).
    const log = await git({ repoPath: repo, subcommand: 'log', args: ['--oneline'] })
    assert.equal(log.found, true)
    assert.match(log.output, /Initial work/)

    // Content-bearing git is gated.
    const show = await git({ repoPath: repo, subcommand: 'show', args: ['HEAD'] })
    assert.equal(show.found, false)
    assert.equal(show.permissionRequired, true)
    const patchLog = await git({ repoPath: repo, subcommand: 'log', args: ['-p'] })
    assert.equal(patchLog.found, false, 'log -p is content-bearing and gated')

    // With a model-readable grant on the repo it works and is disclosed.
    addFileAccessGrant(db, { scopeKind: 'folder', path: fs.realpathSync(repo), state: 'model_readable' })
    const granted = await git({ repoPath: repo, subcommand: 'show', args: ['HEAD'] })
    assert.equal(granted.found, true)
    assert.match(granted.output, /repository file contents/)
    const disclosures = listFileDisclosures(db)
    assert.equal(disclosures.length, 1)
    assert.match(disclosures[0].reason, /git show/)
  } finally {
    db.close()
  }
})
