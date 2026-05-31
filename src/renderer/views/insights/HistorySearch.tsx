import { memo, useEffect, useState } from 'react'
import { ipc } from '../../lib/ipc'
import type { DaylensSearchResult } from '../../../preload/index'
import { IconSearch } from './icons'

function formatSearchTimestamp(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function searchResultIcon(type: DaylensSearchResult['type']): string {
  switch (type) {
    case 'session': return 'App'
    case 'block': return 'Block'
    case 'browser': return 'Web'
    case 'artifact': return 'File'
  }
}

function searchResultTitle(result: DaylensSearchResult): string {
  switch (result.type) {
    case 'session': return result.windowTitle || result.appName
    case 'block': return result.label
    case 'browser': return result.pageTitle || result.url || result.domain
    case 'artifact': return result.title
  }
}

function searchResultSubtitle(result: DaylensSearchResult): string {
  switch (result.type) {
    case 'session': return result.appName
    case 'block': return 'Timeline block'
    case 'browser': return result.domain
    case 'artifact': return result.filePath ? 'Generated artifact' : 'AI artifact'
  }
}

function HighlightedExcerpt({ text }: { text: string }) {
  const parts = text.split(/(\[\[mark\]\]|\[\[\/mark\]\])/g)
  let highlighted = false
  return (
    <>
      {parts.map((part, index) => {
        if (part === '[[mark]]') { highlighted = true; return null }
        if (part === '[[/mark]]') { highlighted = false; return null }
        if (!part) return null
        return highlighted
          ? <mark key={index} style={{ background: 'rgba(79, 219, 200, 0.18)', color: 'var(--color-text-primary)', borderRadius: 4, padding: '0 2px' }}>{part}</mark>
          : <span key={index}>{part}</span>
      })}
    </>
  )
}

// The local-history search. Kept verbatim in behaviour (debounced `search.all`
// across sessions/blocks/browser/artifacts with highlighted excerpts) — only
// the chrome changed: it is now a slim bar whose results drop into an overlay
// panel so it never pushes the conversation around. Fully isolated state, so
// typing here never touches the chat, and chat updates never re-run a search.
export const HistorySearch = memo(function HistorySearch({
  onResultClick,
}: {
  onResultClick: (result: DaylensSearchResult) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DaylensSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  // S1: when a query is interpreted by the provider, surface the intent + the
  // terms it searched as the "why these matched" signal.
  const [intent, setIntent] = useState<string | null>(null)
  const [matchTerms, setMatchTerms] = useState<string[]>([])

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setResults([])
      setLoading(false)
      setError(null)
      setIntent(null)
      setMatchTerms([])
      return
    }

    // S1: short/literal queries stay on the instant keyword path (no provider).
    // Longer or question-shaped queries route through natural-language search.
    const tokenCount = trimmed.split(/\s+/).filter(Boolean).length
    const isNatural = tokenCount >= 4 || trimmed.includes('?')

    let cancelled = false
    setLoading(true)
    setError(null)
    const timer = window.setTimeout(() => {
      const run = isNatural
        ? ipc.search.natural(trimmed, { limit: 30 }).then((response) => {
            if (cancelled) return
            setResults(response.results)
            setIntent(response.intent)
            setMatchTerms(response.terms)
          })
        : ipc.search.all(trimmed, { limit: 30 }).then((nextResults) => {
            if (cancelled) return
            setResults(nextResults)
            setIntent(null)
            setMatchTerms([])
          })
      run
        .catch((searchError) => {
          if (!cancelled) {
            setResults([])
            setError(searchError instanceof Error ? searchError.message : String(searchError))
          }
        })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, isNatural ? 420 : 180)

    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [query])

  const trimmed = query.trim()
  const open = focused && trimmed.length > 0

  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0, maxWidth: 420 }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 34,
        borderRadius: 9,
        border: '1px solid var(--color-border-ghost)',
        background: 'var(--color-surface)',
        padding: '0 12px',
      }}>
        <span style={{ color: 'var(--color-text-tertiary)', display: 'inline-flex', flexShrink: 0 }}>
          <IconSearch />
        </span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setFocused(true)}
          // Delay blur so a click on a result still registers.
          onBlur={() => window.setTimeout(() => setFocused(false), 120)}
          onKeyDown={(event) => { if (event.key === 'Escape') { setQuery(''); event.currentTarget.blur() } }}
          placeholder="Search history — or ask in plain language…"
          aria-label="Search local Daylens history"
          style={{
            flex: 1,
            minWidth: 0,
            border: 'none',
            background: 'transparent',
            outline: 'none',
            color: 'var(--color-text-primary)',
            fontSize: 13,
          }}
        />
        {loading && <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', flexShrink: 0 }}>…</span>}
      </div>

      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 24 }} onMouseDown={() => setFocused(false)} />
          <div style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            minWidth: 340,
            zIndex: 25,
            maxHeight: 420,
            overflowY: 'auto',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border-ghost)',
            borderRadius: 12,
            boxShadow: '0 18px 48px rgba(0,0,0,0.28)',
            padding: 8,
            display: 'grid',
            gap: 6,
          }}>
            {(intent || matchTerms.length > 0) && (
              <div style={{ padding: '2px 8px 4px', display: 'grid', gap: 6 }}>
                {intent && (
                  <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', lineHeight: 1.5 }}>
                    Interpreted as <span style={{ color: 'var(--color-text-secondary)' }}>{intent}</span>
                  </div>
                )}
                {matchTerms.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {matchTerms.map((term) => (
                      <span key={term} style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 999, background: 'var(--color-surface-high)', color: 'var(--color-text-secondary)' }}>{term}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
            {error && (
              <div style={{ fontSize: 12.5, color: '#f87171', lineHeight: 1.5, padding: '6px 8px' }}>
                Search failed: {error}
              </div>
            )}
            {!error && !loading && results.length === 0 && (
              <div style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)', lineHeight: 1.5, padding: '6px 8px' }}>
                No local matches yet.
              </div>
            )}
            {results.map((result) => (
              <button
                key={`${result.type}:${result.id}:${result.startTime}`}
                type="button"
                onMouseDown={(event) => { event.preventDefault(); onResultClick(result); setFocused(false) }}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '46px minmax(0, 1fr) auto',
                  alignItems: 'start',
                  gap: 12,
                  textAlign: 'left',
                  border: '1px solid var(--color-border-ghost)',
                  borderRadius: 10,
                  background: 'transparent',
                  padding: '10px 12px',
                  cursor: 'pointer',
                }}
              >
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: 24,
                  borderRadius: 999,
                  background: 'var(--color-surface-high)',
                  color: 'var(--color-text-secondary)',
                  fontSize: 10.5,
                  fontWeight: 800,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }}>
                  {searchResultIcon(result.type)}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 720, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {searchResultTitle(result)}
                  </span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 3 }}>
                    {searchResultSubtitle(result)}
                  </span>
                  <span style={{ display: 'block', fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.55, marginTop: 6 }}>
                    <HighlightedExcerpt text={result.excerpt} />
                  </span>
                </span>
                <span style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap', paddingTop: 2 }}>
                  {formatSearchTimestamp(result.startTime)}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
})
