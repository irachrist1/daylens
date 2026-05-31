import type { ForwardedRef } from 'react'
import { forwardRef, memo, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { ipc } from '../../lib/ipc'
import { IconSend } from './icons'

export interface AIComposeHandle {
  focus: () => void
}

interface AIComposeProps {
  onSubmit: (text: string) => void
  loading: boolean
  placeholder?: string
}

// D5: composer affordances — `/` commands and `@` entity mentions.
type SlashCommand = { id: string; label: string; hint: string; prompt: string }
const SLASH_COMMANDS: SlashCommand[] = [
  { id: 'today', label: '/today', hint: "What I worked on today", prompt: 'What did I work on today?' },
  { id: 'week', label: '/week', hint: 'Summarise the last 7 days by project', prompt: 'Summarize my last 7 days by project.' },
  { id: 'focus', label: '/focus', hint: 'When I was most focused this week', prompt: 'When was I most focused this week?' },
  { id: 'report', label: '/report', hint: 'A weekly report to share', prompt: 'Generate a weekly report I can share with my manager.' },
  { id: 'export', label: '/export', hint: "Export today's sessions as CSV", prompt: "Export today's work sessions as CSV." },
]

// `@` day mentions are generated locally (no query needed).
const DAY_MENTIONS: { label: string; insert: string }[] = [
  { label: 'today', insert: 'today' },
  { label: 'yesterday', insert: 'yesterday' },
  { label: 'this week', insert: 'this week' },
  { label: 'last 7 days', insert: 'the last 7 days' },
  { label: 'last 30 days', insert: 'the last 30 days' },
]

type AtItem = { id: string; label: string; insert: string; kind: 'App' | 'Client' | 'Day' }
type MenuState = { kind: 'slash' | 'at'; query: string; start: number; end: number }

// Find an active `/` (line-initial) or `@` (token-initial) trigger ending at the
// caret, with no whitespace between the trigger and the caret.
function detectTrigger(value: string, caret: number): MenuState | null {
  if (value.startsWith('/')) {
    const upto = value.slice(0, caret)
    if (caret >= 1 && !/\s/.test(upto)) return { kind: 'slash', query: value.slice(1, caret), start: 0, end: caret }
  }
  const before = value.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at >= 0) {
    const precededByBoundary = at === 0 || /\s/.test(before[at - 1])
    const token = before.slice(at + 1)
    if (precededByBoundary && !/\s/.test(token)) return { kind: 'at', query: token, start: at, end: caret }
  }
  return null
}

