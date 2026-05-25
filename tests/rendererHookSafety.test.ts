// Static-analysis guard against the specific Rules of Hooks violation that
// crashed the AI tab: a hook (useState/useRef/useEffect/useMemo/useCallback/
// useSyncExternalStore/useReducer/useContext/useImperativeHandle/useLayoutEffect/
// useDebugValue/useDeferredValue/useTransition/useId/useInsertionEffect)
// called inside an `if`/`for`/`while`/early-return body.
//
// Why static? This project has no ESLint and no react-hooks/rules-of-hooks
// plugin. The original crash sat in src/renderer/views/insights/AICompose.tsx
// — a `useRef(0)` lived inside `if (process.env.NODE_ENV === 'development')`.
// Tests passed; the live app crashed. This test scans every renderer .tsx
// for the same shape so it cannot regress silently.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const HOOK_NAMES = [
  'useState', 'useRef', 'useEffect', 'useMemo', 'useCallback',
  'useSyncExternalStore', 'useReducer', 'useContext',
  'useImperativeHandle', 'useLayoutEffect', 'useDebugValue',
  'useDeferredValue', 'useTransition', 'useId', 'useInsertionEffect',
]

function* walkTsxFiles(root: string): Generator<string> {
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.vite') continue
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
      } else if (entry.isFile() && entry.name.endsWith('.tsx')) {
        yield full
      }
    }
  }
}

// Walk the source line by line tracking brace depth and whether we're
// currently inside a control-flow block opened by `if`, `for`, `while`,
// `switch`, or `case`. A hook call detected while depth > 0 inside such
// a block is a violation. We DON'T flag hooks inside `useEffect(() => {...})`
// callbacks (those are not hook bodies, the inner content is event-time
// code) — so we exit conditional tracking when we see `(` opening on the
// same line as an arrow/function param list.
//
// This is a heuristic, not a real parser. Tradeoff: false positives are
// acceptable here (we'll address them with comments above the call). False
// negatives — which would have masked the actual bug — are not.
function findConditionalHookViolations(source: string): Array<{ line: number; preview: string }> {
  const violations: Array<{ line: number; preview: string }> = []
  const lines = source.split('\n')

  type Frame = { kind: 'conditional' | 'callback' | 'function'; openLine: number }
  const stack: Frame[] = []

  const hookCallRegex = new RegExp(`\\b(${HOOK_NAMES.join('|')})\\s*\\(`)
  const conditionalOpenRegex = /\b(?:if|for|while|switch)\s*\(/
  const arrowFunctionRegex = /=>\s*\{/
  const namedFunctionRegex = /\bfunction\s+\w*\s*\([^)]*\)\s*\{/

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Skip comments and strings — coarse, but enough.
    const stripped = line
      .replace(/\/\/.*$/, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')

    // Track open braces. We push frames based on what opened them.
    let cursor = 0
    while (cursor < stripped.length) {
      const openBrace = stripped.indexOf('{', cursor)
      const closeBrace = stripped.indexOf('}', cursor)
      if (openBrace === -1 && closeBrace === -1) break
      if (openBrace !== -1 && (closeBrace === -1 || openBrace < closeBrace)) {
        const before = stripped.slice(0, openBrace)
        let kind: Frame['kind'] = 'function'
        if (arrowFunctionRegex.test(before + '{') || namedFunctionRegex.test(before + '{')) {
          kind = 'callback'
        } else if (conditionalOpenRegex.test(before)) {
          kind = 'conditional'
        }
        stack.push({ kind, openLine: i + 1 })
        cursor = openBrace + 1
      } else if (closeBrace !== -1) {
        stack.pop()
        cursor = closeBrace + 1
      } else {
        break
      }
    }

    // Detect hook call on this line.
    const hookMatch = stripped.match(hookCallRegex)
    if (hookMatch) {
      // Walk down stack: the innermost CONDITIONAL frame (if any) signals
      // a violation, BUT only if no enclosing callback/function frame is
      // deeper than it (a useState inside an event handler arrow inside an
      // if is not the violation we're looking for).
      let innerConditionalIndex = -1
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].kind === 'conditional' && innerConditionalIndex === -1) {
          innerConditionalIndex = s
          break
        }
      }
      if (innerConditionalIndex !== -1) {
        // Check: is there a callback/function frame deeper than the
        // conditional? If yes, the hook is inside an event handler /
        // useEffect body, not directly conditional.
        let hasInnerCallback = false
        for (let s = innerConditionalIndex + 1; s < stack.length; s++) {
          if (stack[s].kind === 'callback' || stack[s].kind === 'function') {
            hasInnerCallback = true
            break
          }
        }
        if (!hasInnerCallback) {
          violations.push({ line: i + 1, preview: line.trim().slice(0, 120) })
        }
      }
    }
  }

  return violations
}

test('no React hook is called inside an if/for/while/switch body in any renderer .tsx', () => {
  const rendererRoot = path.resolve(__dirname, '..', 'src', 'renderer')
  const violations: Array<{ file: string; line: number; preview: string }> = []

  for (const file of walkTsxFiles(rendererRoot)) {
    const source = fs.readFileSync(file, 'utf8')
    const found = findConditionalHookViolations(source)
    for (const v of found) {
      violations.push({ file: path.relative(path.resolve(__dirname, '..'), file), ...v })
    }
  }

  if (violations.length > 0) {
    const lines = violations.map((v) => `  ${v.file}:${v.line}  ${v.preview}`).join('\n')
    assert.fail(`Conditional hook call(s) detected (Rules of Hooks violation):\n${lines}`)
  }
})

test('AICompose.tsx specifically does not call useRef inside a NODE_ENV check', () => {
  // Tight regression for the exact bug that crashed the AI tab.
  const file = path.resolve(__dirname, '..', 'src', 'renderer', 'views', 'insights', 'AICompose.tsx')
  const source = fs.readFileSync(file, 'utf8')
  // The bug shape: `if (process.env.NODE_ENV ...)` containing a hook call
  // before its closing brace.
  const ifBlockRegex = /if\s*\(\s*process\.env\.NODE_ENV[\s\S]*?\)\s*\{([\s\S]*?)\}/g
  let match: RegExpExecArray | null
  while ((match = ifBlockRegex.exec(source)) !== null) {
    const body = match[1]
    for (const hook of HOOK_NAMES) {
      const callRegex = new RegExp(`\\b${hook}\\s*\\(`)
      assert.ok(
        !callRegex.test(body),
        `AICompose.tsx: hook ${hook}() found inside NODE_ENV check — this caused the AI tab crash; move it out of the if-block`,
      )
    }
  }
})
