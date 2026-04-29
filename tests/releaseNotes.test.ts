import test from 'node:test'
import assert from 'node:assert/strict'
import { extractReleaseHighlights } from '../src/renderer/lib/releaseNotes.ts'

test('release highlights prefer short user-facing bullets over internal implementation detail', () => {
  const notes = `
## Daylens 1.0.33

### Highlights

### Fixed
- **Follow-up suggestions no longer show garbage entities.** Router-set topics (e.g. "The", "Hey Tonny") are now validated against a grammar-word stop list before reaching scopedCandidates, eliminating suggestions like "What drove The?"
- **Files tab now reliably shows generated artifacts.** The listArtifacts refresh in handleSend previously used a stale closure for the thread ID on new threads.

### Included commits
- 26f934c release: v1.0.33

### Downloads
- Windows installer: \`Daylens-1.0.33-Setup.exe\`
`

  assert.deepEqual(extractReleaseHighlights(notes), [
    'Follow-up suggestions no longer show garbage entities.',
    'Files tab now reliably shows generated artifacts.',
  ])
})

test('release highlights strip html release notes', () => {
  const notes = '<h3>Fixed</h3><ul><li><strong>Updater is clearer.</strong> Downloads no longer show fake zero percent.</li></ul>'
  assert.deepEqual(extractReleaseHighlights(notes), [
    'Updater is clearer. Downloads no longer show fake zero percent.',
  ])
})

test('release highlights ignore internal html sections from GitHub release bodies', () => {
  const notes = `
    <h3>Fixed</h3>
    <ul><li><strong>Updates are clearer.</strong> Downloads no longer show fake zero percent.</li></ul>
    <h3>Included commits</h3>
    <ul><li>abc1234 fix(updater): rewrite scopedCandidates regex</li></ul>
    <h3>Downloads</h3>
    <ul><li>Windows installer: <code>Daylens-1.0.35-Setup.exe</code></li></ul>
  `

  assert.deepEqual(extractReleaseHighlights(notes), [
    'Updates are clearer. Downloads no longer show fake zero percent.',
  ])
})
