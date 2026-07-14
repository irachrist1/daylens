// Flat ESLint config. A correctness-focused baseline for the TypeScript source
// under src/ and packages/. Two concerns are deliberately delegated, not duplicated:
//   - Formatting is owned by Prettier (eslint-config-prettier disables stylistic rules).
//   - Unused locals/params are owned by tsc (noUnusedLocals/noUnusedParameters).
// This keeps the lint signal about real bugs, not style or things tsc already catches.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import prettier from 'eslint-config-prettier'

// AGENTS.md bans meta-commentary in source: no dates, internal codenames, names,
// or citations of docs/ paths that can be renamed or deleted out from under the
// comment. This rule makes that a lint failure instead of a convention to remember.
const DATE_RE = /\b(19|20)\d{2}-\d{2}-\d{2}\b/
const CODENAME_RE = /\bWave\s?\d+\b|\bStage\s?\d+(\.\d+)?\b|\bW\d-[A-D]\b|\bSession\s?[A-F]\b/
const PERSON_RE = /\bfounder\b/i
const DOC_REF_RE = /\bdocs\/(specs|adr|findings|agent-sessions|roadmap|research)\b|\bADR\s?0?\d{3,4}\b/i

const noMetaCommentary = {
  rules: {
    'no-meta-commentary': {
      create(context) {
        return {
          Program() {
            for (const comment of context.sourceCode.getAllComments()) {
              const text = comment.value
              if (
                DATE_RE.test(text) ||
                CODENAME_RE.test(text) ||
                PERSON_RE.test(text) ||
                DOC_REF_RE.test(text)
              ) {
                context.report({
                  loc: comment.loc,
                  message:
                    'Meta-commentary: no dates, internal codenames, names, or docs/ path citations in comments (AGENTS.md). State the invariant itself instead.',
                })
              }
            }
          },
        }
      },
    },
  },
}

export default tseslint.config(
  {
    ignores: [
      '.vite/**',
      'dist/**',
      'dist-release/**',
      'out/**',
      'build/**',
      'coverage/**',
      // Generated BIP-39 word list: data, not logic.
      'src/main/services/bip39wordlist.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Only the two classic Hooks correctness rules. The React-Compiler-era rules
    // in recommended-latest (purity, immutability, set-state-in-render, ...) are
    // valuable but a separate, deliberate adoption, not part of the debt floor.
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    rules: {
      // TypeScript resolves identifiers and globals itself; no-undef only yields
      // false positives in a TS project (typescript-eslint's own guidance).
      'no-undef': 'off',
      // Owned by tsc via noUnusedLocals/noUnusedParameters.
      '@typescript-eslint/no-unused-vars': 'off',
      // Removing stray console.* has its own phase; don't gate the floor on it.
      'no-console': 'off',
      // A few explicit anys at untyped boundaries (Sentry payloads, one
      // cross-projection arg). Kept as warnings so they stay visible in review
      // without hard-failing the floor — not a license to add more.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    plugins: { local: noMetaCommentary },
    rules: { 'local/no-meta-commentary': 'error' },
  },
  // Keep last: disables any rules that would fight Prettier.
  prettier,
)
