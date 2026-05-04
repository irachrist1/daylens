import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ipc } from '../lib/ipc'
import { dateStringFromMs, todayString } from '../lib/format'
import type { DayTimelinePayload, FocusSession } from '@shared/types'

export interface CommandPaletteProps {
  isOpen: boolean
  platform: 'macos' | 'windows' | 'linux'
  onClose: () => void
  onOpenWrapped: (payload: { day: DayTimelinePayload; threadId: number | null; artifactId: number | null }) => void
}

interface PaletteAction {
  id: string
  group: 'Navigate' | 'Day Wrapped' | 'Focus' | 'Tools' | 'Search'
  label: string
  hint?: string
  keywords?: string
  perform: () => void | Promise<void>
}

interface SearchHit {
  id: string
  group: 'Search'
  label: string
  hint: string
  perform: () => void
}

function fuzzyScore(haystack: string, needle: string): number {
  if (!needle) return 1
  const h = haystack.toLowerCase()
  const n = needle.toLowerCase()
  if (h.startsWith(n)) return 4
  if (h.includes(` ${n}`)) return 3
  if (h.includes(n)) return 2
  // letter-subsequence fallback
  let i = 0
  for (const ch of h) {
    if (ch === n[i]) i += 1
    if (i === n.length) return 1
  }
  return 0
}

