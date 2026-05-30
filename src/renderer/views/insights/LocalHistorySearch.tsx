import { memo, useEffect, useState } from 'react'
import { ipc } from '../../lib/ipc'
import type { DaylensSearchResult } from '../../../preload/index'

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
    case 'session':
      return 'App'
    case 'block':
      return 'Block'
    case 'browser':
      return 'Web'
    case 'artifact':
      return 'File'
  }
}

function searchResultTitle(result: DaylensSearchResult): string {
  switch (result.type) {
    case 'session':
      return result.windowTitle || result.appName
    case 'block':
      return result.label
    case 'browser':
      return result.pageTitle || result.url || result.domain
    case 'artifact':
      return result.title
  }
}

function searchResultSubtitle(result: DaylensSearchResult): string {
  switch (result.type) {
    case 'session':
      return result.appName
    case 'block':
      return 'Timeline block'
    case 'browser':
      return result.domain
    case 'artifact':
      return result.filePath ? 'Generated artifact' : 'AI artifact'
  }
}

function HighlightedExcerpt({ text }: { text: string }) {
  const parts = text.split(/(\[\[mark\]\]|\[\[\/mark\]\])/g)
  let highlighted = false
  return (
    <>
      {parts.map((part, index) => {
        if (part === '[[mark]]') {
          highlighted = true
          return null
        }
        if (part === '[[/mark]]') {
          highlighted = false
          return null
        }
        if (!part) return null
        return highlighted
          ? <mark key={index} style={{ background: 'rgba(79, 219, 200, 0.18)', color: 'var(--color-text-primary)', borderRadius: 4, padding: '0 2px' }}>{part}</mark>
          : <span key={index}>{part}</span>
      })}
    </>
  )
}

export const LocalHistorySearch = memo(function LocalHistorySearch({
  onResultClick,
}: {
  onResultClick: (result: DaylensSearchResult) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DaylensSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setResults([])
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    const timer = window.setTimeout(() => {
      ipc.search.all(trimmed, { limit: 30 })
        .then((nextResults) => {
          if (!cancelled) setResults(nextResults)
        })
        .catch((searchError) => {
          if (!cancelled) {
            setResults([])
            setError(searchError instanceof Error ? searchError.message : String(searchError))
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 180)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query])

  return (
    <div className="ai-history-search">
      <div className="ai-history-search__bar">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true" className="ai-history-search__icon">
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5 14 14" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search your history or ask anything."
          aria-label="Search local Daylens history"
          className="ai-history-search__input"
        />
        {loading && <span className="ai-history-search__status">Searching…</span>}
      </div>

      {error && (
        <div className="ai-history-search__error">Search failed: {error}</div>
      )}

      {query.trim() && !loading && !error && results.length === 0 && (
        <div className="ai-history-search__empty">No local matches yet.</div>
      )}

      {results.length > 0 && (
        <div className="ai-history-search__results">
          {results.map((result) => (
            <button
              key={`${result.type}:${result.id}:${result.startTime}`}
              type="button"
              onClick={() => onResultClick(result)}
              className="ai-history-search__result"
            >
              <span className="ai-history-search__badge">{searchResultIcon(result.type)}</span>
              <span className="ai-history-search__body">
                <span className="ai-history-search__title">{searchResultTitle(result)}</span>
                <span className="ai-history-search__subtitle">{searchResultSubtitle(result)}</span>
                <span className="ai-history-search__excerpt">
                  <HighlightedExcerpt text={result.excerpt} />
                </span>
              </span>
              <span className="ai-history-search__time">{formatSearchTimestamp(result.startTime)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
})
