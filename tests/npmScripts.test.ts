import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
}

test('npm scripts do not reference deleted local entry points', () => {
  const missing: string[] = []
  const entryPoint =
    /(?:^|\s)(?:\.\/)?((?:tests|scripts|services|apps|packages)\/[A-Za-z0-9_./-]+\.(?:ts|tsx|js|mjs|cjs))(?=\s|$)/g

  for (const [name, command] of Object.entries(pkg.scripts)) {
    for (const match of command.matchAll(entryPoint)) {
      const target = match[1]
      if (!fs.existsSync(path.join(root, target))) missing.push(`${name}: ${target}`)
    }
  }

  assert.deepEqual(missing, [], `stale npm entry points:\n${missing.join('\n')}`)
})
