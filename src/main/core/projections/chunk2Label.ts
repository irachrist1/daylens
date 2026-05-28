// Label cleaning rules for Chunk 2 projections.
//
// Spec: docs/CHUNK-2-PROJECTIONS-SPEC.md "Cleaning rules":
//   - No literal pipes. "Course | Perusall" -> the longest content segment.
//   - No raw window titles as labels.
//   - No shell usernames or bare cwd strings for terminal apps.

const SHELL_USERNAMES = new Set(['tonny', 'root', 'admin', 'user'])
const TERMINAL_HOSTS = ['ghostty', 'iterm', 'terminal', 'warp', 'kitty', 'alacritty', 'wezterm']

export function naturalizeProjectionLabel(raw: string | null | undefined): string {
  if (!raw) return ''
  let s = raw.trim()
  if (!s) return ''

  // Drop trailing "— App Name" / "- App Name" tails that browsers append.
  s = s.replace(/\s+[–—-]\s+[^|]+$/, (m) => {
    const tail = m.replace(/^\s+[–—-]\s+/, '').trim().toLowerCase()
    if (
      tail.includes('google chrome') ||
      tail.includes('safari') ||
      tail.includes('firefox') ||
      tail.includes('arc') ||
      tail.includes('brave') ||
      tail.includes('edge') ||
      tail.includes('dia') ||
      tail.includes('comet') ||
      tail.includes('opera') ||
      tail.includes('vivaldi')
    ) {
      return ''
    }
    return m
  })

  // Pipes — pick the longest non-trivial segment.
  if (s.includes('|')) {
    const parts = s.split('|').map((p) => p.trim()).filter((p) => p.length > 1)
    if (parts.length > 0) {
      s = parts.reduce((a, b) => (b.length > a.length ? b : a), parts[0])
    }
  }

  // Strip shell-username prefix on terminal titles like "tonny@host:~/dir".
  if (TERMINAL_HOSTS.some((t) => s.toLowerCase().startsWith(t))) return ''
  for (const u of SHELL_USERNAMES) {
    if (s.toLowerCase().startsWith(`${u}@`)) return ''
  }

  // Collapse whitespace.
  s = s.replace(/\s+/g, ' ').trim()

  // Avoid labels that are bare URLs.
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s)
      return u.hostname.replace(/^www\./, '')
    } catch {
      return s
    }
  }

  return s
}