export default function CommandPalette({ isOpen, platform, onClose, onOpenWrapped }: CommandPaletteProps) {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [highlightIdx, setHighlightIdx] = useState(0)
  const [activeFocus, setActiveFocus] = useState<FocusSession | null>(null)
  const [searchHits, setSearchHits] = useState<SearchHit[]>([])

  // Reset state on every open
  useEffect(() => {
    if (!isOpen) return
    setQuery('')
    setHighlightIdx(0)
    setSearchHits([])
    requestAnimationFrame(() => inputRef.current?.focus())
    void ipc.focus.getActive().then(setActiveFocus).catch(() => setActiveFocus(null))
  }, [isOpen])

  // Live search across timeline/blocks/browser/artifacts when the query is long enough
  useEffect(() => {
    if (!isOpen) return
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setSearchHits([])
      return
    }
    let cancelled = false
    const handle = setTimeout(() => {
      void ipc.search.all(trimmed, { limit: 8 }).then((results) => {
        if (cancelled) return
        const hits: SearchHit[] = results.map((result) => {
          if (result.type === 'session') {
            return {
              id: `search-session-${result.id}`,
              group: 'Search' as const,
              label: result.windowTitle || result.appName,
              hint: `Session in ${result.appName} on ${result.date}`,
              perform: () => navigate(`/timeline?date=${result.date}`),
            }
          }
          if (result.type === 'block') {
            return {
              id: `search-block-${result.id}`,
              group: 'Search' as const,
              label: result.label,
              hint: `Work block on ${result.date}`,
              perform: () => navigate(`/timeline?date=${result.date}&blockId=${result.id}`),
            }
          }
          if (result.type === 'browser') {
            return {
              id: `search-browser-${result.id}`,
              group: 'Search' as const,
              label: result.pageTitle || result.domain,
              hint: `${result.domain} · ${result.date}`,
              perform: () => navigate(`/timeline?date=${result.date}`),
            }
          }
          return {
            id: `search-artifact-${result.id}`,
            group: 'Search' as const,
            label: result.title,
            hint: `Artifact · ${result.date}`,
            perform: () => { void ipc.ai.openArtifact(result.id) },
          }
        })
        setSearchHits(hits)
      }).catch(() => setSearchHits([]))
    }, 120)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [query, isOpen, navigate])

  const close = useCallback(() => {
    onClose()
    setQuery('')
    setHighlightIdx(0)
  }, [onClose])

  const openWrappedFor = useCallback(async (date: string) => {
    const day = await ipc.db.getTimelineDay(date)
    onOpenWrapped({ day, threadId: null, artifactId: null })
  }, [onOpenWrapped])

  const actions: PaletteAction[] = useMemo(() => {
    const list: PaletteAction[] = [
      { id: 'nav-timeline', group: 'Navigate', label: 'Open Timeline', hint: 'Day and week view', keywords: 'today day week', perform: () => navigate('/timeline') },
      { id: 'nav-apps', group: 'Navigate', label: 'Open Apps', hint: 'Per-app context', keywords: 'tools applications', perform: () => navigate('/apps') },
      { id: 'nav-ai', group: 'Navigate', label: 'Open AI', hint: 'Chat and recap', keywords: 'chat insights ask', perform: () => navigate('/ai') },
      { id: 'nav-settings', group: 'Navigate', label: 'Open Settings', hint: 'Preferences and integrations', keywords: 'preferences provider sync', perform: () => navigate('/settings') },
      {
        id: 'wrapped-today',
        group: 'Day Wrapped',
        label: "Open today's Day Wrapped",
        hint: 'Recap the day so far',
        keywords: 'recap summary',
        perform: () => openWrappedFor(todayString()),
      },
      {
        id: 'wrapped-yesterday',
        group: 'Day Wrapped',
        label: "Open yesterday's Day Wrapped",
        hint: 'Morning brief',
        keywords: 'recap summary morning brief',
        perform: () => openWrappedFor(dateStringFromMs(Date.now() - 86_400_000)),
      },
      activeFocus
        ? {
            id: 'focus-stop',
            group: 'Focus',
            label: 'End focus session',
            hint: `Session #${activeFocus.id}`,
            keywords: 'stop end',
            perform: async () => {
              await ipc.focus.stop(activeFocus.id)
              setActiveFocus(null)
            },
          }
        : {
            id: 'focus-start',
            group: 'Focus',
            label: 'Start focus session',
            hint: 'Quiet distraction alerts',
            keywords: 'deep work',
            perform: async () => {
              await ipc.focus.start(null)
              const next = await ipc.focus.getActive()
              setActiveFocus(next)
            },
          },
      {
        id: 'updates-check',
        group: 'Tools',
        label: 'Check for updates',
        hint: 'Daylens update feed',
        keywords: 'upgrade version',
        perform: () => { void ipc.updater.check() },
      },
      {
        id: 'updates-install',
        group: 'Tools',
        label: 'Install pending update',
        hint: 'If a newer build is ready',
        keywords: 'restart upgrade',
        perform: () => { void ipc.updater.install() },
      },
    ]
    return list
  }, [navigate, openWrappedFor, activeFocus])

  const filtered = useMemo(() => {
    const q = query.trim()
    const localHits = actions
      .map((action) => {
        const score = Math.max(
          fuzzyScore(action.label, q),
          fuzzyScore(action.group, q),
          action.hint ? fuzzyScore(action.hint, q) : 0,
          action.keywords ? fuzzyScore(action.keywords, q) : 0,
        )
        return { action, score }
      })
      .filter((entry) => q.length === 0 || entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.action)

    return [...localHits, ...searchHits]
  }, [actions, query, searchHits])

  useEffect(() => {
    if (highlightIdx >= filtered.length) setHighlightIdx(0)
  }, [filtered.length, highlightIdx])

  const handleKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIdx((idx) => Math.min(filtered.length - 1, idx + 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIdx((idx) => Math.max(0, idx - 1))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const target = filtered[highlightIdx]
      if (target) {
        void Promise.resolve(target.perform()).finally(close)
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }, [filtered, highlightIdx, close])

  if (!isOpen) return null

  const acceleratorLabel = platform === 'macos' ? '⌘ ⌥ D' : 'Ctrl Alt D'

  return (
    <div
      role="dialog"
      aria-label="Daylens command palette"
      onClick={close}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(7, 10, 16, 0.55)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(640px, 92vw)',
          maxHeight: '70vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--color-surface, #0f141c)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 12,
          boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
          overflow: 'hidden',
          fontFamily: 'var(--font-sans)',
        }}
      >
        <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setHighlightIdx(0) }}
            onKeyDown={handleKey}
            placeholder="Search Daylens, jump to a view, start focus…"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--color-text-primary)',
              fontSize: 15,
              letterSpacing: '-0.01em',
            }}
          />
          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', padding: '2px 8px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6 }}>
            {acceleratorLabel}
          </span>
        </div>
        <div style={{ overflowY: 'auto', padding: '6px 0' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '20px 16px', fontSize: 13, color: 'var(--color-text-tertiary)' }}>
              No matches. Try typing a view name, "focus", "wrapped", or part of a window title.
            </div>
          ) : (
            (() => {
              let lastGroup: string | null = null
              return filtered.map((action, idx) => {
                const showGroup = action.group !== lastGroup
                lastGroup = action.group
                const isActive = idx === highlightIdx
                return (
                  <div key={action.id}>
                    {showGroup && (
                      <div style={{
                        padding: '10px 16px 4px',
                        fontSize: 10.5,
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        color: 'var(--color-text-tertiary)',
                      }}>{action.group}</div>
                    )}
                    <button
                      type="button"
                      onMouseEnter={() => setHighlightIdx(idx)}
                      onClick={() => { void Promise.resolve(action.perform()).finally(close) }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        width: '100%',
                        padding: '8px 16px',
                        background: isActive ? 'rgba(173,198,255,0.08)' : 'transparent',
                        color: 'var(--color-text-primary)',
                        border: 'none',
                        textAlign: 'left',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        fontSize: 13,
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{action.label}</span>
                      {action.hint && (
                        <span style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', marginLeft: 12 }}>
                          {action.hint}
                        </span>
                      )}
                    </button>
                  </div>
                )
              })
            })()
          )}
        </div>
        <div style={{ padding: '8px 16px', borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: 11, color: 'var(--color-text-tertiary)', display: 'flex', justifyContent: 'space-between' }}>
          <span>↑ ↓ to move · ↵ to select · esc to close</span>
          <span>Type 2+ chars to search timeline, blocks, pages, artifacts</span>
        </div>
      </div>
    </div>
  )
}
