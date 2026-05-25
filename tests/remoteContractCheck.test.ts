import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkRemoteContract } from '../scripts/check-remote-contract.mjs'

function writeContractRepo(root: string, repoName: string, source: string, contractVersion = '2026-04-20-r2') {
  const repoRoot = path.join(root, repoName)
  fs.mkdirSync(path.join(repoRoot, 'packages/remote-contract'), { recursive: true })
  fs.writeFileSync(path.join(repoRoot, 'packages/remote-contract/package.json'), JSON.stringify({
    name: '@daylens/remote-contract',
    version: '0.1.1',
  }, null, 2))
  fs.writeFileSync(path.join(repoRoot, 'packages/remote-contract/manifest.json'), JSON.stringify({
    name: '@daylens/remote-contract',
    version: '0.1.1',
    contractVersion,
  }, null, 2))
  fs.writeFileSync(path.join(repoRoot, 'packages/remote-contract/index.ts'), source)
  return repoRoot
}

test('contract check passes when manifest metadata and source content match', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-contract-ok-'))
  const source = 'export const REMOTE_CONTRACT_VERSION = "2026-04-20-r2";\nexport const shape = "same";\n'
  const repoRoot = writeContractRepo(tmpRoot, 'daylens', source)
  writeContractRepo(tmpRoot, 'daylens-web', source)

  const result = checkRemoteContract({
    repoRoot,
    siblingRepo: '../daylens-web',
  })

  assert.equal(result.contractVersion, '2026-04-20-r2')
  assert.ok(result.sourceHash.length > 0)
})

test('contract check fails when sibling source content drifts even if manifest metadata matches', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-contract-drift-'))
  const repoRoot = writeContractRepo(
    tmpRoot,
    'daylens',
    'export const REMOTE_CONTRACT_VERSION = "2026-04-20-r2";\nexport const shape = "desktop";\n',
  )
  writeContractRepo(
    tmpRoot,
    'daylens-web',
    'export const REMOTE_CONTRACT_VERSION = "2026-04-20-r2";\nexport const shape = "web";\n',
  )

  assert.throws(() => checkRemoteContract({
    repoRoot,
    siblingRepo: '../daylens-web',
  }), /source drift/i)
})
