import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AppWindow,
  Box,
  Clock,
  Download,
  FileText,
  Globe,
  LayoutGrid,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Timer,
} from 'lucide-react'
import { ipc } from '../lib/ipc'
import { dateStringFromMs, todayString } from '../lib/format'
import {
  dedupeAndRankResults,
  isNaturalQuery,
  searchResultSourceKind,
  searchResultSubtitle,
  searchResultTitle,
  type SearchSourceKind,
} from '../lib/searchResults'
import { useCommandSurfaceActions, type CommandSurfaceAction } from '../lib/commandSurface'
import type { DayTimelinePayload, FocusSession } from '@shared/types'
import type { DaylensSearchResult } from '../../preload/index'

export interface CommandPaletteProps {
  isOpen: boolean
  platform: 'macos' | 'windows' | 'linux'
  onClose: () => void
  onOpenWrapped: (payload: { day: DayTimelinePayload; threadId: number | null; artifactId: number | null }) => void
}

// Section order, top to bottom (FB1 §Target behavior).
const GROUP_ORDER = [
  'Search results',
  'Actions for this message',
  'Chat',
  'Navigate',
  'Day Wrapped',
  'Focus',
  'Tools',
] as const
type GroupLabel = (typeof GROUP_ORDER)[number]

interface PaletteItem {
  id: string
  group: GroupLabel
  label: string
  hint?: string
  accelerator?: string
  keywords?: string
  icon?: ReactNode
  // Present on search rows, which render the richer result card.
  result?: DaylensSearchResult
  perform: () => void | Promise<void>
}

function fuzzyScore(haystack: string, needle: string): number {
  if (!needle) return 1
  const h = haystack.toLowerCase()
  const n = needle.toLowerCase()
  if (h.startsWith(n)) return 4
  if (h.includes(` ${n}`)) return 3
  if (h.includes(n)) return 2
  let i = 0
  for (const ch of h) {
    if (ch === n[i]) i += 1
    if (i === n.length) return 1
  }
  return 0
}

function sourceIcon(kind: SearchSourceKind): ReactNode {
  switch (kind) {
    case 'web': return <Globe size={15} strokeWidth={1.8} aria-hidden="true" />
    case 'app': return <AppWindow size={15} strokeWidth={1.8} aria-hidden="true" />
    case 'block': return <Box size={15} strokeWidth={1.8} aria-hidden="true" />
    case 'file': return <FileText size={15} strokeWidth={1.8} aria-hidden="true" />
  }
}

