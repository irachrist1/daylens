import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const SCRIPT_DIR = path.resolve(process.cwd(), 'build/linux')

test('linux maintainer scripts avoid electron-builder macro-shaped shell variables', () => {
  for (const fileName of ['after-install.sh', 'after-remove.sh']) {
    const source = fs.readFileSync(path.join(SCRIPT_DIR, fileName), 'utf8')
    assert.doesNotMatch(
      source,
      /\$\{[A-Z_][A-Z0-9_]*\}/,
      `${fileName} should use $VAR form for shell variables because electron-builder treats \${VAR} as an fpm macro`,
    )
  }
})
