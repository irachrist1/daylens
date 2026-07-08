// Shared guards for what may be NAMED as work — one vocabulary for the day
// facts, the frozen snapshots, and every wrap surface (Stage 0.1 period
// audit, 2026-07-08). A tool brand is the instrument of the work, never its
// subject; a terminal command or a joined tab title is a capture artifact,
// never a thread. These leaked into real period wraps as "what the week was
// really about": "✳ Claude Code", "npx @agent-native/core@latest skills add
// visual-plans", "Branch · Branch · Space Visualization Prep".

/** Tool brands that are the INSTRUMENT of the work, never its subject. */
export const TOOL_BRAND_NAMES = new Set([
  'claude code', 'claude', 'chatgpt', 'cursor', 'warp', 'raycast', 'raycast beta',
  'copilot', 'github copilot', 'terminal', 'iterm', 'iterm2', 'vs code', 'vscode',
  'visual studio code', 'xcode', 'ai chat', 'gemini', 'codex', 'windsurf', 'zed',
  'opencode', 'comet', 'dia', 'safari', 'chrome', 'google chrome', 'firefox',
  'arc', 'edge', 'microsoft edge', 'ghostty',
])

/** True when the name IS a tool brand (after stripping decorative prefixes —
 *  a captured "✳ Claude Code" is still the tool, not a work subject). */
export function isToolBrandName(name: string): boolean {
  const cleaned = name.trim().toLowerCase().replace(/^[^a-z0-9]+/, '').trim()
  return TOOL_BRAND_NAMES.has(cleaned)
}

const CLI_VERBS = /^(npx|npm|pnpm|yarn|node|git|gh|python3?|pip3?|brew|cargo|go|docker|kubectl|curl|wget|make|sudo|cd|ls|rm|cp|mv|ssh|scp|bash|zsh|sh)\b/i

/** True when the label reads as a terminal command, not a human work name:
 *  a CLI verb lead, an npm-style @scope/package ref, or shell flag syntax. */
export function looksLikeCommandLine(label: string): boolean {
  const trimmed = label.trim()
  if (CLI_VERBS.test(trimmed)) return true
  if (/@[a-z0-9-]+\/[a-z0-9-]+/i.test(trimmed)) return true
  if (/\s--?[a-z][a-z-]*(\s|$)/.test(trimmed)) return true
  return false
}

/** True when the label is a joined multi-segment tab/window title (the " · "
 *  and " | " joiners are UI chrome; no human names their work with them). */
export function looksLikeJoinedTabTitle(label: string): boolean {
  return /\s[·|]\s/.test(label)
}

/** The one gate for "may this string name a thread / stretch / activity":
 *  rejects tool brands, terminal commands, and joined tab titles. Callers
 *  layer their own raw-artifact checks (filenames, spinner glyphs) on top. */
export function isDisqualifiedWorkSubject(label: string): boolean {
  const trimmed = label.trim()
  if (!trimmed) return true
  return isToolBrandName(trimmed) || looksLikeCommandLine(trimmed) || looksLikeJoinedTabTitle(trimmed)
}

/** Sanitize-then-check: strips capture decorations (braille spinner glyphs,
 *  control chars, leading symbols) and returns the cleaned subject, or null
 *  when what remains is disqualified. "⠂ Review article skills" keeps its
 *  real subject; "✳ Claude Code" cleans to a tool brand and dies. */
export function cleanWorkSubject(label: string): string | null {
  const cleaned = label
    .replace(/[\u2800-\u28FF]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F]/g, '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length < 3) return null
  if (isDisqualifiedWorkSubject(cleaned)) return null
  return cleaned
}