function formatSearchTimestamp(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function HighlightedExcerpt({ text }: { text: string }) {
  const parts = text.split(/(\[\[mark\]\]|\[\[\/mark\]\])/g)
  let on = false
  return (
    <>
      {parts.map((part, index) => {
        if (part === '[[mark]]') { on = true; return null }
        if (part === '[[/mark]]') { on = false; return null }
        if (!part) return null
        return on
          ? <mark key={index} style={{ background: 'var(--color-accent-dim)', color: 'var(--color-text-primary)', borderRadius: 4, padding: '0 2px' }}>{part}</mark>
          : <span key={index}>{part}</span>
      })}
    </>
  )
}

function Keycap({ children }: { children: ReactNode }) {
  return (
    <span style={{
      fontSize: 11,
      lineHeight: '18px',
      minWidth: 18,
      height: 18,
      padding: '0 5px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 5,
      background: 'var(--color-surface-high)',
      color: 'var(--color-text-tertiary)',
      fontVariantNumeric: 'tabular-nums',
      fontFamily: 'var(--font-sans)',
    }}>
      {children}
    </span>
  )
}

export default function CommandPalette({ isOpen, platform, onClose, onOpenWrapped }: CommandPaletteProps) {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [highlightIdx, setHighlightIdx] = useState(0)
  const [activeFocus, setActiveFocus] = useState<FocusSession | null>(null)
  const [results, setResults] = useState<DaylensSearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [intent, setIntent] = useState<string | null>(null)
  const [matchTerms, setMatchTerms] = useState<string[]>([])

  // FB1: the AI workspace publishes its contextual message/chat actions here.
  const contextActions = useCommandSurfaceActions()

  useEffect(() => {
    if (!isOpen) return
    setQuery('')
    setHighlightIdx(0)
    setResults([])
    setIntent(null)
    setMatchTerms([])
    setSearchError(null)
    requestAnimationFrame(() => inputRef.current?.focus())
    void ipc.focus.getActive().then(setActiveFocus).catch(() => setActiveFocus(null))
  }, [isOpen])

  // FB2: search lives in ⌘K. Literal short queries → instant local FTS (no
  // provider). Longer / question-shaped queries → the natural-language path.
  useEffect(() => {
    if (!isOpen) return
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults([]); setSearchLoading(false); setSearchError(null); setIntent(null); setMatchTerms([])
      return
    }
    const natural = isNaturalQuery(trimmed)
    let cancelled = false
    setSearchLoading(true)
    setSearchError(null)
    const handle = window.setTimeout(() => {
      const run = natural
        ? ipc.search.natural(trimmed, { limit: 24 }).then((response) => {
            if (cancelled) return
            setResults(dedupeAndRankResults(response.results, trimmed))
            setIntent(response.intent)
            setMatchTerms(response.terms)
          })
        : ipc.search.all(trimmed, { limit: 24 }).then((rows) => {
            if (cancelled) return
            setResults(dedupeAndRankResults(rows, trimmed))
            setIntent(null)
            setMatchTerms([])
          })
      run
        .catch((error) => { if (!cancelled) { setResults([]); setSearchError(error instanceof Error ? error.message : String(error)) } })
        .finally(() => { if (!cancelled) setSearchLoading(false) })
    }, natural ? 420 : 160)
    return () => { cancelled = true; window.clearTimeout(handle) }
  }, [query, isOpen])

  const close = useCallback(() => {
    onClose()
    setQuery('')
    setHighlightIdx(0)
  }, [onClose])

  const openWrappedFor = useCallback(async (date: string) => {
    const day = await ipc.db.getTimelineDay(date)
    onOpenWrapped({ day, threadId: null, artifactId: null })
  }, [onOpenWrapped])

  // FB2: choosing a result navigates to where it lives — never opens a chat/tab.
  const handleResultClick = useCallback((result: DaylensSearchResult) => {
    if (result.type === 'artifact') { void ipc.ai.openArtifact(result.id); return }
    if (result.type === 'browser' && result.url) { ipc.shell.openExternal(result.url); return }
    navigate(`/timeline?date=${encodeURIComponent(result.date)}`)
  }, [navigate])

  // Static commands (navigate / wrapped / focus / tools). The contextual chat
  // actions come from the store; the search rows come from `results`.
  const staticActions: PaletteItem[] = useMemo(() => [
    { id: 'nav-timeline', group: 'Navigate', label: 'Open Timeline', hint: 'Day and week view', keywords: 'today day week', icon: <Clock size={15} strokeWidth={1.8} />, perform: () => navigate('/timeline') },
    { id: 'nav-apps', group: 'Navigate', label: 'Open Apps', hint: 'Per-app context', keywords: 'tools applications', icon: <LayoutGrid size={15} strokeWidth={1.8} />, perform: () => navigate('/apps') },
    { id: 'nav-ai', group: 'Navigate', label: 'Open AI', hint: 'Chat with Daylens', keywords: 'chat insights ask', icon: <Sparkles size={15} strokeWidth={1.8} />, perform: () => navigate('/ai') },
    { id: 'nav-settings', group: 'Navigate', label: 'Open Settings', hint: 'Preferences and integrations', keywords: 'preferences provider sync', icon: <SettingsIcon size={15} strokeWidth={1.8} />, perform: () => navigate('/settings') },
    { id: 'wrapped-today', group: 'Day Wrapped', label: "Open today's Day Wrapped", hint: 'Recap the day so far', keywords: 'recap summary', icon: <Sparkles size={15} strokeWidth={1.8} />, perform: () => openWrappedFor(todayString()) },
    { id: 'wrapped-yesterday', group: 'Day Wrapped', label: "Open yesterday's Day Wrapped", hint: 'Morning brief', keywords: 'recap summary morning brief', icon: <Sparkles size={15} strokeWidth={1.8} />, perform: () => openWrappedFor(dateStringFromMs(Date.now() - 86_400_000)) },
    activeFocus
      ? { id: 'focus-stop', group: 'Focus' as const, label: 'End focus session', hint: `Session #${activeFocus.id}`, keywords: 'stop end', icon: <Timer size={15} strokeWidth={1.8} />, perform: async () => { await ipc.focus.stop(activeFocus.id); setActiveFocus(null) } }
      : { id: 'focus-start', group: 'Focus' as const, label: 'Start focus session', hint: 'Quiet distraction alerts', keywords: 'deep work', icon: <Timer size={15} strokeWidth={1.8} />, perform: async () => { await ipc.focus.start(null); setActiveFocus(await ipc.focus.getActive()) } },
    { id: 'updates-check', group: 'Tools', label: 'Check for updates', hint: 'Daylens update feed', keywords: 'upgrade version', icon: <Download size={15} strokeWidth={1.8} />, perform: () => { void ipc.updater.check() } },
    { id: 'updates-install', group: 'Tools', label: 'Install pending update', hint: 'If a newer build is ready', keywords: 'restart upgrade', icon: <RefreshCw size={15} strokeWidth={1.8} />, perform: () => { void ipc.updater.install() } },
  ], [navigate, openWrappedFor, activeFocus])

  const contextItems: PaletteItem[] = useMemo(() => contextActions.map((action: CommandSurfaceAction) => ({
    id: action.id,
    group: action.group === 'message' ? 'Actions for this message' : 'Chat',
    label: action.label,
    hint: action.hint,
    accelerator: action.accelerator,
    keywords: action.keywords,
    icon: action.icon,
    perform: action.perform,
  })), [contextActions])

  const searchItems: PaletteItem[] = useMemo(() => results.map((result) => ({
    id: `search:${result.type}:${result.id}:${result.startTime}`,
    group: 'Search results' as const,
    label: searchResultTitle(result),
    result,
    perform: () => handleResultClick(result),
  })), [results, handleResultClick])

  const items: PaletteItem[] = useMemo(() => {
    const q = query.trim()
    const commandPool = [...contextItems, ...staticActions]
    const commands = q.length === 0
      ? commandPool
      : commandPool
          .map((item) => ({ item, score: Math.max(fuzzyScore(item.label, q), item.hint ? fuzzyScore(item.hint, q) : 0, item.keywords ? fuzzyScore(item.keywords, q) : 0) }))
          .filter((entry) => entry.score > 0)
          .sort((a, b) => b.score - a.score)
          .map((entry) => entry.item)
    const merged = [...searchItems, ...commands]
    // Keep groups contiguous in the declared order; preserve within-group order.
    return merged
      .map((item, index) => ({ item, index }))
      .sort((a, b) => {
        const groupDelta = GROUP_ORDER.indexOf(a.item.group) - GROUP_ORDER.indexOf(b.item.group)
        return groupDelta !== 0 ? groupDelta : a.index - b.index
      })
      .map((entry) => entry.item)
  }, [contextItems, staticActions, searchItems, query])

  useEffect(() => {
    if (highlightIdx >= items.length) setHighlightIdx(0)
  }, [items.length, highlightIdx])

  // Keep the highlighted row in view during keyboard navigation.
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-idx="${highlightIdx}"]`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [highlightIdx])

  const runItem = useCallback((item: PaletteItem) => {
    void Promise.resolve(item.perform()).finally(close)
  }, [close])

  const handleKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightIdx((idx) => Math.min(items.length - 1, idx + 1)); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHighlightIdx((idx) => Math.max(0, idx - 1)); return }
    if (e.key === 'Enter') { e.preventDefault(); const target = items[highlightIdx]; if (target) runItem(target); return }
    if (e.key === 'Escape') { e.preventDefault(); close() }
  }, [items, highlightIdx, runItem, close])

  if (!isOpen) return null

  let lastGroup: GroupLabel | null = null

  return (
    <div
      role="dialog"
      aria-label="Daylens command palette"
      onClick={close}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(10,12,18,0.42)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '11vh',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(660px, 92vw)',
          maxHeight: '74vh',
          display: 'flex', flexDirection: 'column',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border-ghost)',
          borderRadius: 14,
          boxShadow: '0 24px 70px rgba(0,0,0,0.30)',
          overflow: 'hidden',
          fontFamily: 'var(--font-sans)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '14px 18px', borderBottom: '1px solid var(--color-border-ghost)' }}>
          <span style={{ color: 'var(--color-text-tertiary)', display: 'inline-flex', flexShrink: 0 }}>
            <Search size={17} strokeWidth={1.9} aria-hidden="true" />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setHighlightIdx(0) }}
            onKeyDown={handleKey}
            placeholder="Search your history, or jump anywhere…"
            aria-label="Search Daylens or run a command"
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--color-text-primary)', fontSize: 15.5, letterSpacing: '-0.01em' }}
          />
          {searchLoading && <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)', flexShrink: 0 }}>…</span>}
        </div>

        {(intent || matchTerms.length > 0) && (
          <div style={{ padding: '8px 18px 4px', display: 'grid', gap: 6, borderBottom: '1px solid var(--color-border-ghost)' }}>
            {intent && (
              <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', lineHeight: 1.5 }}>
                Interpreted as <span style={{ color: 'var(--color-text-secondary)' }}>{intent}</span>
              </div>
            )}
            {matchTerms.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {matchTerms.map((term) => (
                  <span key={term} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'var(--color-surface-high)', color: 'var(--color-text-secondary)' }}>{term}</span>
                ))}
              </div>
            )}
          </div>
        )}

        <div ref={listRef} style={{ overflowY: 'auto', padding: '6px 8px 8px' }}>
          {items.length === 0 ? (
            <div style={{ padding: '22px 12px', fontSize: 13, color: 'var(--color-text-tertiary)', lineHeight: 1.5 }}>
              {searchError ? `Search failed: ${searchError}` : query.trim() ? 'No matches. Try a window title, a domain, or a view name.' : 'Type to search your history or run a command.'}
            </div>
          ) : (
            items.map((item, idx) => {
              const showGroup = item.group !== lastGroup
              lastGroup = item.group
              const isActive = idx === highlightIdx
              return (
                <div key={item.id}>
                  {showGroup && (
                    <div style={{ padding: '12px 10px 5px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)' }}>
                      {item.group}
                    </div>
                  )}
                  <button
                    type="button"
                    data-idx={idx}
                    onMouseEnter={() => setHighlightIdx(idx)}
                    onClick={() => runItem(item)}
                    style={{
                      display: 'flex', alignItems: item.result ? 'flex-start' : 'center', gap: 11,
                      width: '100%', padding: item.result ? '9px 10px' : '8px 10px',
                      background: isActive ? 'var(--color-surface-high)' : 'transparent',
                      color: 'var(--color-text-primary)', border: 'none', borderRadius: 9,
                      textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5,
                    }}
                  >
                    {item.result ? (
                      <>
                        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 8, background: 'var(--color-surface-high)', color: 'var(--color-text-secondary)', flexShrink: 0, marginTop: 1 }}>
                          {sourceIcon(searchResultSourceKind(item.result))}
                        </span>
                        <span style={{ minWidth: 0, flex: 1 }}>
                          <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {searchResultTitle(item.result)}
                            </span>
                            <span style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                              {formatSearchTimestamp(item.result.startTime)}
                            </span>
                          </span>
                          <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                            {searchResultSubtitle(item.result)}
                          </span>
                          {item.result.excerpt && (
                            <span style={{ display: 'block', fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.5, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              <HighlightedExcerpt text={item.result.excerpt} />
                            </span>
                          )}
                        </span>
                      </>
                    ) : (
                      <>
                        {item.icon != null && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, color: 'var(--color-text-tertiary)', flexShrink: 0 }}>
                            {item.icon}
                          </span>
                        )}
                        <span style={{ flex: 1, minWidth: 0, fontWeight: 550, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
                        {item.accelerator ? (
                          <span style={{ display: 'inline-flex', gap: 3, flexShrink: 0 }}>
                            {item.accelerator.split(/\s+/).filter(Boolean).map((cap, i) => <Keycap key={i}>{cap}</Keycap>)}
                          </span>
                        ) : item.hint ? (
                          <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)', flexShrink: 0, marginLeft: 8 }}>{item.hint}</span>
                        ) : null}
                      </>
                    )}
                  </button>
                </div>
              )
            })
          )}
        </div>

        <div style={{ padding: '9px 18px', borderTop: '1px solid var(--color-border-ghost)', fontSize: 11.5, color: 'var(--color-text-tertiary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ display: 'inline-flex', gap: 12 }}>
            <span><Keycap>↑</Keycap> <Keycap>↓</Keycap> navigate</span>
            <span><Keycap>↵</Keycap> open</span>
            <span><Keycap>esc</Keycap> close</span>
          </span>
          <span>{platform === 'macos' ? '⌘K' : 'Ctrl K'}</span>
        </div>
      </div>
    </div>
  )
}
