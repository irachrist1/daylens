import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanWorkSubject,
  isDisqualifiedWorkSubject,
  isToolBrandName,
  looksLikeCommandLine,
  looksLikeJoinedTabTitle,
} from '../src/shared/workNameGuards.ts'

// Every rejected string below LEAKED into a real period wrap as a thread
// subject or stretch label.

test('tool brands are never work subjects, decorated or not', () => {
  assert.ok(isToolBrandName('Claude Code'))
  assert.ok(isToolBrandName('✳ Claude Code'))
  assert.ok(isToolBrandName('claude'))
  assert.ok(isToolBrandName('OpenCode'))
  assert.ok(!isToolBrandName('Claude Platform caching docs'))
})

test('terminal commands are never work subjects', () => {
  assert.ok(looksLikeCommandLine('npx @agent-native/core@latest skills add visual-plans'))
  assert.ok(looksLikeCommandLine('git rebase -i main'))
  assert.ok(looksLikeCommandLine('npm run dev'))
  assert.ok(!looksLikeCommandLine('Redesigning the SPCS website'))
  assert.ok(!looksLikeCommandLine('Q3 proposal'))
})

test('joined tab titles are never work subjects', () => {
  assert.ok(looksLikeJoinedTabTitle('Branch · Branch · Space Visualization Prep'))
  assert.ok(looksLikeJoinedTabTitle('OC | Apply founder design'))
  assert.ok(!looksLikeJoinedTabTitle('Machine Learning Pipeline'))
})

test('the combined gate rejects all real leaks and passes real work', () => {
  const leaks = [
    '✳ Claude Code', 'Claude', 'npx @agent-native/core@latest skills add visual-plans',
    'Branch · Branch · Space Visualization Prep', '',
  ]
  for (const leak of leaks) assert.ok(isDisqualifiedWorkSubject(leak), `should reject: "${leak}"`)
  const real = ['Redesigning SPCS Group website', 'CCI cafeteria pitch', 'Prompt cache hit rate drop investigation']
  for (const subject of real) assert.ok(!isDisqualifiedWorkSubject(subject), `should pass: "${subject}"`)
})

test('cleanWorkSubject strips decorations but keeps the real subject', () => {
  assert.equal(cleanWorkSubject('⠂ Review article skills for Codex and Cursor integration'), 'Review article skills for Codex and Cursor integration')
  assert.equal(cleanWorkSubject('✳ Claude Code'), null)
  assert.equal(cleanWorkSubject('npx @agent-native/core@latest skills add visual-plans'), null)
  assert.equal(cleanWorkSubject('  '), null)
  assert.equal(cleanWorkSubject('Q3 proposal'), 'Q3 proposal')
})