function AIComposeImpl(
  { onSubmit, loading, placeholder }: AIComposeProps,
  ref: ForwardedRef<AIComposeHandle>,
) {
  const [input, setInput] = useState('')
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [menuIndex, setMenuIndex] = useState(0)
  // Entity candidates for `@`, fetched lazily the first time the menu opens.
  const [entities, setEntities] = useState<{ apps: string[]; clients: string[] }>({ apps: [], clients: [] })
  const entitiesLoadedRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const pendingCaretRef = useRef<number | null>(null)

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
  }), [])

  const loadEntities = () => {
    if (entitiesLoadedRef.current) return
    entitiesLoadedRef.current = true
    void Promise.all([
      ipc.db.getAppSummaries(7).catch(() => []),
      ipc.attribution.listClientsDetailed().catch(() => []),
    ]).then(([apps, clients]) => {
      setEntities({
        apps: apps.slice(0, 8).map((app) => app.appName).filter(Boolean),
        clients: clients.map((client) => client.name).filter(Boolean),
      })
    })
  }

  const atItems = useMemo<AtItem[]>(() => {
    const all: AtItem[] = [
      ...entities.apps.map((name, i) => ({ id: `app-${i}`, label: name, insert: name, kind: 'App' as const })),
      ...entities.clients.map((name, i) => ({ id: `client-${i}`, label: name, insert: name, kind: 'Client' as const })),
      ...DAY_MENTIONS.map((day, i) => ({ id: `day-${i}`, label: day.label, insert: day.insert, kind: 'Day' as const })),
    ]
    const q = (menu?.kind === 'at' ? menu.query : '').toLowerCase()
    return (q ? all.filter((item) => item.label.toLowerCase().includes(q)) : all).slice(0, 8)
  }, [entities, menu])

  const slashItems = useMemo<SlashCommand[]>(() => {
    const q = (menu?.kind === 'slash' ? menu.query : '').toLowerCase()
    return q ? SLASH_COMMANDS.filter((cmd) => cmd.id.includes(q) || cmd.hint.toLowerCase().includes(q)) : SLASH_COMMANDS
  }, [menu])

  const menuItemCount = menu?.kind === 'slash' ? slashItems.length : menu?.kind === 'at' ? atItems.length : 0

  const syncMenu = (value: string) => {
    const caret = textareaRef.current?.selectionStart ?? value.length
    const next = detectTrigger(value, caret)
    setMenu(next)
    setMenuIndex(0)
    if (next?.kind === 'at') loadEntities()
  }

  const onChange = (value: string) => {
    setInput(value)
    syncMenu(value)
  }

  const applyCaret = (caret: number) => {
    pendingCaretRef.current = caret
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el && pendingCaretRef.current != null) {
        el.focus()
        el.setSelectionRange(pendingCaretRef.current, pendingCaretRef.current)
        pendingCaretRef.current = null
      }
    })
  }

  const selectSlash = (cmd: SlashCommand) => {
    if (!menu) return
    const next = cmd.prompt + input.slice(menu.end)
    setInput(next)
    setMenu(null)
    applyCaret(cmd.prompt.length)
  }

  const selectAt = (item: AtItem) => {
    if (!menu) return
    const insert = `${item.insert} `
    const next = input.slice(0, menu.start) + insert + input.slice(menu.end)
    setInput(next)
    setMenu(null)
    applyCaret(menu.start + insert.length)
  }

  const send = () => {
    const text = input.trim()
    if (!text || loading) return
    onSubmit(text)
    setInput('')
    setMenu(null)
    textareaRef.current?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (menu && menuItemCount > 0) {
      if (event.key === 'ArrowDown') { event.preventDefault(); setMenuIndex((i) => Math.min(menuItemCount - 1, i + 1)); return }
      if (event.key === 'ArrowUp') { event.preventDefault(); setMenuIndex((i) => Math.max(0, i - 1)); return }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        if (menu.kind === 'slash') selectSlash(slashItems[menuIndex])
        else selectAt(atItems[menuIndex])
        return
      }
      if (event.key === 'Escape') { event.preventDefault(); setMenu(null); return }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    }
  }

  const trimmed = input.trim()
  const showMenu = Boolean(menu) && menuItemCount > 0

  return (
    <div style={{ position: 'relative' }}>
      {showMenu && (
        <div
          role="listbox"
          aria-label={menu?.kind === 'slash' ? 'Commands' : 'Mentions'}
          style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, right: 0, maxHeight: 240, overflowY: 'auto', background: 'var(--color-surface)', border: '1px solid var(--color-border-ghost)', borderRadius: 12, boxShadow: '0 12px 32px rgba(0,0,0,0.18)', padding: 5, zIndex: 30 }}
        >
          {menu?.kind === 'slash'
            ? slashItems.map((cmd, idx) => (
              <button
                key={cmd.id}
                type="button"
                role="option"
                aria-selected={idx === menuIndex}
                onMouseEnter={() => setMenuIndex(idx)}
                onMouseDown={(e) => { e.preventDefault(); selectSlash(cmd) }}
                style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, width: '100%', textAlign: 'left', padding: '8px 10px', border: 'none', borderRadius: 7, background: idx === menuIndex ? 'var(--color-surface-muted)' : 'transparent', color: 'var(--color-text-primary)', cursor: 'pointer', fontSize: 12.5 }}
              >
                <span style={{ fontWeight: 700 }}>{cmd.label}</span>
                <span style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)' }}>{cmd.hint}</span>
              </button>
            ))
            : atItems.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={idx === menuIndex}
                onMouseEnter={() => setMenuIndex(idx)}
                onMouseDown={(e) => { e.preventDefault(); selectAt(item) }}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, width: '100%', textAlign: 'left', padding: '8px 10px', border: 'none', borderRadius: 7, background: idx === menuIndex ? 'var(--color-surface-muted)' : 'transparent', color: 'var(--color-text-primary)', cursor: 'pointer', fontSize: 12.5 }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', flexShrink: 0 }}>{item.kind}</span>
              </button>
            ))}
        </div>
      )}
      <div style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 8,
        borderRadius: 16,
        border: '1px solid var(--color-border-ghost)',
        background: 'var(--color-surface)',
        padding: '8px 8px 8px 16px',
        boxShadow: 'var(--color-shadow-floating)',
      }}>
        <textarea
          ref={textareaRef}
          className="ai-composer-input"
          value={input}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => setMenu(null)}
          disabled={loading}
          rows={1}
          autoFocus
          aria-label="Ask Daylens about your work history"
          placeholder={placeholder ?? 'Ask anything — / for commands, @ to mention…'}
          style={{
            flex: 1,
            minHeight: 24,
            maxHeight: 184,
            overflowY: 'auto',
            border: 'none',
            background: 'transparent',
            outline: 'none',
            color: 'var(--color-text-primary)',
            fontSize: 13.5,
            lineHeight: '22px',
            resize: 'none',
            padding: '6px 0',
            display: 'block',
          }}
        />
        <button
          onClick={send}
          disabled={loading || !trimmed}
          type="button"
          aria-label="Send message"
          style={{
            width: 34,
            height: 34,
            padding: 0,
            borderRadius: 999,
            border: 'none',
            cursor: loading || !trimmed ? 'default' : 'pointer',
            background: trimmed && !loading ? 'var(--gradient-primary)' : 'var(--color-surface-high)',
            color: trimmed && !loading ? 'var(--color-primary-contrast)' : 'var(--color-text-tertiary)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            transition: 'background 160ms ease, color 160ms ease',
          }}
        >
          <IconSend />
        </button>
      </div>
    </div>
  )
}

// React.memo so chunk-driven parent re-renders skip the composer entirely.
// `onSubmit` is a useRef-stable callback from the parent, so the composer's
// only real re-render trigger is the `loading` prop.
export const AICompose = memo(forwardRef<AIComposeHandle, AIComposeProps>(AIComposeImpl))
