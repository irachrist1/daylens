// Repository boundary (capture spec, storage and repository boundaries;
// DEV-171): no renderer, AI tool, agent tool, MCP tool, or sync encoder may
// query a raw evidence table directly. They read shared activity-fact
// queries after projection and correction; raw SQL over evidence tables
// belongs to the repository layer (src/main/db) and the capture writers.
// This scan fails the moment a consumer regains a direct raw-table query.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const RAW_EVIDENCE_TABLES = ['app_sessions', 'website_visits', 'focus_events'] as const

// SQL that READS a raw evidence table (FROM/JOIN over any of the raw names,
// including their FTS shadows). Write statements are deliberately outside
// this check: capture writers own inserts, and deletion centralization by
// evidence identity is its own migration slice.
const RAW_TABLE_PATTERN = new RegExp(
  `(?:(?<!DELETE\\s)FROM|JOIN)\\s+(?:${RAW_EVIDENCE_TABLES.join('|')})(?:_fts)?\\b`,
  'i',
)

function isCommentLine(line: string): boolean {
  const trimmed = line.trimStart()
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')
}

// The consumer surfaces the specification names explicitly. Everything under
// these roots must stay free of raw evidence SQL; the repository layer
// (src/main/db) and the capture/projection internals are not listed here.
const CONSUMER_ROOTS = [
  'src/renderer',
  'src/preload',
  'src/main/ai',
  'src/main/agent',
  'src/main/ipc',
  'packages/mcp-server/src',
  'packages/remote-contract',
] as const

const CONSUMER_FILES = [
  'src/main/services/aiTools.ts',
  'src/main/services/naturalSearch.ts',
  'src/main/services/mcpServer.ts',
  'src/main/services/syncUploader.ts',
  'src/main/services/syncState.ts',
  'src/main/services/appDetail.ts',
  'src/main/services/appActivityDigest.ts',
  'src/main/services/activityFacts.ts',
] as const

function listSourceFiles(root: string): string[] {
  const absolute = path.resolve(root)
  if (!fs.existsSync(absolute)) return []
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue
        walk(full)
      } else if (/\.(ts|tsx|mts|cts)$/.test(entry.name)) {
        out.push(full)
      }
    }
  }
  walk(absolute)
  return out
}

test('no consumer surface queries a raw evidence table directly', () => {
  const files = [
    ...CONSUMER_ROOTS.flatMap((root) => listSourceFiles(root)),
    ...CONSUMER_FILES.map((file) => path.resolve(file)).filter((file) => fs.existsSync(file)),
  ]
  assert.ok(files.length > 50, `boundary scan looks broken: only ${files.length} files found`)

  const violations: string[] = []
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8')
    const lines = content.split('\n')
    lines.forEach((line, index) => {
      if (isCommentLine(line)) return
      if (RAW_TABLE_PATTERN.test(line)) {
        violations.push(`${path.relative(process.cwd(), file)}:${index + 1}: ${line.trim()}`)
      }
    })
  }

  assert.deepEqual(
    violations,
    [],
    `Consumer surfaces must read shared activity-fact queries, not raw evidence tables.\n${violations.join('\n')}`,
  )
})
